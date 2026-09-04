#!/usr/bin/env node
// Overflow's MCP server is only a broker. It never starts Codex itself.
//
// Requester session: overflow_delegate parks while visible earning sessions work.
// Earner session: overflow_claim parks until one order arrives, returns that order
// into the current visible conversation, and overflow_return sends its artifact
// back to the requester.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { dataDir, readConfig, writeConfig } from "../lib/config.mjs";

const DELEGATE_TOOL = "overflow_delegate";
const CLAIM_TOOL = "overflow_claim";
const RETURN_TOOL = "overflow_return";
const JOIN_TOOL = "overflow_join";
const STATUS_TOOL = "overflow_pool";
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
const MAX_ARTIFACT_BYTES = 600_000;
const MAX_FILES = 4;
const MAX_FILE_BYTES = 12_000_000;

let pendingClaim = false;
let activeClaim = null;

function config() {
  return readConfig();
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

function safeFileName(value, index) {
  const base = path.basename(typeof value === "string" ? value : "");
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : `artifact-${index + 1}`;
}

function mimeTypeFor(name) {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".html") return "text/html";
  if (extension === ".md") return "text/markdown";
  return "application/octet-stream";
}

function readReturnFiles(rawFiles) {
  if (rawFiles === undefined) return [];
  if (!Array.isArray(rawFiles)) throw new Error("files must be an array");
  if (rawFiles.length > MAX_FILES) throw new Error(`at most ${MAX_FILES} files can be returned`);

  let total = 0;
  return rawFiles.map((entry, index) => {
    const rawPath = requireString(entry?.path, `files[${index}].path`);
    const filePath = path.resolve(rawPath);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error(`${rawPath} is not a regular file`);
    total += stat.size;
    if (total > MAX_FILE_BYTES) {
      throw new Error(`returned files exceed the ${MAX_FILE_BYTES} byte limit`);
    }
    const name = safeFileName(entry?.name || filePath, index);
    return {
      name,
      mimeType: mimeTypeFor(name),
      bytes: stat.size,
      dataBase64: fs.readFileSync(filePath).toString("base64"),
    };
  });
}

function persistReturnedFiles(jobId, rawFiles) {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) return [];
  if (rawFiles.length > MAX_FILES) throw new Error("relay returned too many files");
  const destination = path.join(dataDir(), "returns", jobId);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });

  let total = 0;
  return rawFiles.map((entry, index) => {
    const name = safeFileName(entry?.name, index);
    const bytes = Buffer.from(requireString(entry?.dataBase64, `files[${index}].dataBase64`), "base64");
    total += bytes.length;
    if (total > MAX_FILE_BYTES) throw new Error("relay returned files over the size limit");
    const filePath = path.join(destination, name);
    fs.writeFileSync(filePath, bytes, { mode: 0o600 });
    return { name, path: filePath, bytes: bytes.length, mimeType: entry?.mimeType || mimeTypeFor(name) };
  });
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

function notify(progressToken, progress, total, message) {
  if (progressToken === undefined) return;
  send({
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progressToken, progress, total, message },
  });
}

