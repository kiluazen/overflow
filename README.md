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
requester’s visible Codex task
  → /work → authenticated remote MCP → durable Overflow queue
  → task sleeps; Codex heartbeat checks at 20, 40, and 60 minutes
  → friend’s visible Codex task → /earn
  → worker performs the task on screen → overflow_return
  → requester’s private Overflow inbox receives the artifact
```

The remote MCP connection identifies both sides using the Google account they
connected during installation. A worker task is renamed to
`Overflow: tsk <short id> <objective>` after it claims work.

`/work` makes one short delegation call, stores the batch durably, and creates a
finite Codex task heartbeat. The original turn ends immediately. Codex wakes
the same task after 20 minutes, checks that batch once, and repeats at 40 and 60
minutes only while needed. There is no model activity between those checks. A
completed heartbeat returns the artifact in the original task and deletes
itself. `overflow_inbox` remains the manual recovery path even if the original
task or batch ID was lost.

`/earn` claims exactly one currently queued order. It never starts `codex exec`,
a hidden child, another task, or a subagent. If the pool is empty, it says so
and ends without polling.

The worker cannot see the requester's conversation or local files. Orders must
carry their own context. Returned text and file bytes travel through Overflow;
workers upload files to short-lived, task-scoped URLs and requesters receive
expiring download links.

## Architecture

- Plugin: two skills, a SessionStart hook, and one remote MCP declaration.
- Wake-up: a finite Codex heartbeat attached to the requesting task; no local
  daemon, listener, or relay.
- Identity: OAuth 2.1 to Overflow, with Google sign-in upstream.
- Queue: one Cloudflare Durable Object.
- Artifact storage: one private Cloudflare R2 bucket with expiring capability
  links.
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
