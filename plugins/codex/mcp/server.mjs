#!/usr/bin/env node
// Overflow delegation tool.
//
// One call carries every order the orchestrator wants done, opens a socket to
// the relay, and parks until the artifacts come back. Parking is the whole
// point: a suspended tool call burns no allowance, which is what makes this
// usable by a session that has almost none left. Measured on Codex 0.144.1, a
// 159-second park cost the same as a call that failed instantly.
//
// Progress is streamed as notifications/progress while parked, so the user sees
// the work moving without the model being woken to tell them.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import {
  DEFAULT_RELAY,
  connect as joinPool,
  readConfig,
  writeConfig,
  RECONNECT_MIN_MS,
} from "../lib/earner.mjs";

const TOOL = "overflow_delegate";
const PAIR_TOOL = "overflow_join";
const STATUS_TOOL = "overflow_pool";

// Whether this session is also carrying work for other people. Codex starts this
// server at session start and keeps it alive for the session, so joining the
// pool here means a friend never runs anything: they install the plugin, and
// their machine is available for as long as they have Codex open.
let earning = false;
// Set by the session-start hook's own reading of the account, passed through the
// environment: below the trigger this machine is a requester, not a worker.
const lowOnAllowance = process.env.OVERFLOW_LOW === "1";

function startEarning() {
  if (earning || process.env.OVERFLOW_EARN === "0") return false;
  const cfg = readConfig();
  if (!cfg.relay || !cfg.token) return false;
  // A session that is itself about to delegate has no allowance to spare, so it
  // joins as a requester only.
  if (lowOnAllowance) return false;
  earning = true;
  // Several Codex windows means several of these; the suffix keeps them apart
  // in the pool while still showing the person's name.
  const name = `${cfg.name || os.hostname()}`;
  joinPool({ ...cfg, name }, { backoff: RECONNECT_MIN_MS, completed: 0 });
  return true;
}
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;

function dataDir() {
  return process.env.PLUGIN_DATA
    ? path.resolve(process.env.PLUGIN_DATA)
    : path.join(os.homedir(), ".codex", "plugins", "data", "overflow-personal");
}

// The relay URL and pool token are read from the environment the plugin's
// .mcp.json declares, falling back to a file the user writes once. Codex does
// not pass the parent shell's environment to MCP servers, so inheriting these
// from a login shell silently yields undefined.
function config() {
  let stored = {};
  const file = path.join(dataDir(), "config.json");
  try {
    stored = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // No stored config yet; environment alone may still be enough.
  }
  return {
    relay: process.env.OVERFLOW_RELAY || stored.relay || "",
    token: process.env.OVERFLOW_TOKEN || stored.token || "",
    name: process.env.OVERFLOW_NAME || stored.name || os.hostname(),
  };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function socketUrl(relay, route, token, name) {
  const url = new URL(route, relay.replace(/^http/, "ws"));
  url.searchParams.set("token", token);
  url.searchParams.set("name", name);
  return url.toString();
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeOrders(args) {
  const raw = Array.isArray(args.orders) ? args.orders : [args];
  if (raw.length === 0) throw new Error("Provide at least one order.");
  if (raw.length > 8) throw new Error("At most 8 orders per call.");
  return raw.map((order, index) => ({
    objective: requireString(order.objective, `orders[${index}].objective`),
    context: typeof order.context === "string" ? order.context.trim() : "",
    expectedArtifact: requireString(
      order.expectedArtifact,
      `orders[${index}].expectedArtifact`,
    ),
    acceptanceTest: requireString(
      order.acceptanceTest,
      `orders[${index}].acceptanceTest`,
    ),
  }));
}

async function poolStatus({ relay, token }) {
  const url = new URL("/status", relay);
  url.searchParams.set("token", token);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Relay returned ${response.status}.`);
  return response.json();
}

// Park until every order is answered. Resolves with one entry per order, in the
// order they were submitted.
function delegate(orders, cfg, progressToken, timeoutSeconds, pool) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      socketUrl(cfg.relay, "/delegate", cfg.token, cfg.name),
    );
    const artifacts = new Array(orders.length).fill(null);
    let done = 0;
    let settled = false;

    const notify = (message) => {
      if (progressToken === undefined) return;
      send({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          progressToken,
          progress: done,
          total: orders.length,
          message,
        },
      });
    };

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Already closing; nothing to do.
      }
      error ? reject(error) : resolve(value);
    };

    // A batch that runs out of time keeps whatever came back. Throwing here
    // would discard finished artifacts the pool already spent allowance
    // producing, and the orchestrator would have no way to recover them.
    const timer = setTimeout(() => {
      if (done === 0) {
        finish(
          new Error(
            `No orders came back within ${timeoutSeconds}s. The pool may be busy; ` +
              `try again with fewer orders or a longer timeoutSeconds.`,
          ),
        );
        return;
      }
      finish(null, artifacts);
    }, timeoutSeconds * 1000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "submit", orders }));
      // Orders outnumbering workers is the usual reason a batch feels slow, so
      // say it up front instead of letting it look like a stall.
      const workers = pool?.earners ?? 0;
      notify(
        orders.length > workers
          ? `submitted ${orders.length} orders to ${workers} worker(s) — some will queue`
          : `submitted ${orders.length} order(s) to ${workers} worker(s)`,
      );
    });

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "progress" && message.state === "claimed") {
        notify(`order ${message.index + 1} claimed by ${message.worker}`);
        return;
      }

      if (message.type === "progress" && message.state === "requeued") {
        notify(
          `order ${message.index + 1} went back in the queue — ${message.worker} dropped off`,
        );
        return;
      }

      if (message.type === "result") {
        if (artifacts[message.index] === null) done += 1;
        artifacts[message.index] = {
          status: message.status,
          worker: message.worker,
          artifact: message.artifact,
        };
        notify(`${done} of ${orders.length} back`);
        if (done === orders.length) finish(null, artifacts);
        return;
      }

      if (message.type === "error") {
        finish(new Error(message.error || "Relay rejected the batch."));
      }
    });

    socket.addEventListener("error", () => {
      finish(new Error(`Could not reach the Overflow relay at ${cfg.relay}.`));
    });

    socket.addEventListener("close", () => {
      if (done === 0) {
        finish(new Error("The relay closed the connection before any order ran."));
        return;
      }
      if (done < orders.length) finish(null, artifacts);
    });
  });
}

function renderArtifacts(orders, artifacts) {
  const missing = artifacts
    .map((entry, index) => (entry ? null : index + 1))
    .filter((index) => index !== null);

  const body = artifacts
    .map((entry, index) => {
      const header = `## Order ${index + 1}: ${orders[index].objective}`;
      if (!entry) {
        return `${header}\n_NOT RETURNED — no worker completed this order._`;
      }
      const attribution =
        entry.status === "completed"
          ? `_returned by ${entry.worker}_`
          : `_FAILED on ${entry.worker}_`;
      return `${header}\n${attribution}\n\n${entry.artifact}`;
    })
    .join("\n\n---\n\n");

  if (missing.length === 0) return body;
  return (
    `**${artifacts.length - missing.length} of ${artifacts.length} orders came back.** ` +
    `Order(s) ${missing.join(", ")} did not. Keep what returned and either ` +
    `delegate only the missing order(s) again or do those locally — do not ` +
    `re-run the ones below.\n\n${body}`
  );
}