function delegate(orders, cfg, progressToken, timeoutSeconds, pool) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      socketUrl(cfg.relay, "/delegate", cfg.token, cfg.name),
    );
    const artifacts = new Array(orders.length).fill(null);
    let done = 0;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      error ? reject(error) : resolve(value);
    };

    const timer = setTimeout(() => {
      if (done === 0) {
        finish(
          new Error(
            `No orders came back within ${timeoutSeconds}s. No earning session ` +
              "claimed the work, or the claimed task did not finish in time.",
          ),
        );
      } else {
        finish(null, artifacts);
      }
    }, timeoutSeconds * 1000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "submit", orders }));
      const waiting = pool?.idle ?? 0;
      notify(
        progressToken,
        done,
        orders.length,
        waiting > 0
          ? `submitted ${orders.length} order(s); ${waiting} earning session(s) waiting`
          : `queued ${orders.length} order(s); waiting for someone to open /earn`,
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
        notify(
          progressToken,
          done,
          orders.length,
          `order ${message.index + 1} claimed in ${message.worker}'s visible Codex task`,
        );
      } else if (message.type === "progress" && message.state === "requeued") {
        notify(
          progressToken,
          done,
          orders.length,
          `order ${message.index + 1} returned to the queue after ${message.worker} closed`,
        );
      } else if (message.type === "result") {
        if (artifacts[message.index] === null) done += 1;
        artifacts[message.index] = {
          status: message.status,
          worker: message.worker,
          artifact: message.artifact,
          files: persistReturnedFiles(message.job, message.files),
        };
        notify(progressToken, done, orders.length, `${done} of ${orders.length} returned`);
        if (done === orders.length) finish(null, artifacts);
      } else if (message.type === "error") {
        finish(new Error(message.error || "Relay rejected the batch."));
      }
    });

    socket.addEventListener("error", () => {
      finish(new Error(`Could not reach the Overflow relay at ${cfg.relay}.`));
    });
    socket.addEventListener("close", () => {
      if (!settled && done === 0) {
        finish(new Error("The relay closed before any order returned."));
      } else if (!settled && done < orders.length) {
        finish(null, artifacts);
      }
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
      if (!entry) return `${header}\n_NOT RETURNED._`;
      const attribution =
        entry.status === "completed"
          ? `_returned from ${entry.worker}'s visible Overflow task_`
          : `_FAILED in ${entry.worker}'s Overflow task_`;
      const returnedFiles = entry.files?.length
        ? `\n\nReturned files:\n${entry.files.map((file) => `- ${file.path}`).join("\n")}`
        : "";
      return `${header}\n${attribution}\n\n${entry.artifact}${returnedFiles}`;
    })
    .join("\n\n---\n\n");
  if (missing.length === 0) return body;
  return (
    `**${artifacts.length - missing.length} of ${artifacts.length} orders returned.** ` +
    `Order(s) ${missing.join(", ")} did not.\n\n${body}`
  );
}

async function callDelegate(params) {
  const args = params.arguments ?? {};
  const cfg = config();
  const orders = normalizeOrders(args);
  const timeoutSeconds = Math.min(
    3600,
    Math.max(30, Number(args.timeoutSeconds ?? 3600)),
  );
  let pool = null;
  try {
    pool = await poolStatus(cfg);
  } catch {
    // The WebSocket below reports the actionable connection failure.
  }
  const artifacts = await delegate(
    orders,
    cfg,
    params._meta?.progressToken,
    timeoutSeconds,
    pool,
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

function claimOne(cfg, progressToken, timeoutSeconds) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl(cfg.relay, "/earn", cfg.token, cfg.name));
    let settled = false;

    const finish = (error, job, closeSocket) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (closeSocket) {
        try {
          socket.close();
        } catch {}
      }
      error ? reject(error) : resolve(job);
    };

    const timer = setTimeout(() => finish(null, null, true), timeoutSeconds * 1000);

    socket.addEventListener("open", () => {
      notify(progressToken, 0, 1, "waiting for one Overflow task");
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "job" && !activeClaim) {
        activeClaim = {
          id: message.id,
          order: message.order,
          socket,
          worker: cfg.name,
          requester: message.requester || "someone",
        };
        notify(progressToken, 1, 1, `claimed task ${message.id.slice(0, 4)}`);
        finish(null, activeClaim, false);
      } else if (message.type === "error") {
        finish(new Error(message.error || "Relay rejected the claim."), null, true);
      }
    });
    socket.addEventListener("error", () => {
      if (!settled) {
        finish(new Error(`Could not reach the Overflow relay at ${cfg.relay}.`), null, true);
      }
    });
    socket.addEventListener("close", () => {
      if (activeClaim?.socket === socket) activeClaim = null;
      if (!settled) finish(new Error("The task feed closed before a task arrived."), null, false);
    });
  });
}

function compactTitle(id, objective) {
  const text = objective.replace(/\s+/g, " ").trim();
  return `Overflow: tsk ${id.slice(0, 4)} ${text.slice(0, 48)}`;
}

function renderClaim(job) {
  const title = compactTitle(job.id, job.order.objective);
  return {
    content: [
      {
        type: "text",
        text:
          `Claimed Overflow task ${job.id}.\n\n` +
          `Requested by: ${job.requester || "someone"}\n\n` +
          `Rename this visible Codex task to: ${title}\n\n` +
          `# Objective\n${job.order.objective}\n\n` +
          `# Context\n${job.order.context || "No additional context supplied."}\n\n` +
          `# Expected artifact\n${job.order.expectedArtifact}\n\n` +
          `# Acceptance test\n${job.order.acceptanceTest}\n\n` +
          "Do this work in the current visible task. Do not spawn a hidden executor. " +
          "When the artifact is complete, call overflow_return with this exact job ID.",
      },
    ],
    structuredContent: {
      claimed: true,
      jobId: job.id,
      shortId: job.id.slice(0, 4),
      suggestedTitle: title,
      requester: job.requester || "someone",
      order: job.order,
    },
  };
}

