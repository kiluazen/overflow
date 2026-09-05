# Overflow

**Make the last 15% coordination budget, not execution budget.**

Overflow is one Codex plugin with two actions:

- `/work` sends a bounded task to the shared pool.
- `/earn` takes one task into the current, visible Codex conversation, does it
  there, and returns the artifact.

Every Google account starts with 1,000 credits. Delegating one order reserves
100 credits; successful completion transfers them to the worker, while failure
refunds the requester.

The SessionStart hook switches the task into orchestration mode when the main
Codex allowance reaches 15% remaining.

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
and ends without polling. Before claiming, it establishes `~/Overflow earn` as
its only local workspace. Each job gets a subfolder there; the worker must not
read or write anywhere else. Claims last 90 minutes. An abandoned claim is
offered to one more worker; a second abandoned claim closes the order and
refunds the requester automatically. Durable Object alarms enforce this without
model polling or a process on either laptop.

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
- Credits: a durable account ledger in the same Durable Object; 1,000 issued at
  signup and 100 transferred per completed order.
- Artifact storage: one private Cloudflare R2 bucket with expiring capability
  links.
- Dashboard: [overflow.kushalsm.com](https://overflow.kushalsm.com), showing
  live accounts, balances, work state, routes, timing, files, and activity.
- Local runtime: none beyond the one-shot usage hook.

The proposed friends-only routing layer is described in
[`docs/friends-system.md`](docs/friends-system.md).

The exact small-group dogfood run is in
[`docs/morning-trial.md`](docs/morning-trial.md).

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
