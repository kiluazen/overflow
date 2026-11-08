# Overflow QA

The living checklist for "check things". When Kushal says check things, QA, or
"is everything working", run this file top to bottom on **prod** and update the
**Last checked** column. Don't rely on memory and don't stop at the first green.

Rules:

1. **Test the real thing, not a stand-in.** Use the client ids Claude Code, Codex and Cursor actually
   registered, real accounts, and the shipped build. A freshly registered test
   client passing proves nothing. That's how Nexus missed its 2026-11-07
   outage: its one ChatGPT client expired after 90 days and every new connect
   returned a 500.
2. **A step counts as checked only if you saw it pass today.** Write the date and
   what you saw. "Should work" goes in as `not checked`.
3. **Every miss adds a row.** When a bug reaches users that this file didn't
   catch, add the check that would have caught it, in the same PR as the fix.

Host: `overflow.kushalsm.com` (worker `overflow-relay`, KV `OVERFLOW_OAUTH`
`e5a5d9f6…`; accounts live in Durable Object storage, no D1). Deploy from
`relay/`: `npm run deploy`.

---

## 1. Getting in (connect + sign-in)

| # | Step the user takes | How to check it for real | Pass | Last checked |
|---|---|---|---|---|
| 1.1 | Connects Overflow from Claude Code / Codex / Cursor | `node relay/scripts/qa-oauth-clients.mjs`: replays `/authorize` for every registered `client:` with its real redirect | every client `302` to sign-in. Never 5xx | 2026-11-08: 19 clients (Claude Code ×5, Codex ×5, Cursor ×1, E2E/smoke ×8) → 302 |
| 1.2 | Same client records stay alive | same script: lists every `client:` key | no key has an `expiration` (`clientRegistrationTTL: undefined` in `relay/src/index.js`, guarded by `relay/test/oauth-client-expiry.test.mjs`) | 2026-11-08: 19 keys, 0 with an expiration |
| 1.3 | Top-of-funnel is alive | same script prints real `/authorize` traffic for the last 24h by status | no 5xx. There's no consent-view or signup table, so `/authorize` 302s are the connect attempts | 2026-11-08: 500×1, which was this QA pass's own unknown-client probe (row 1.4); no real traffic |
| 1.4 | Opens an old or broken connect link | curl `/authorize?…&client_id=doesnotexist` | a 4xx, never a 5xx | 2026-11-08: **500** (error 1101) |