async function callClaim(params) {
  if (activeClaim) return renderClaim(activeClaim);
  if (pendingClaim) {
    throw new Error("This Codex task is already waiting for an Overflow order.");
  }
  const args = params.arguments ?? {};
  const timeoutSeconds = Math.min(
    3600,
    Math.max(30, Number(args.timeoutSeconds ?? 3600)),
  );
  pendingClaim = true;
  try {
    const job = await claimOne(config(), params._meta?.progressToken, timeoutSeconds);
    if (!job) {
      return {
        content: [
          {
            type: "text",
            text: `No task arrived within ${timeoutSeconds}s. Nothing was claimed or run.`,
          },
        ],
        structuredContent: { claimed: false },
      };
    }
    return renderClaim(job);
  } finally {
    pendingClaim = false;
  }
}

function returnActiveJob(jobId, artifact, status, files) {
  return new Promise((resolve, reject) => {
    const claim = activeClaim;
    if (!claim || claim.id !== jobId) {
      reject(new Error("This visible Codex task does not hold that Overflow job."));
      return;
    }
    const socket = claim.socket;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      activeClaim = null;
      try {
        socket.close();
      } catch {}
    };
    const finish = (error, delivered) => {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(error) : resolve(delivered);
    };
    const onMessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "returned" && message.id === jobId) {
        finish(null, Boolean(message.delivered));
      } else if (message.type === "error") {
        finish(new Error(message.error || "Relay rejected the artifact."));
      }
    };
    const onClose = () => finish(new Error("The relay closed before confirming return."));
    const timer = setTimeout(
      () => finish(new Error("The relay did not confirm the return within 15s.")),
      15_000,
    );

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.send(JSON.stringify({ type: "result", id: jobId, status, artifact, files }));
  });
}

