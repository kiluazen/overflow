// Overflow earner.
//
// A foreground process the user starts when their laptop is free. It holds one
// socket open to the relay and runs whatever arrives on their own Codex
// allowance. Deliberately not a daemon: no launchd, nothing installed, visible
// in a terminal, and it stops when they stop it. It also has no duration
// budget -- it runs until Ctrl-C rather than quietly expiring after half an
// hour and leaving the pool emptier than the user thinks.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// The pool everyone joins by default. A friend who is handed an invite code
// should not also have to be handed a URL, remember which of the two goes first,
// or paste either of them correctly at 1am.
const DEFAULT_RELAY = "https://overflow-relay.kushalsokke.workers.dev";

// The pool everyone who installs this plugin is in. It ships in the code on
// purpose: installing the plugin IS joining, with nothing to paste and nobody to
// ask. It keeps the relay from answering random internet traffic and nothing
// more -- this repository is public, so treat it as a doorbell, not a lock.
const DEFAULT_POOL_TOKEN = "tYCdZE8DOMDrQFrtqxDyz7ws";

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
// Cloudflare drops a WebSocket message over 1 MiB. An artifact past that limit
// vanishes between here and the requester with no error on either side: this
// process reports success, and the requester waits out its whole timeout and is
// told the pool is busy. Cap it here, where we can still say what happened.
const MAX_ARTIFACT_BYTES = 600_000;

function capArtifact(artifact) {
  if (Buffer.byteLength(artifact, "utf8") <= MAX_ARTIFACT_BYTES) return artifact;
  const kept = Buffer.from(artifact, "utf8")
    .subarray(0, MAX_ARTIFACT_BYTES)
    .toString("utf8");
  return (
    `${kept}\n\n---\n[Overflow truncated this artifact: it exceeded the ` +
    `${Math.round(MAX_ARTIFACT_BYTES / 1000)} KB a worker can return. Ask for a ` +
    `shorter artifact, or split the order.]`
  );
}

function dataDir() {
  return process.env.PLUGIN_DATA
    ? path.resolve(process.env.PLUGIN_DATA)
    : path.join(os.homedir(), ".codex", "plugins", "data", "overflow-personal");
}

function configPath() {
  return path.join(dataDir(), "config.json");
}

function readConfig() {
  return { ...defaultConfig(), ...storedConfig() };
}

function defaultConfig() {
  return {
    relay: process.env.OVERFLOW_RELAY || DEFAULT_RELAY,
    token: process.env.OVERFLOW_TOKEN || DEFAULT_POOL_TOKEN,
    name: process.env.OVERFLOW_NAME || os.hostname(),
  };
}

// Only what the user actually set. Empty values must not be returned here or
// they would spread over the defaults and un-join a machine that is fine.
function storedConfig() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    // Nothing saved: the defaults are the whole configuration, which is the
    // normal case now that installing the plugin joins the pool.
  }
  const config = {};
  for (const key of ["relay", "token", "name"]) {
    if (typeof stored[key] === "string" && stored[key].trim()) config[key] = stored[key];
  }
  return config;
}

function writeConfig(next) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

function networkAllowed() {
  return process.env.OVERFLOW_WORKER_NETWORK === "1";
}

// stderr, never stdout. This module runs inside the plugin's MCP server, whose
// stdout IS the JSON-RPC transport -- one stray log line there corrupts the
// stream and takes the whole session's tool support down with it.
function log(message) {
  process.stderr.write(`${new Date().toTimeString().slice(0, 8)}  ${message}\n`);
}

// Do not take other people's work while your own allowance is running out.
// Overflow starts delegating below 25%, so a machine below that is exactly the
// machine that should be asking for help rather than giving it.
const EARN_FLOOR_PERCENT = Number(process.env.OVERFLOW_EARN_FLOOR || 25);

