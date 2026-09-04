#!/usr/bin/env node
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
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    // Not paired yet.
  }
  return {
    relay: process.env.OVERFLOW_RELAY || stored.relay || "",
    token: process.env.OVERFLOW_TOKEN || stored.token || "",
    name: process.env.OVERFLOW_NAME || stored.name || os.hostname(),
  };
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

function log(message) {
  process.stdout.write(`${new Date().toTimeString().slice(0, 8)}  ${message}\n`);
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
  });

  socket.addEventListener("close", () => {
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

const [command, ...rest] = process.argv.slice(2);

if (command === "pair") {
  pair(rest[0], rest[1], rest[2]);
} else if (command === "status") {
  const cfg = readConfig();
  if (!cfg.relay) {
    process.stderr.write("not paired — run: overflow pair <relay-url> <invite-code>\n");
    process.exit(1);
  }
  const url = new URL("/status", cfg.relay);
  url.searchParams.set("token", cfg.token);
  const response = await fetch(url);
  process.stdout.write(`${await response.text()}\n`);
} else {
  const cfg = readConfig();
  if (!cfg.relay || !cfg.token) {
    process.stderr.write("not paired — run: overflow pair <relay-url> <invite-code>\n");
    process.exit(1);
  }
  const state = { backoff: RECONNECT_MIN_MS, completed: 0 };
  process.on("SIGINT", () => {
    log(`stopped after finishing ${state.completed} job(s)`);
    process.exit(0);
  });
  connect(cfg, state);
}