async function callReturn(params) {
  const args = params.arguments ?? {};
  const jobId = requireString(args.jobId, "jobId");
  const artifact = requireString(args.artifact, "artifact");
  if (Buffer.byteLength(artifact, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("artifact exceeds the 600 KB return limit");
  }
  const files = readReturnFiles(args.files);
  const status = args.status === "failed" ? "failed" : "completed";
  const delivered = await returnActiveJob(jobId, artifact, status, files);
  return {
    content: [
      {
        type: "text",
        text: delivered
          ? `Returned Overflow task ${jobId.slice(0, 4)}${files.length ? ` with ${files.length} file(s)` : ""} to its requester.`
          : `Finished Overflow task ${jobId.slice(0, 4)}, but its requester is no longer connected.`,
      },
    ],
    structuredContent: { returned: true, delivered, jobId, status, files: files.map(({ dataBase64, ...file }) => file) },
  };
}

async function callJoin(params) {
  const args = params.arguments ?? {};
  const current = config();
  const inviteCode =
    typeof args.inviteCode === "string" && args.inviteCode.trim()
      ? args.inviteCode.trim()
      : current.token;
  const relay =
    typeof args.relay === "string" && args.relay.trim()
      ? args.relay.trim()
      : current.relay;
  const name =
    typeof args.name === "string" && args.name.trim()
      ? args.name.trim()
      : current.name;
  const check = new URL("/status", relay);
  check.searchParams.set("token", inviteCode);
  const response = await fetch(check, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 401) throw new Error("That pool rejected this invite code.");
  if (!response.ok) throw new Error(`The relay answered ${response.status}.`);
  const pool = await response.json();
  writeConfig({ relay, token: inviteCode, name });
  return {
    content: [
      {
        type: "text",
        text:
          `This machine is in the pool as "${name}". ` +
          `${pool.queued ?? 0} order(s) are waiting. Open a dedicated task and run /earn to take one.`,
      },
    ],
    structuredContent: { name, relay, queued: pool.queued ?? 0 },
  };
}

async function callPool() {
  const pool = await poolStatus(config());
  const names = (pool.workers || []).map(
    (worker) => `${worker.name}${worker.busy ? " — working" : " — waiting"}`,
  );
  return {
    content: [
      {
        type: "text",
        text:
          `${pool.earners} visible /earn session(s): ${names.join(", ") || "none"}.\n` +
          `${pool.idle} waiting, ${pool.queued} order(s) queued.\n` +
          (activeClaim
            ? `This task holds job ${activeClaim.id.slice(0, 4)}.`
            : pendingClaim
              ? "This task is waiting for a job."
              : "This task is not earning."),
      },
    ],
    structuredContent: {
      ...pool,
      thisTaskWaiting: pendingClaim,
      thisTaskJobId: activeClaim?.id ?? null,
    },
  };
}

const ORDER_SCHEMA = {
  type: "object",
  properties: {
    objective: { type: "string", description: "Exact outcome the worker must produce." },
    context: {
      type: "string",
      description: "Everything the worker needs from this conversation or machine.",
    },
    expectedArtifact: { type: "string", description: "Concrete shape of the response." },
    acceptanceTest: { type: "string", description: "How the requester will judge it." },
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
      serverInfo: { name: "Overflow", version: "0.3.0" },
      instructions:
        "Overflow never runs hidden workers. When starting any Overflow workflow, open " +
        "https://overflow.kushalsm.com in the user's Codex browser panel if it is not already open. " +
        "The configured Overflow name is machine-wide: use it for every requested and claimed order, " +
        "and never invent a task-specific identity or rename it without an explicit user request. " +
        "Use overflow_delegate when the user asks to offload work. " +
        "Only call overflow_claim when the user explicitly starts earning; do the claimed work in this " +
        "visible task, rename it, and call overflow_return with the finished artifact.",
    });
    return;
  }
  if (method === "ping") return sendResult(id, {});
  if (method === "notifications/initialized" || method === "initialized") return;

  if (method === "tools/list") {
    sendResult(id, {
      tools: [
        {
          name: DELEGATE_TOOL,
          title: "Delegate work through Overflow",
          description:
            "Queue one or more bounded orders and park until visible /earn sessions return the artifacts.",
          inputSchema: {
            type: "object",
            properties: {
              orders: {
                type: "array",
                items: ORDER_SCHEMA,
                minItems: 1,
                maxItems: 8,
              },
              timeoutSeconds: {
                type: "integer",
                minimum: 30,
                maximum: 3600,
                default: 3600,
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
        {
          name: CLAIM_TOOL,
          title: "Take one Overflow task",
          description:
            "Wait for and claim one queued order for this visible Codex task. Use only after the user explicitly asks to earn or take work.",
          inputSchema: {
            type: "object",
            properties: {
              timeoutSeconds: {
                type: "integer",
                minimum: 30,
                maximum: 3600,
                default: 3600,
              },
            },
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
        },
        {
          name: RETURN_TOOL,
          title: "Return completed Overflow work",
          description:
            "Return the artifact produced in this visible Codex task to the original requester.",
          inputSchema: {
            type: "object",
            properties: {
              jobId: { type: "string" },
              artifact: { type: "string" },
              files: {
                type: "array",
                maxItems: MAX_FILES,
                description: "Optional local files to deliver with the artifact. The plugin reads and transfers them directly.",
                items: {
                  type: "object",
                  properties: {
                    path: { type: "string", description: "Absolute or working-directory-relative local file path." },
                    name: { type: "string", description: "Optional filename shown to the requester." },
                  },
                  required: ["path"],
                  additionalProperties: false,
                },
              },
              status: { type: "string", enum: ["completed", "failed"], default: "completed" },
            },
            required: ["jobId", "artifact"],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
        },
        {
          name: STATUS_TOOL,
          title: "Show the Overflow pool",
          description: "Show waiting /earn sessions, queued work, and this task's state.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
        {
          name: JOIN_TOOL,
          title: "Configure this Overflow pool",
          description:
            "Persist this computer's machine-wide pool name, relay, or invite code for every future task. Use only when the user explicitly asks to join or rename this computer.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              relay: { type: "string" },
              inviteCode: { type: "string" },
            },
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
        },
      ],
    });
    return;
  }

  if (method === "tools/call") {
    try {
      if (params?.name === DELEGATE_TOOL) return sendResult(id, await callDelegate(params));
      if (params?.name === CLAIM_TOOL) return sendResult(id, await callClaim(params));
      if (params?.name === RETURN_TOOL) return sendResult(id, await callReturn(params));
      if (params?.name === STATUS_TOOL) return sendResult(id, await callPool());
      if (params?.name === JOIN_TOOL) return sendResult(id, await callJoin(params));
      return sendError(id, INVALID_PARAMS, `Unknown tool: ${params?.name ?? ""}`);
    } catch (error) {
      return sendError(
        id,
        INVALID_PARAMS,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (id !== undefined) sendError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    await handleRequest(JSON.parse(line));
  } catch (error) {
    sendError(null, INVALID_PARAMS, error instanceof Error ? error.message : String(error));
  }
}
