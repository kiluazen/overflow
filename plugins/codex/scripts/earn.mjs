#!/usr/bin/env node
// Debugging entry point for the earner.
//
// Nobody needs this: the plugin's MCP server runs the earner by itself. It is
// kept so the earner can be driven on its own when something looks wrong.
import os from "node:os";
import { DEFAULT_RELAY, connect, log, readConfig, writeConfig, RECONNECT_MIN_MS } from "../lib/earner.mjs";

const [command, ...rest] = process.argv.slice(2);

if (command === "pair") {
  const looksLikeUrl = typeof rest[0] === "string" && /^https?:\/\//.test(rest[0]);
  const relay = looksLikeUrl ? rest[0] : DEFAULT_RELAY;
  const token = looksLikeUrl ? rest[1] : rest[0];
  const name = (looksLikeUrl ? rest[2] : rest[1]) || os.hostname();
  if (!token) {
    process.stderr.write("usage: earn.mjs pair <invite-code> [your-name]\n");
    process.exit(2);
  }
  writeConfig({ relay, token, name });
  log(`paired with ${relay} as "${name}"`);
} else if (command === "status") {
  const cfg = readConfig();
  if (!cfg.relay) { process.stderr.write("not paired\n"); process.exit(1); }
  const url = new URL("/status", cfg.relay);
  url.searchParams.set("token", cfg.token);
  process.stdout.write(`${await (await fetch(url)).text()}\n`);
} else {
  const cfg = readConfig();
  if (!cfg.relay || !cfg.token) { process.stderr.write("not paired\n"); process.exit(1); }
  connect(cfg, { backoff: RECONNECT_MIN_MS, completed: 0 });
}
