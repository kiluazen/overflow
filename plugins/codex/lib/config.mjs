import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Installing the plugin joins this small shared pool. The token is intentionally
// public for the trusted-friends prototype; it is routing, not authentication.
const DEFAULT_RELAY = "https://overflow-relay.kushalsokke.workers.dev";
const DEFAULT_POOL_TOKEN = "tYCdZE8DOMDrQFrtqxDyz7ws";

function dataDir() {
  return process.env.PLUGIN_DATA
    ? path.resolve(process.env.PLUGIN_DATA)
    : path.join(os.homedir(), ".codex", "plugins", "data", "overflow-personal");
}

function configPath() {
  return path.join(dataDir(), "config.json");
}

function defaultConfig() {
  return {
    relay: process.env.OVERFLOW_RELAY || DEFAULT_RELAY,
    token: process.env.OVERFLOW_TOKEN || DEFAULT_POOL_TOKEN,
    name: process.env.OVERFLOW_NAME || os.hostname(),
  };
}

function storedConfig() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
  const config = {};
  for (const key of ["relay", "token", "name"]) {
    if (typeof stored[key] === "string" && stored[key].trim()) {
      config[key] = stored[key].trim();
    }
  }
  return config;
}

function readConfig() {
  return { ...defaultConfig(), ...storedConfig() };
}

function writeConfig(next) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export {
  DEFAULT_POOL_TOKEN,
  DEFAULT_RELAY,
  dataDir,
  readConfig,
  writeConfig,
};
