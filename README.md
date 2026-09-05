# Overflow

**Make the last 15% coordination budget, not execution budget.**

Overflow shares spare AI allowance between people. Keep talking to Codex as
usual: when the usage hook detects 15% remaining or less, the agent packages
substantive work and delegates it. You do not need to write a separate order.
`/work` is the manual shortcut for people who want to delegate earlier.

Have spare allowance today? `/earn` takes one task into your current, visible
Codex conversation. Help someone now, keep the credits for when you need work
next week.

Every Google account starts with 1,000 credits. Delegating one order reserves
100 credits; successful completion transfers them to the worker, while failure
refunds the requester.

The SessionStart hook switches the task into orchestration mode when the main
Codex allowance is at 15% remaining or less. It checks at startup, resume, and
clear; it does not continuously monitor a running task.

## Install

In Codex, add the marketplace `kiluazen/overflow`, then install Overflow.
Installation opens Overflow's Google sign-in. Afterward, review and trust the
plugin's SessionStart hook once, then start a new task.

The hook is a one-shot Python usage check. It starts no daemon, Node process,
`workerd`, local MCP server, or background worker.

## What happens

```text
requester’s visible Codex task
  → low-allowance detection → agent prepares order → durable Overflow queue
  → task sleeps; Codex heartbeat checks at 20, 40, and 60 minutes
  → friend’s visible Codex task → /earn
  → worker performs the task on screen → overflow_return
  → requester’s private Overflow inbox receives the artifact
```

The remote MCP connection identifies both sides using the Google account they
connected during installation. A worker task is renamed to
`Overflow: tsk <short id> <objective>` after it claims work.

Automatic delegation (or the manual `/work` shortcut) makes one short delegation call, stores the batch durably, and creates a
finite Codex task heartbeat. The original turn ends immediately. Codex wakes
the same task after 20 minutes, checks that batch once, and repeats at 40 and 60
minutes only while needed. There is no model activity between those checks. A
completed heartbeat returns the artifact in the original task and deletes
itself. `overflow_inbox` remains the manual recovery path even if the original
task or batch ID was lost.

`/earn` claims exactly one currently queued order. It never starts `codex exec`,
a hidden child, another task, or a subagent. If the pool is empty, it says so
and ends without polling. Its first action is a folder choice: use
`<current project>/overflow-earn` (recommended), or choose another folder.
It waits for the answer before creating folders or claiming work, and reuses
that explicit choice within the conversation. Each job gets a full-job-ID
subfolder; the worker must not read or write anywhere else, including the
surrounding project. Existing project access reduces permission surprises but
does not bypass macOS controls. This is an agent instruction, not an OS sandbox. Claims last 90 minutes. An abandoned claim is
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
  public work, requester/worker routes and filenames. Google sign-in reveals
  only your own credits. Browser sessions use the same Google account identity
  as the plugin, with an HttpOnly cookie; the public API contains no balances.
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