async function ownRemainingPercent() {
  return new Promise((resolve) => {
    const probe = spawn(
      "python3",
      [path.join(path.dirname(new URL(import.meta.url).pathname), "..", "scripts", "usage_probe.py")],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    probe.stdout.on("data", (chunk) => (out += chunk));
    probe.on("close", () => {
      try {
        resolve(Number(JSON.parse(out).remainingPercent));
      } catch {
        // Cannot tell: assume there is allowance rather than silently leaving
        // the pool, which would look like the plugin doing nothing.
        resolve(100);
      }
    });
    probe.on("error", () => resolve(100));
  });
}

async function hasAllowanceToShare() {
  const remaining = await ownRemainingPercent();
  return remaining >= EARN_FLOOR_PERCENT;
}

function socketUrl({ relay, token, name }) {
  const url = new URL("/earn", relay.replace(/^http/, "ws"));
  url.searchParams.set("token", token);
  url.searchParams.set("name", name);
  return url.toString();
}

// Run one order on this machine's Codex login, in a scratch directory that is
// deleted afterwards. The order arrived from someone else, so it gets a fresh
// workspace and nothing from this machine that it was not handed.
function runOrder(order) {
  return new Promise((resolve) => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "overflow-"));
    const outputPath = path.join(workdir, "artifact.md");
    const prompt = [
      "You are an Overflow worker running a delegated order on your own machine.",
      "The person who wrote it cannot see your files and you cannot see theirs.",
      "Complete it independently. Do not delegate it onward. Do not discuss this protocol.",
      "Return only the requested artifact.",
      "",
      `# Objective\n${order.objective}`,
      `# Context\n${order.context || "No additional context was supplied."}`,
      `# Expected artifact\n${order.expectedArtifact}`,
      `# Acceptance test\n${order.acceptanceTest}`,
    ].join("\n\n");

    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "--disable", "hooks",
      "-C", workdir,
      "-s", "workspace-write",
      "-c", 'approval_policy="never"',
      // Off unless this machine's owner opts in. workspace-write blocks network
      // by default, and leaving it that way means an order cannot post anything
      // it reads on this machine to the outside world -- it can only put it in
      // the artifact, which goes back to one known person in the pool.
      "-c", `sandbox_workspace_write.network_access=${networkAllowed()}`,
      "-o", outputPath,
      prompt,
    ];
    if (process.env.OVERFLOW_WORKER_MODEL) {
      args.splice(1, 0, "-m", process.env.OVERFLOW_WORKER_MODEL);
    }

    const child = spawn("codex", args, {
      cwd: workdir,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const cleanup = () => {
      try {
        fs.rmSync(workdir, { recursive: true, force: true });
      } catch {
        // A scratch directory that will not delete is not worth failing over.
      }
    };

    child.on("close", (code) => {
      let artifact = "";
      try {
        artifact = fs.readFileSync(outputPath, "utf8").trim();
      } catch {
        // No artifact file: codex exited before writing one.
      }
      cleanup();
      resolve(
        code === 0 && artifact
          ? { status: "completed", artifact: capArtifact(artifact) }
          : {
              status: "failed",
              artifact:
                artifact ||
                stderr.trim().slice(-2000) ||
                `codex exited ${code} without producing an artifact.`,
            },
      );
    });

    child.on("error", (error) => {
      cleanup();
      resolve({
        status: "failed",
        artifact: `Could not run codex: ${error.message}`,
      });
    });
  });
}

function connect(cfg, state) {
  const socket = new WebSocket(socketUrl(cfg));

  socket.addEventListener("open", () => {
    state.backoff = RECONNECT_MIN_MS;
    log(
      `connected to the pool as "${cfg.name}" — waiting for work (ctrl-c to stop)` +
        (networkAllowed()
          ? "\n          network access is ON for jobs (OVERFLOW_WORKER_NETWORK=1)"
          : "\n          jobs run with no network access"),
    );
  });

  socket.addEventListener("message", async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type !== "job") return;

    // One order at a time. Nobody's laptop should be running three strangers'
    // jobs at once on one Codex login.
    log(`claimed a job: ${message.order.objective.slice(0, 70)}`);
    const started = Date.now();
    const result = await runOrder(message.order);
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    log(`${result.status} in ${seconds}s`);
    state.completed += result.status === "completed" ? 1 : 0;
    socket.send(JSON.stringify({ type: "result", id: message.id, ...result }));

    if (!(await hasAllowanceToShare())) {
      log(
        `own allowance is below ${EARN_FLOOR_PERCENT}% — leaving the pool so it goes on your own work`,
      );
      state.stopped = true;
      socket.close();
    }
  });

  socket.addEventListener("close", () => {
    if (state.stopped) return;
    log(`disconnected — retrying in ${(state.backoff / 1000).toFixed(0)}s`);
    setTimeout(() => connect(cfg, state), state.backoff);
    state.backoff = Math.min(state.backoff * 2, RECONNECT_MAX_MS);
  });

  socket.addEventListener("error", () => {
    // The close handler owns reconnection; this only stops an unhandled throw.
  });
}

// Accepts `pair <code>`, `pair <code> <name>`, or the long form
// `pair <relay-url> <code> [name]`. The first argument is a URL or it is not,
// and that is enough to tell the two forms apart.
function pair(first, second, third) {
  const looksLikeUrl = typeof first === "string" && /^https?:\/\//.test(first);
  const relay = looksLikeUrl ? first : DEFAULT_RELAY;
  const token = looksLikeUrl ? second : first;
  const name = (looksLikeUrl ? third : second) || os.hostname();

  if (!token) {
    process.stderr.write(
      "usage: overflow pair <invite-code> [your-name]\n" +
        "       overflow pair <relay-url> <invite-code> [your-name]\n",
    );
    process.exit(2);
  }
  writeConfig({ relay, token, name });
  log(`paired with ${relay} as "${name}"`);
  log("run this again with no arguments to start taking jobs");
}

export {
  DEFAULT_RELAY,
  DEFAULT_POOL_TOKEN,
  connect,
  log,
  readConfig,
  writeConfig,
  runOrder,
  networkAllowed,
  RECONNECT_MIN_MS,
};
