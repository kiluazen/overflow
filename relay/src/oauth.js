const CONSENT_TTL_SECONDS = 10 * 60;
const BASE = "https://overflow.kushalsm.com";

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
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07100b;color:#d7ffe2;font:15px ui-monospace,SFMono-Regular,Menlo,monospace;padding:24px}.card{width:min(420px,100%);padding:32px;border:1px solid #254c32;border-radius:18px;background:#0c1711}h1{font-size:27px;margin:0 0 10px}p{color:#91b99c;line-height:1.55;margin:0 0 24px}.button{display:flex;justify-content:center;align-items:center;gap:10px;width:100%;padding:13px 16px;border-radius:10px;background:#c8ffd6;color:#07100b;text-decoration:none;font-weight:700}.note{font-size:12px;margin:18px 0 0;color:#668872}</style></head>
<body><main class="card"><h1>Connect Overflow</h1><p><b>${client}</b> wants to identify the work you delegate and the work you complete.</p><a class="button" href="/auth/google/start?nonce=${encodeURIComponent(nonce)}">Continue with Google</a><p class="note">Overflow receives your name, email address, and Google account identifier. It never receives your Google password.</p></main></body></html>`;
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
  await env.OAUTH_KV.put(`google:${state}`, nonce, { expirationTtl: CONSENT_TTL_SECONDS });
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authorization.searchParams.set("redirect_uri", `${BASE}/auth/google/callback`);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", "openid email profile");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("prompt", "select_account");
  return Response.redirect(authorization.toString(), 302);
}

function decodeJwtPayload(jwt) {
  const parts = String(jwt).split(".");
  if (parts.length !== 3) return null;
  try {
    const value = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(atob(value));
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
  const nonce = await env.OAUTH_KV.get(`google:${state}`);
  if (!nonce) return errorHtml("This Google sign-in expired. Return to Codex and connect again.");
  await env.OAUTH_KV.delete(`google:${state}`);
  const parsed = await loadConsent(env, nonce);
  if (!parsed) return errorHtml("This Overflow authorization expired. Return to Codex and connect again.");

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
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: parsed,
    userId: `google-${claims.sub}`,
    scope: parsed.scope,
    props: { userId: `google-${claims.sub}`, email, displayName },
    metadata: { signedInVia: "google", issuedAt: Date.now() },
    revokeExistingGrants: false,
  });
  return Response.redirect(redirectTo, 302);
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