async function callDelegate(params) {
  const args = params.arguments ?? {};
  const cfg = config();
  if (!cfg.relay || !cfg.token) {
    throw new Error(
      "Overflow is not paired yet. Run `overflow pair <relay-url> <invite-code>` once, then retry.",
    );
  }

  const orders = normalizeOrders(args);
  const timeoutSeconds = Math.min(
    3600,
    Math.max(30, Number(args.timeoutSeconds ?? 600)),
  );

  // Parking into an empty pool is the one failure the user cannot diagnose:
  // they would sit and watch a spinner with nothing on the other end. Check
  // first and hand the work straight back instead.
  const status = await poolStatus(cfg);
  if (status.earners === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            "No Overflow workers are online, so nothing was delegated. " +
            "Tell the user the pool is empty and either do the smallest useful " +
            "piece locally or ask them to get a friend to run `overflow earn`.",
        },
      ],
      structuredContent: { delegated: false, earners: 0 },
    };
  }

  const artifacts = await delegate(
    orders,
    cfg,
    params._meta?.progressToken,
    timeoutSeconds,
    status,
  );

  return {
    content: [{ type: "text", text: renderArtifacts(orders, artifacts) }],
    structuredContent: {
      delegated: true,
      orders: orders.length,
      returned: artifacts.filter(Boolean).length,
      results: artifacts,
    },
  };
}

async function callJoin(params) {
  const args = params.arguments ?? {};
  const inviteCode = requireString(args.inviteCode, "inviteCode");
  const relay =
    typeof args.relay === "string" && args.relay.trim() ? args.relay.trim() : DEFAULT_RELAY;
  const name =
    typeof args.name === "string" && args.name.trim() ? args.name.trim() : os.hostname();

  // Check the code before storing it, so a typo fails here rather than silently
  // leaving someone in a pool of one.
  const check = new URL("/status", relay);
  check.searchParams.set("token", inviteCode);
  const response = await fetch(check, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 401) {
    throw new Error("That invite code was not accepted by the relay. Check it with whoever runs the pool.");
  }
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  const pool = await response.json();

  writeConfig({ relay, token: inviteCode, name });
  const started = startEarning();

  const others =
    (pool.workers || []).map((w) => w.name).filter((n) => n !== name).join(", ") ||
    "nobody else yet";
  return {
    content: [
      {
        type: "text",
        text:
          `Joined the pool as "${name}". Already online: ${others}.\n\n` +
          (started
            ? "This machine now takes work for the pool whenever Codex is open, and stops when it is closed. " +
              "Nothing else to run."
            : "Work-sharing is switched off here (OVERFLOW_EARN=0), so this machine will delegate but not take jobs.") +
          "\n\nWhen this account drops below 25% allowance, sessions start delegating to the pool automatically.",
      },
    ],
    structuredContent: { joined: true, name, relay, earning: started, poolSize: pool.earners ?? 0 },
  };
}

