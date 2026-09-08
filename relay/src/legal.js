import { SITE_PAGES } from "./generated/site-pages.js";

export function legalResponse(request) {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path !== "/privacy" && path !== "/terms") return null;
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  return new Response(request.method === "HEAD" ? null : SITE_PAGES[path], {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
