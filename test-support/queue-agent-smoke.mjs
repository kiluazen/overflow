#!/usr/bin/env node
// Queue one deterministic order while a separately started Codex session runs
// `/earn`. This requester is test scaffolding and is not part of the plugin.

import fs from "node:fs";
import path from "node:path";

import { DEFAULT_POOL_TOKEN, DEFAULT_RELAY } from "../plugins/codex/lib/config.mjs";

const url = new URL("/delegate", DEFAULT_RELAY.replace(/^http/, "ws"));
url.searchParams.set("token", DEFAULT_POOL_TOKEN);
url.searchParams.set("name", "agent-smoke-requester");

const order = {
  objective: "Research Arecana's global use and produce a sourced slide deck covering the latest six months.",
  context: "Arecana means the arecanut-palm-leaf tableware brand associated with Tamul Plates Marketing in India, not areca nut consumption. Cover 2026-03-04 through 2026-09-04 where current evidence exists: products and use cases, countries or regions reached, exports or shipment activity, production or sales indicators, company developments, and the strongest available quantitative signals. Separate brand-specific numbers from broader areca-leaf tableware market numbers. Use current primary sources and clearly dated trade or company records; label gaps instead of inventing data.",
  expectedArtifact: "A polished 8-10 slide .pptx deck with a title slide, executive summary, global footprint, use cases, six-month evidence/timeline, quantitative evidence, limitations, and linked sources. Also return a two-sentence summary and attach the actual .pptx file through overflow_return.files.",
  acceptanceTest:
    "A real .pptx file is returned; every material number has a dated source; Arecana-specific evidence is not conflated with the wider market; the deck states when six-month figures are unavailable; and slides are legible without requiring narration.",
};

const timeoutHours = 6;
let socket = null;
let claimed = false;
let completed = false;
let lastPongAt = Date.now();

const timeout = setTimeout(() => {
  console.error(`FAIL no result within ${timeoutHours} hours`);
  completed = true;
  socket?.close();
  process.exit(1);
}, timeoutHours * 60 * 60 * 1000);

const heartbeat = setInterval(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (Date.now() - lastPongAt > 90_000) {
    console.error("RECONNECTING requester heartbeat expired");
    socket.close();
    return;
  }
  socket.send(JSON.stringify({ type: "ping" }));
}, 30_000);

function connect() {
  claimed = false;
  lastPongAt = Date.now();
  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "submit", orders: [order] }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "pong") lastPongAt = Date.now();
    if (message.type === "accepted") console.log(`QUEUED ${message.batch}`);
    if (message.type === "progress" && message.state === "claimed") {
      claimed = true;
      console.log(`CLAIMED ${message.job} by ${message.worker}`);
    }
    if (message.type === "result") {
      completed = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      console.log(`RESULT ${message.status} from ${message.worker}`);
      console.log(message.artifact);
      const destination = path.join("/Users/kushalsm/solo/research/overflow-returns", message.job);
      for (const [index, file] of (message.files || []).entries()) {
        const name = path.basename(file.name || `artifact-${index + 1}`);
        fs.mkdirSync(destination, { recursive: true });
        const filePath = path.join(destination, name);
        fs.writeFileSync(filePath, Buffer.from(file.dataBase64, "base64"));
        console.log(`SAVED ${filePath}`);
      }
      socket.close();
      process.exit(message.status === "completed" ? 0 : 1);
    }
  });
  socket.addEventListener("error", () => {
    console.error("REQUESTER socket error");
  });
  socket.addEventListener("close", () => {
    if (completed) return;
    if (claimed) {
      console.error("FAIL requester disconnected after the job was claimed");
      clearTimeout(timeout);
      clearInterval(heartbeat);
      process.exit(1);
    }
    console.error("RECONNECTING requester before claim");
    setTimeout(connect, 1_000);
  });
}

connect();
