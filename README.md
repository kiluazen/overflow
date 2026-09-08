# Overflow

**Keep working with a little help from your friends.**

Overflow shares spare AI allowance between people. Keep talking to Codex as
usual: when the native usage check reports less than 10% remaining, the agent packages
substantive work and delegates it. You do not need to write a separate order.
`/work` is the manual shortcut for people who want to delegate earlier.

Have spare allowance today? `/earn` takes one task into your current, visible
Codex conversation. Help someone now, keep the credits for when you need work
next week.

Every Google account starts with 10,000 credits. Delegating one order reserves
100 credits; successful completion transfers them to the worker, while failure
refunds the requester.

The hook checks at session start and on new user prompts. Exactly 10% stays
local. Missing usage data leaves normal work available; `/work` still works.

## Install

In Codex, add the marketplace `kiluazen/overflow`, then install Overflow.
Connect Google once. The final connection page shows where to find
**Overflow → Hooks**; return to Codex and approve the usage hook, then start
a new task.

The hook uses the system shell to give the current agent instructions. The
agent reads the host's native `get_usage_limits` tool. No Python, Node, separate
Codex CLI, local MCP server, or background process is needed for this check.
This requires the Codex desktop host to expose that native tool; an unsupported
host keeps manual `/work` and `/earn` available. A long-running turn catches
changes on the next user prompt, rather than continuously monitoring usage.

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
`Earn Overflow: <short id> <objective>` after it claims work.

Automatic delegation (or the manual `/work` shortcut) makes one short delegation call, stores the batch durably, and, when supported by the host, creates a
finite Codex task heartbeat. The original turn ends after scheduling succeeds or reports its absence. Codex wakes
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

The worker receives the explicit brief and uploaded input files. The requester
uploads necessary documents, images, data, or a portable source ZIP before
submitting the order: up to 10 files, 50 MiB each, 200 MiB total. Overflow checks
size, SHA-256, and ownership before reserving credits. Only the requester and
current valid claimant can obtain fresh input links. A requeued claim loses
its access. Unattached uploads expire after 24 hours; attached inputs remain
through the job and for 30 days after completion or failure.

Returned text and file bytes travel through Overflow. Workers upload outputs
to task-scoped URLs and requesters receive expiring download links. The rest
of the requester's conversation and filesystem do not travel automatically.

## Architecture

- Plugin: two skills, SessionStart and UserPromptSubmit hooks, and one remote MCP declaration.
- Wake-up: a finite Codex heartbeat attached to the requesting task; no local
  daemon, listener, or relay.
- Identity: OAuth 2.1 to Overflow, with Google sign-in upstream.
- Queue: one Cloudflare Durable Object.
- Credits: a durable account ledger in the same Durable Object; 10,000 issued at
  signup and 100 transferred per completed order.
- Artifact storage: one private Cloudflare R2 bucket with expiring capability
  links.
- Dashboard: [overflow.kushalsm.com](https://overflow.kushalsm.com) is public and
  read-only, with no buttons or login. It shows Google avatars, available
  credits, last activity, and one task list with unfinished work first.
- Presence: authenticated plugin activity lasts two minutes; visible browser
  activity expires after 90 seconds without a heartbeat. Browser attribution
  uses a presence-only cookie or a one-time plugin handoff, never another login.
  Recent activity does not promise that a computer will claim work.
- Local runtime: the system shell emits usage instructions; the Codex host
  supplies the native usage tool.

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
plugins/codex/hooks/usage.sh          native usage policy instructions
plugins/codex/skills/work/SKILL.md    requester behavior
plugins/codex/skills/earn/SKILL.md    visible worker behavior
plugins/codex/.mcp.json               remote authenticated MCP
relay/src/mcp.js                      pool tools
relay/src/oauth.js                    OAuth and Google sign-in
relay/src/index.js                    durable queue, credits, and presence
relay/src/input-attachments.js        private requester input files
relay/test/                           Workers-runtime queue tests
test-support/                         marketplace install smoke test
```