async function callPool() {
  const cfg = config();
  if (!cfg.relay || !cfg.token) {
    return {
      content: [
        {
          type: "text",
          text: "Not in a pool yet. Ask whoever runs one for an invite code, then use the overflow_join tool.",
        },
      ],
      structuredContent: { joined: false },
    };
  }
  const pool = await poolStatus(cfg);
  const names = (pool.workers || []).map(
    (w) =>
      `${w.name}${w.sessions > 1 ? ` (${w.sessions} sessions)` : ""}${w.busy ? " — busy" : ""}`,
  );
  return {
    content: [
      {
        type: "text",
        text:
          `${pool.machines ?? pool.earners} machine(s) online: ${names.join(", ") || "none"}.\n` +
          `${pool.idle} free, ${pool.queued} order(s) waiting.\n` +
          `This machine is ${earning ? "taking work for the pool" : "not taking work"}.`,
      },
    ],
    structuredContent: { ...pool, thisMachineEarning: earning },
  };
}

const ORDER_SCHEMA = {
  type: "object",
  properties: {
    objective: {
      type: "string",
      description: "Exact outcome the worker must produce.",
    },
    context: {
      type: "string",
      description:
        "Everything the worker needs. It runs on a stranger's computer and can see none of your files.",
    },
    expectedArtifact: {
      type: "string",
      description: "Concrete shape of the response to return.",
    },
    acceptanceTest: {
      type: "string",
      description: "How you will decide whether the returned artifact is usable.",
    },
  },
  required: ["objective", "expectedArtifact", "acceptanceTest"],
  additionalProperties: false,
};

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "Overflow delegation", version: "0.3.0" },
      instructions:
        "When Overflow reports low remaining allowance, coordinate instead of executing: " +
        "package the work as orders and call overflow_delegate once with all of them. " +
        "The call parks without spending allowance and returns the workers' artifacts.",
    });
    return;
  }

  if (method === "ping") return sendResult(id, {});

  if (method === "notifications/initialized" || method === "initialized") {
    // The session is up; take work for other people from here on.
    startEarning();
    return;
  }

  if (method === "tools/list") {
    sendResult(id, {
      tools: [
        {
          name: PAIR_TOOL,
          title: "Join an Overflow pool",
          description:
            "Join a friend's Overflow pool using the invite code they gave you. Call this when the user " +
            "wants to join, be added to, or set up an Overflow pool. After this, their machine takes work " +
            "for the pool whenever they have Codex open, and their own sessions can delegate when they run low.",
          inputSchema: {
            type: "object",
            properties: {
              inviteCode: { type: "string", description: "The invite code the pool owner gave the user." },
              name: { type: "string", description: "What to call this machine in the pool. Defaults to the hostname." },
              relay: { type: "string", description: "Only for a pool that is not on the default relay." },
            },
            required: ["inviteCode"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        {
          name: STATUS_TOOL,
          title: "Show the Overflow pool",
          description:
            "Show who is currently online in the user's Overflow pool and whether this machine is taking work. " +
            "Call this when the user asks about their pool, who is available, or whether Overflow is working.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        },
        {
          name: TOOL,
          title: "Delegate through Overflow",
          description:
            "Send the work you were about to do to idle Codex installations belonging to the user's friends, " +
            "and return their artifacts. Blocks until every order is answered, without spending allowance " +
            "while it waits. Pass every order in one call so they run in parallel.",
          inputSchema: {
            type: "object",
            properties: {
              orders: {
                type: "array",
                description: "Every order to run in parallel. 1 to 8.",
                items: ORDER_SCHEMA,
                minItems: 1,
                maxItems: 8,
              },
              timeoutSeconds: {
                type: "integer",
                minimum: 30,
                maximum: 3600,
                default: 600,
              },
            },
            required: ["orders"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
        },
      ],
    });
    return;
  }

  if (method === "tools/call") {
    try {
      if (params?.name === PAIR_TOOL) return sendResult(id, await callJoin(params));
      if (params?.name === STATUS_TOOL) return sendResult(id, await callPool());
      if (params?.name !== TOOL) {
        return sendError(id, INVALID_PARAMS, `Unknown tool: ${params?.name ?? ""}`);
      }
      sendResult(id, await callDelegate(params));
    } catch (error) {
      sendError(
        id,
        INVALID_PARAMS,
        error instanceof Error ? error.message : String(error),
      );
    }
    return;
  }

  if (id !== undefined) {
    sendError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

readline
  .createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on("line", (line) => {
    if (!line.trim()) return;
    try {
      void handleRequest(JSON.parse(line));
    } catch {
      // Malformed transport input must not kill the server.
    }
  });
