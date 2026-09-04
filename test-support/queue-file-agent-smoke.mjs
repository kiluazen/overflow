#!/usr/bin/env node
// Agent-level test scaffolding. Queues one file-producing job for a separately
// launched Codex session and verifies that the returned file crosses the relay.

import fs from "node:fs";
import path from "node:path";

import { DEFAULT_POOL_TOKEN, DEFAULT_RELAY } from "../plugins/codex/lib/config.mjs";

const url = new URL("/delegate", DEFAULT_RELAY.replace(/^http/, "ws"));
url.searchParams.set("token", DEFAULT_POOL_TOKEN);
url.searchParams.set("name", "file-agent-smoke-requester");

const expected = "OVERFLOW_AGENT_FILE_OK\n";
const socket = new WebSocket(url);
const timer = setTimeout(() => {
  console.error("FAIL no returned file within 5 minutes");
  socket.close();
  process.exit(1);
}, 300_000);

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "submit",
    orders: [{
      objective: "Create and return one deterministic text file.",
      context: "Write exactly OVERFLOW_AGENT_FILE_OK followed by one newline to /tmp/overflow-agent-file-smoke.txt.",
      expectedArtifact: "A one-sentence summary plus the actual text file attached through overflow_return.files.",
      acceptanceTest: "The returned file bytes equal OVERFLOW_AGENT_FILE_OK followed by one newline.",
    }],
  }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "accepted") console.log(`QUEUED ${message.batch}`);
  if (message.type === "result") {
    clearTimeout(timer);
    const file = message.files?.[0];
    if (!file) throw new Error("no file returned");
    const bytes = Buffer.from(file.dataBase64, "base64");
    if (bytes.toString("utf8") !== expected) throw new Error("returned bytes did not match");
    const destination = "/tmp/overflow-agent-file-return";
    fs.mkdirSync(destination, { recursive: true });
    const filePath = path.join(destination, path.basename(file.name));
    fs.writeFileSync(filePath, bytes);
    console.log(`PASS ${filePath}`);
    socket.close();
    process.exit(0);
  }
});

socket.addEventListener("error", () => {
  clearTimeout(timer);
  console.error("FAIL requester socket error");
  process.exit(1);
});
