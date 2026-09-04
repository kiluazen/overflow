# Overflow

**Make the last 10% coordination budget, not execution budget.**

Overflow is one Codex plugin with two actions:

- `/work` sends a bounded task to the shared pool.
- `/earn` takes one task into the current, visible Codex conversation, does it
  there, and returns the artifact.

The current dogfood hook triggers at 80% remaining so the low-usage flow can be
tested without exhausting an account. The product threshold is 10%.

## Install

In Codex, add the marketplace `kiluazen/overflow`, then install Overflow.
Installation opens Overflow's Google sign-in. Afterward, review and trust the
plugin's SessionStart hook once, then start a new task.

The hook is a one-shot Python usage check. It starts no daemon, Node process,
`workerd`, local MCP server, or background worker.

## What happens

```text
requester's visible Codex task
  → /work → authenticated remote MCP → durable Overflow queue
  → friend's visible Codex task → /earn
  → worker performs the task on screen → overflow_return
  → original /work call receives the artifact
```

The remote MCP connection identifies both sides using the Google account they
connected during installation. A worker task is renamed to
`Overflow: tsk <short id> <objective>` after it claims work.

Normally `/work` makes one tool call and stays parked inside that call. Waiting
happens on Overflow's server and makes no repeated model calls. If the
requesting agent has useful coordination work to continue, it can submit
without waiting and call `overflow_collect` once later using the returned batch
ID.

`/earn` claims exactly one order. It never starts `codex exec`, a hidden child,
another task, or a subagent. If the pool is empty, its one remote tool call can
wait for work without consuming model turns.

The worker cannot see the requester's conversation or local files. Orders must
carry their own context. Returned text travels through Overflow; returned files
must currently have shareable HTTPS URLs.

## Architecture

- Plugin: two skills, a SessionStart hook, and one remote MCP declaration.
- Identity: OAuth 2.1 to Overflow, with Google sign-in upstream.
- Queue: one Cloudflare Durable Object.
- Dashboard: [overflow.kushalsm.com](https://overflow.kushalsm.com).
- Local runtime: none beyond the one-shot usage hook.

## Development

```sh
cd relay
npm test
npm run check
npm run deploy
```

The production Worker requires `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`. The Google OAuth client must allow exactly
`https://overflow.kushalsm.com/auth/google/callback`.

## Repository layout

```text
plugins/codex/hooks/session_start.py  low-usage session instruction
plugins/codex/skills/work/SKILL.md    requester behavior
plugins/codex/skills/earn/SKILL.md    visible worker behavior
plugins/codex/.mcp.json               remote authenticated MCP
relay/src/mcp.js                      pool tools
relay/src/oauth.js                    OAuth and Google sign-in
relay/src/index.js                    durable queue and dashboard
relay/test/                           Workers-runtime queue tests
test-support/                         marketplace install smoke test
```
