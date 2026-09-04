#!/usr/bin/env node

import crypto from "node:crypto";
import http from "node:http";

const BASE = "https://overflow.kushalsm.com";
const PORT = 49631;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

async function json(response) {
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${body}`);
  return body ? JSON.parse(body) : {};
}

function callbackServer() {
  let resolve;
  let reject;
  const completion = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, REDIRECT_URI);
    if (url.pathname !== "/callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    response.writeHead(error || !code ? 400 : 200, { "content-type": "text/html; charset=utf-8" });
    response.end(error || !code
      ? "<h1>Overflow sign-in failed</h1><p>Return to the terminal test.</p>"
      : "<h1>Overflow connected</h1><p>The authenticated MCP test is continuing.</p>");
    if (error || !code) reject(new Error(error || "missing authorization code"));
    else resolve({ code, state });
  });
  return new Promise((ready) => {
    server.listen(PORT, "127.0.0.1", () => ready({ server, completion }));
  });
}

async function parseMcpResponse(response, expectedId) {
  const body = await response.text();
  if (!response.ok) throw new Error(`MCP ${response.status}: ${body}`);
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const message = JSON.parse(line.slice(5).trim());
      if (message.id === expectedId) return message;
    }
    throw new Error(`MCP response ${expectedId} missing from event stream`);
  }
  return JSON.parse(body);
}

async function main() {
  const { server, completion } = await callbackServer();
  try {
    const registration = await json(await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Overflow production E2E",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }));

    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    const state = base64url(crypto.randomBytes(24));
    const authorization = new URL(`${BASE}/authorize`);
    authorization.searchParams.set("client_id", registration.client_id);
    authorization.searchParams.set("redirect_uri", REDIRECT_URI);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("scope", "openid profile email overflow:connect");
    authorization.searchParams.set("resource", `${BASE}/mcp`);
    authorization.searchParams.set("state", state);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");

    console.log(`AUTH_URL=${authorization}`);
    const callback = await completion;
    if (callback.state !== state) throw new Error("OAuth state mismatch");

    const tokens = await json(await fetch(`${BASE}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: registration.client_id,
        redirect_uri: REDIRECT_URI,
        code: callback.code,
        code_verifier: verifier,
        resource: `${BASE}/mcp`,
      }),
    }));
    if (!tokens.access_token) throw new Error("Overflow returned no access token");

    let id = 0;
    async function mcp(method, params = {}) {
      id += 1;
      const response = await fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${tokens.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      const message = await parseMcpResponse(response, id);
      if (message.error) throw new Error(JSON.stringify(message.error));
      return message.result;
    }

    await mcp("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "overflow-production-e2e", version: "1" },
    });
    const tools = await mcp("tools/list");
    const names = tools.tools.map((tool) => tool.name).sort();
    for (const required of ["overflow_claim", "overflow_collect", "overflow_delegate", "overflow_pool", "overflow_return"]) {
      if (!names.includes(required)) throw new Error(`missing MCP tool ${required}`);
    }

    const delegated = await mcp("tools/call", {
      name: "overflow_delegate",
      arguments: {
        orders: [{
          objective: "[E2E] Return the exact phrase Overflow round trip passed",
          context: "This is an automated production transport test.",
          expectedArtifact: "Plain text",
          acceptanceTest: "The artifact exactly matches the requested phrase.",
        }],
        timeoutSeconds: 30,
        waitForResult: false,
      },
    });
    const batch = delegated.structuredContent?.batch;
    if (!batch) throw new Error("delegate returned no batch ID");

    const claimed = await mcp("tools/call", {
      name: "overflow_claim",
      arguments: { timeoutSeconds: 5 },
    });
    const jobId = claimed.structuredContent?.jobId;
    if (!jobId) throw new Error("claim returned no job ID");

    await mcp("tools/call", {
      name: "overflow_return",
      arguments: {
        jobId,
        artifact: "Overflow round trip passed",
        status: "completed",
        files: [],
      },
    });
    const collected = await mcp("tools/call", {
      name: "overflow_collect",
      arguments: { batch },
    });
    if (!collected.structuredContent?.complete) throw new Error("collected batch is not complete");
    if (collected.structuredContent.results?.[0]?.result?.artifact !== "Overflow round trip passed") {
      throw new Error("returned artifact changed in transit");
    }

    console.log(`PASS authenticated MCP tools: ${names.join(", ")}`);
    console.log("PASS delegate -> claim -> return -> collect");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
