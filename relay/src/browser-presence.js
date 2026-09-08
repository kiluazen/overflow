// Browser identity is only used to attribute presence. Reading the board never
// requires a cookie, and this session cannot authorize queue or artifact tools.
const COOKIE = "__Host-overflow-presence";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const HANDOFF_SECONDS = 60;

export function cookieValue(request, name) {
  return (request.headers.get("cookie") || "").split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

export function browserCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function tokenHash(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function session(env, request) {
  const token = cookieValue(request, COOKIE);
  if (!/^[a-f0-9-]{72}$/.test(token)) return null;
  const id = await tokenHash(token);
  const raw = await env.OAUTH_KV.get(`presence-session:${id}`);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value.userId && value.expiresAt > Date.now() ? { ...value, id } : null;
  } catch { return null; }
}

export async function createPresenceCookie(env, userId) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.OAUTH_KV.put(`presence-session:${await tokenHash(token)}`, JSON.stringify({
    userId, expiresAt: Date.now() + SESSION_SECONDS * 1000,
  }), { expirationTtl: SESSION_SECONDS });
  return browserCookie(COOKIE, token, SESSION_SECONDS);
}

export async function consumeOnce(env, userId, namespace, id, expiresAt) {
  const pool = env.POOL.get(env.POOL.idFromName("global"));
  const response = await pool.fetch("https://overflow.internal/rpc/consume-once", {
    method: "POST",
    headers: { "content-type": "application/json", "x-overflow-user-id": userId },
    body: JSON.stringify({ namespace, id, expiresAt }),
  });
  return response.ok;
}

export async function createDashboardHandoff(env, userId) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.OAUTH_KV.put(`presence-handoff:${await tokenHash(token)}`, JSON.stringify({
    userId, expiresAt: Date.now() + HANDOFF_SECONDS * 1000,
  }), { expirationTtl: HANDOFF_SECONDS });
  return `https://overflow.kushalsm.com/presence/connect/${token}`;
}

export async function acceptDashboardHandoff(request, env) {
  const token = new URL(request.url).pathname.split("/").pop();
  const headers = new Headers({ location: "/", "cache-control": "no-store", "referrer-policy": "no-referrer" });
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (!/^[a-f0-9-]{72}$/.test(token)) return new Response(null, { status: 303, headers });
  const hash = await tokenHash(token);
  const key = `presence-handoff:${hash}`;
  const raw = await env.OAUTH_KV.get(key);
  if (!raw) return new Response(null, { status: 303, headers });
  let value;
  try { value = JSON.parse(raw); } catch { return new Response(null, { status: 303, headers }); }
  if (value.expiresAt > Date.now() && value.userId &&
      await consumeOnce(env, value.userId, "presence", hash, value.expiresAt)) {
    headers.append("set-cookie", await createPresenceCookie(env, value.userId));
  }
  await env.OAUTH_KV.delete(key);
  return new Response(null, { status: 303, headers });
}

export async function browserHeartbeat(request, env) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return new Response("Invalid origin", { status: 403 });
  }
  const identity = await session(env, request);
  if (!identity) return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  const body = await request.json().catch(() => null);
  if (!body || !/^[a-f0-9-]{36}$/.test(body.pageId || "") || typeof body.visible !== "boolean") {
    return new Response("Invalid presence event", { status: 400 });
  }
  const pool = env.POOL.get(env.POOL.idFromName("global"));
  const response = await pool.fetch("https://overflow.internal/rpc/browser-presence", {
    method: "POST",
    headers: { "content-type": "application/json", "x-overflow-user-id": identity.userId },
    body: JSON.stringify({ sessionId: `${identity.id}:${body.pageId}`, visible: body.visible }),
  });
  return new Response(null, { status: response.ok ? 204 : response.status, headers: { "cache-control": "no-store" } });
}
