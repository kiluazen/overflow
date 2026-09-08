import { browserCookie, cookieValue, tokenHash, createPresenceCookie, consumeOnce } from "./browser-presence.js";

const CONSENT_TTL_SECONDS = 10 * 60;
const BASE = "https://overflow.kushalsm.com";
const POOL = "global";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clientLabel(redirectUri, fallback) {
  try {
    const host = new URL(redirectUri).hostname.toLowerCase();
    if (host.endsWith("chatgpt.com") || host.endsWith("openai.com")) return "ChatGPT / Codex";
    if (host.endsWith("claude.ai") || host.endsWith("claude.com")) return "Claude";
  } catch {}
  return fallback || "this application";
}

function consentHtml(nonce, clientName) {
  const client = escapeHtml(clientName);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect Overflow</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5ef url(/shoreline-v2.jpg) center bottom/cover no-repeat;color:#29342f;font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px}.card{width:min(420px,100%);padding:32px;border:1px solid #d5dbd1;border-radius:12px;background:#f5f5eff5}h1{font-size:27px;margin:0 0 10px}p{color:#606c63;line-height:1.55;margin:0 0 24px}.button{display:flex;justify-content:center;align-items:center;gap:10px;width:100%;padding:13px 16px;border-radius:10px;background:#376451;color:#fff;text-decoration:none;font-weight:700}.note{font-size:12px;margin:18px 0 0;color:#606c63}</style></head>
<body><main class="card"><h1>Connect Overflow</h1><p><b>${client}</b> wants to identify the work you delegate and complete.</p><a class="button" href="/auth/google/start?nonce=${encodeURIComponent(nonce)}">Continue with Google</a><p class="note">Your name, photo, credits, and last active appear on the shared board. Your email stays private.</p></main></body></html>`;
}

function setupHtml(id) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finish connecting Overflow</title><style>
  *{box-sizing:border-box}body{margin:0;padding:40px 20px;background:#f5f5ef;color:#29342f;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{max-width:640px;margin:0 auto}h1{font-size:30px;font-weight:500;letter-spacing:-1px;margin:0 0 12px}p{max-width:510px;margin:0 0 24px;color:#606c63}img{display:block;width:100%;height:auto;border-radius:12px;margin:24px 0}button{border:0;border-radius:8px;background:#376451;color:white;font:inherit;font-weight:500;padding:13px 22px;cursor:pointer}button:focus-visible{outline:3px solid #376451;outline-offset:4px}
  </style></head><body><main class="card"><h1>Google connected</h1><p>Return to Codex, open <b>Overflow → Hooks</b>, and approve the usage hook. This lets Overflow check when you have less than 10% allowance left.</p><img src="/setup-hooks-v1.png" width="1636" height="920" alt="Overflow plugin settings: the Hooks section is below Earn and Work."><form method="post" action="/auth/complete"><input type="hidden" name="setup" value="${escapeHtml(id)}"><button type="submit">Return to Codex</button></form></main></body></html>`;
}

export function profilePicture(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"))
      && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function errorHtml(message) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"/><title>Overflow</title></head><body><h1>Could not connect Overflow</h1><p>${escapeHtml(message)}</p></body></html>`, {
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function loadConsent(env, nonce) {
  const raw = await env.OAUTH_KV.get(`consent:${nonce}`);
  return raw ? JSON.parse(raw) : null;
}

export async function handleAuthorize(request, env) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 1) {
    const parsed = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const info = parsed.clientId ? await env.OAUTH_PROVIDER.lookupClient(parsed.clientId) : null;
    const nonce = crypto.randomUUID();
    await env.OAUTH_KV.put(
      `consent:${nonce}`,
      JSON.stringify({ ...parsed, _client: clientLabel(parsed.redirectUri, info?.clientName) }),
      { expirationTtl: CONSENT_TTL_SECONDS },
    );
    return Response.redirect(`${url.origin}/authorize/${nonce}`, 302);
  }
  const nonce = segments[1] || "";
  const parsed = await loadConsent(env, nonce);
  if (!parsed) return errorHtml("This sign-in link expired. Return to Codex and connect again.");
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return errorHtml("Google sign-in is not configured on the Overflow server yet.");
  }
  return new Response(consentHtml(nonce, parsed._client || "this application"), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleGoogleStart(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return new Response("Not found", { status: 404 });
  const nonce = new URL(request.url).searchParams.get("nonce") || "";
  if (!nonce || !(await loadConsent(env, nonce))) return errorHtml("This sign-in link expired.");
  const state = crypto.randomUUID();
  const browserSecret = crypto.randomUUID();
  await env.OAUTH_KV.put(`google:${state}`, JSON.stringify({ nonce, browserHash: await tokenHash(browserSecret) }), { expirationTtl: CONSENT_TTL_SECONDS });
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authorization.searchParams.set("redirect_uri", `${BASE}/auth/google/callback`);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", "openid email profile");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("prompt", "select_account");
  return new Response(null, { status: 302, headers: {
    location: authorization.toString(),
    "set-cookie": browserCookie(`__Host-overflow-google-${state}`, browserSecret, CONSENT_TTL_SECONDS),
    "cache-control": "no-store",
  } });
}

function decodeJwtPayload(jwt) {
  const parts = String(jwt).split(".");
  if (parts.length !== 3) return null;
  try {
    const value = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0))));
  } catch {
    return null;
  }
}

