const SESSION_COOKIE = "__Host-overflow-session";
const LOGIN_COOKIE = "__Host-overflow-login";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function cookie(request, name) {
  return (request.headers.get("cookie") || "").split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function setCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function sessionKey(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `dashboard:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function startDashboardLogin(request, env) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const nonce = crypto.randomUUID();
  const browserNonce = crypto.randomUUID();
  await env.OAUTH_KV.put(`consent:${nonce}`, JSON.stringify({
    _dashboard: true, _browserNonce: browserNonce,
  }), { expirationTtl: 600 });
  return new Response(null, { status: 302, headers: {
    location: `/auth/google/start?nonce=${nonce}`,
    "set-cookie": setCookie(LOGIN_COOKIE, browserNonce, 600),
    "cache-control": "no-store",
  } });
}

export function dashboardLoginMatches(request, parsed) {
  return Boolean(parsed._browserNonce && cookie(request, LOGIN_COOKIE) === parsed._browserNonce);
}

export async function finishDashboardLogin(env, identity) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.OAUTH_KV.put(await sessionKey(token), JSON.stringify({
    ...identity, expiresAt: Date.now() + SESSION_SECONDS * 1000,
  }), { expirationTtl: SESSION_SECONDS });
  const headers = new Headers({ location: "/", "cache-control": "no-store" });
  headers.append("set-cookie", setCookie(SESSION_COOKIE, token, SESSION_SECONDS));
  headers.append("set-cookie", setCookie(LOGIN_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

export async function dashboardIdentity(request, env) {
  const token = cookie(request, SESSION_COOKIE);
  if (!/^[a-f0-9-]{72}$/.test(token)) return null;
  const raw = await env.OAUTH_KV.get(await sessionKey(token));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    return session.userId && session.expiresAt > Date.now() ? session : null;
  } catch { return null; }
}

export async function dashboardAccount(request, env) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const identity = await dashboardIdentity(request, env);
  const headers = { "cache-control": "no-store", vary: "Cookie" };
  if (!identity) return Response.json({ signedIn: false }, { status: 401, headers });
  const pool = env.POOL.get(env.POOL.idFromName("global"));
  const response = await pool.fetch("https://overflow.internal/rpc/account", {
    headers: {
      "x-overflow-user-id": identity.userId,
      "x-overflow-display-name": identity.displayName,
      "x-overflow-email": identity.email,
    },
  });
  if (!response.ok) return Response.json({ error: "Your credits could not be loaded. Try again." }, { status: 503, headers });
  return Response.json({ signedIn: true, ...await response.json() }, { headers });
}

export async function logoutDashboard(request, env) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return new Response("Invalid origin", { status: 403 });
  }
  const token = cookie(request, SESSION_COOKIE);
  if (token) await env.OAUTH_KV.delete(await sessionKey(token));
  return new Response(null, { status: 204, headers: {
    "set-cookie": setCookie(SESSION_COOKIE, "", 0), "cache-control": "no-store",
  } });
}
