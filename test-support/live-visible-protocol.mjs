#!/usr/bin/env node
// Live relay smoke test for the visible-task protocol. This harness simulates
// two Codex conversations at the MCP boundary; it never invokes a model.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";

const root = path.resolve(import.meta.dirname, "..");
const serverPath = path.join(root, "plugins", "codex", "mcp", "server.mjs");

function start(name) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), `overflow-${name}-`));
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PLUGIN_DATA: data, OVERFLOW_NAME: name },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map();
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
  });
  let nextId = 1;
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return {
    data,
    child,
    call,
    close() {
      child.kill("SIGTERM");
      fs.rmSync(data, { recursive: true, force: true });
    },
  };
}

const requester = start("visible-test-requester");
const earner = start("visible-test-earner");

try {
  await requester.call("initialize", { protocolVersion: "2025-11-25" });
  await earner.call("initialize", { protocolVersion: "2025-11-25" });

  const order = {
    objective: "Return the exact visible-task smoke-test artifact.",
    context: "The artifact is: VISIBLE_OVERFLOW_ROUNDTRIP_OK",
    expectedArtifact: "One exact line.",
    acceptanceTest: "Exactly VISIBLE_OVERFLOW_ROUNDTRIP_OK",
  };
  const delegated = requester.call("tools/call", {
    name: "overflow_delegate",
    arguments: { orders: [order], timeoutSeconds: 60 },
  });
  const claimed = await earner.call("tools/call", {
    name: "overflow_claim",
    arguments: { timeoutSeconds: 60 },
  });
  assert.equal(claimed.structuredContent.claimed, true);
  assert.equal(claimed.structuredContent.requester, "visible-test-requester");
  assert.equal(claimed.structuredContent.order.objective, order.objective);
  assert.match(claimed.content[0].text, /Requested by: visible-test-requester/);
  assert.match(claimed.structuredContent.suggestedTitle, /^Overflow: tsk [0-9a-f]{4} /);

  const jobId = claimed.structuredContent.jobId;
  const deckPath = path.join(earner.data, "visible-test-deck.pptx");
  fs.writeFileSync(deckPath, "VISIBLE_DECK_BYTES");
  const returned = await earner.call("tools/call", {
    name: "overflow_return",
    arguments: {
      jobId,
      artifact: "VISIBLE_OVERFLOW_ROUNDTRIP_OK",
      files: [{ path: deckPath }],
    },
  });
  assert.equal(returned.structuredContent.delivered, true);
  assert.equal(returned.structuredContent.files[0].name, "visible-test-deck.pptx");

  const result = await delegated;
  assert.equal(result.structuredContent.returned, 1);
  assert.equal(
    result.structuredContent.results[0].artifact,
    "VISIBLE_OVERFLOW_ROUNDTRIP_OK",
  );
  const receivedDeck = result.structuredContent.results[0].files[0];
  assert.equal(fs.readFileSync(receivedDeck.path, "utf8"), "VISIBLE_DECK_BYTES");
  console.log("PASS visible claim -> work -> return protocol");
} finally {
  requester.close();
  earner.close();
}