export async function handleGoogleCallback(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  if (!code || !state || url.searchParams.get("error")) return errorHtml("Google sign-in was cancelled or failed.");
  const rawState = await env.OAUTH_KV.get(`google:${state}`);
  if (!rawState) return errorHtml("This Google sign-in expired. Return to Codex and connect again.");
  let googleState;
  try { googleState = JSON.parse(rawState); } catch { return errorHtml("Return to Codex and connect again."); }
  const browserSecret = cookieValue(request, `__Host-overflow-google-${state}`);
  if (!browserSecret || await tokenHash(browserSecret) !== googleState.browserHash) {
    return errorHtml("Finish connecting in the browser where you started.");
  }
  const nonce = googleState.nonce;
  await env.OAUTH_KV.delete(`google:${state}`);
  const parsed = await loadConsent(env, nonce);
  if (!parsed) return errorHtml("This Overflow authorization expired. Return to Codex and connect again.");
  if (parsed._dashboard) return errorHtml("The dashboard no longer needs sign-in. Connect Overflow from Codex.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${BASE}/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) return errorHtml("Google could not complete this sign-in. Try again.");
  const tokens = await response.json();
  const claims = decodeJwtPayload(tokens.id_token);
  const verified = claims?.email_verified === true || claims?.email_verified === "true";
  if (!claims?.sub || !claims?.email || !verified || claims.aud !== env.GOOGLE_CLIENT_ID ||
      !(claims.iss === "accounts.google.com" || claims.iss === "https://accounts.google.com") ||
      Number(claims.exp || 0) * 1000 < Date.now()) {
    return errorHtml("Google did not return a valid verified identity.");
  }

  await env.OAUTH_KV.delete(`consent:${nonce}`);
  const email = String(claims.email).trim().toLowerCase();
  const displayName = String(claims.name || email.split("@")[0]).trim();
  const userId = `google-${claims.sub}`;
  const picture = profilePicture(claims.picture);
  const id = crypto.randomUUID();
  const setupSecret = crypto.randomUUID();
  await env.OAUTH_KV.put(`setup:${id}`, JSON.stringify({
    request: parsed, identity: { userId, email, displayName, picture },
    browserHash: await tokenHash(setupSecret), expiresAt: Date.now() + CONSENT_TTL_SECONDS * 1000,
  }), { expirationTtl: CONSENT_TTL_SECONDS });
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
  headers.append("set-cookie", browserCookie(`__Host-overflow-setup-${id}`, setupSecret, CONSENT_TTL_SECONDS));
  headers.append("set-cookie", browserCookie(`__Host-overflow-google-${state}`, "", 0));
  return new Response(setupHtml(id), { headers });
}

export async function handleComplete(request, env) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return errorHtml("Return to the connection page and try again.");
  const form = await request.formData().catch(() => null);
  const id = String(form?.get("setup") || "");
  if (!/^[a-f0-9-]{36}$/.test(id)) return errorHtml("Return to Codex and connect again.");
  const raw = await env.OAUTH_KV.get(`setup:${id}`);
  if (!raw) return errorHtml("This connection expired. Return to Codex and connect again.");
  const setup = JSON.parse(raw);
  const secret = cookieValue(request, `__Host-overflow-setup-${id}`);
  if (!secret || setup.expiresAt <= Date.now() || await tokenHash(secret) !== setup.browserHash) {
    return errorHtml("Finish connecting in the browser where you started.");
  }
  const { userId, email, displayName, picture } = setup.identity;
  if (!await consumeOnce(env, userId, "oauth", id, setup.expiresAt)) {
    return errorHtml("This connection was already used. Return to Codex.");
  }
  const authorization = await env.OAUTH_PROVIDER.completeAuthorization({
    request: setup.request, userId, scope: setup.request.scope,
    props: { userId, email, displayName, picture },
    metadata: { signedInVia: "google", issuedAt: Date.now() }, revokeExistingGrants: false,
  });
  await env.OAUTH_KV.delete(`setup:${id}`);
  try {
    const pool = env.POOL.get(env.POOL.idFromName(POOL));
    await pool.fetch("https://overflow.internal/rpc/account-init", {
      method: "POST",
      headers: {
        "x-overflow-user-id": userId,
        "x-overflow-display-name": encodeURIComponent(displayName),
        "x-overflow-email": email,
        "x-overflow-picture": picture,
      },
    });
  } catch {
    // Authorization already succeeded. The first MCP call also initializes the
    // account, so a transient pool failure must not strand the OAuth redirect.
  }
  const headers = new Headers({ location: authorization.redirectTo, "cache-control": "no-store", "referrer-policy": "no-referrer" });
  headers.append("set-cookie", browserCookie(`__Host-overflow-setup-${id}`, "", 0));
  try { headers.append("set-cookie", await createPresenceCookie(env, userId)); } catch { /* Presence must not prevent connection. */ }
  return new Response(null, { status: 303, headers });
}

export function handleProtectedResource(request) {
  const path = new URL(request.url).pathname;
  if (path !== "/.well-known/oauth-protected-resource/mcp" &&
      path !== "/.well-known/oauth-protected-resource/mcp/") return null;
  return Response.json({
    resource: `${BASE}/mcp`,
    authorization_servers: [BASE],
    scopes_supported: ["openid", "profile", "email", "overflow:connect"],
    bearer_methods_supported: ["header"],
    resource_name: "Overflow",
  }, { headers: { "cache-control": "public, max-age=3600" } });
}
