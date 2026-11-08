// Registered OAuth clients must never expire.
//
// workers-oauth-provider defaults clientRegistrationTTL to 90 days and writes
// every client:<id> to KV with that expiration. ChatGPT registers ONE client
// per app and reuses it for every user, so when it expires every new connect
// fails on /authorize (Nexus outage, 2026-11-07). This registers a client
// against the real worker in workerd and reads the KV key's expiration back.
import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("stores a client registered through /register without a KV expiration", async () => {
  const res = await SELF.fetch("https://overflow.kushalsm.com/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      token_endpoint_auth_method: "none",
      client_name: "ChatGPT",
    }),
  });
  const text = await res.text();
  expect(res.status, text).toBe(201);
  const { client_id, client_secret_expires_at } = JSON.parse(text);
  expect(client_secret_expires_at ?? 0).toBe(0);
  const { keys } = await env.OAUTH_KV.list({ prefix: `client:${client_id}` });
  expect(keys).toHaveLength(1);
  expect(keys[0].expiration).toBeUndefined();
});
