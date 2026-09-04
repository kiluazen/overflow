# Overflow

**Make the last 10% coordination budget, not execution budget.**

The current dogfood build triggers at or below 80% so the complete loop can be tested
without first exhausting an account. The intended product threshold is 10%.
When your main Codex allowance crosses the configured threshold, Overflow tells that session to
coordinate: package bounded work, send it to friends with allowance left, and
use what remains to review and integrate what comes back.

The friend doing the work sees it. Overflow never starts a hidden Codex worker.

## Install

One plugin contains both sides.

In the ChatGPT desktop app: **Add plugin marketplace** → source
`kiluazen/overflow`, ref `main`, and leave **Sparse paths empty**. Then add
Overflow. The marketplace manifest lives at the repository root; checking out
only `plugins/codex` omits it and Codex correctly rejects the marketplace.

If a sparse checkout is necessary, enter both paths on separate lines:

```text
.claude-plugin/marketplace.json
plugins/codex
```

From a terminal:

```sh
codex plugin marketplace add kiluazen/overflow
codex plugin add overflow@overflow
```

### Trust the hook

Installing Overflow does not automatically trust its SessionStart hook. Codex
skips an untrusted hook; the desktop app may not interrupt a new task with an
approval dialog.

Before testing Overflow in the ChatGPT desktop app:

1. Open **Plugins** → **Installed** → **Overflow**.
2. Under **Hooks**, select **Review** (or **Trust all** after reviewing it).
3. Confirm the “hook needs review” warning is gone.
4. Start a fresh Codex task so the trusted hook, skills, and tools load.

In Codex CLI, run `/hooks`, review Overflow's hook, and trust its current
definition before starting the test session. If Overflow's hook definition is
changed in a later release, Codex will require it to be reviewed again.

## Give work: `/work`

Run `/work` or ask Codex to offload a task. Overflow turns each independent
piece into a self-contained order and calls `overflow_delegate` once. It first
checks the pool and never creates more orders than currently idle earning
sessions; with one or zero waiting earners, the whole task stays one order. The
requesting task parks while it waits, so it does not spend allowance narrating
the wait.

At or below the configured remaining-main-allowance threshold, the SessionStart hook tells
the new task to use this coordinator behavior. It does not fabricate work or
send anything before the user asks for a task to be done.

`overflow_delegate` keeps the requesting tool call open for up to one hour. The
conversation is parked during both queue time and execution time; it resumes in
the same turn when results arrive. If nobody finishes within the hour, the tool
returns a timeout instead. Closing the requesting task before delivery removes
its queued work, because this prototype does not yet persist a requester across
restarts.

## Take work: `/earn`

Open a dedicated, normal Codex task and run `/earn` or say “take an Overflow
task.” That visible task:

1. calls `overflow_claim` and waits for one queued order;
2. renames itself `Overflow: tsk <first 4 job characters> <short objective>`;
3. performs the order in that conversation, using its installed skills and
   relevant local context;
4. calls `overflow_return` with the finished artifact; and
5. tells its user whether the requester received it.

The earning task takes exactly one order. It never starts `codex exec`, a
background model, another task, or a hidden subagent. Run `/earn` again when you
want another.

If no work exists, the `overflow_claim` tool can stay parked until one arrives.
No model turns are spent while the tool is waiting.

When the result is a file, `overflow_return` reads it locally and transfers its
bytes through the relay. The requester plugin saves received files under its
private plugin-data `returns/` directory and puts their paths in the original
tool result.

## What installing does—and does not do

Installing makes `/work`, `/earn`, and the relay tools available. It does not
make every open Codex task an automatic worker. A machine becomes available to
take work only while its user has explicitly opened an earning task and run
`/earn`.

The current prototype uses one shared trusted-friends pool. Installing the
plugin supplies its default relay configuration; `overflow_join` exists only
to change the machine name or point at another pool.

## Safety boundary

Orders come from other people and their artifacts return to those people. An
earning task may use this machine’s skills and relevant reference material, but
must not expose credentials, secrets, or unrelated files. External publishing,
messages, purchases, and destructive changes still require authorization from
the machine’s user in the visible earning conversation.

## Architecture

```text
requester's visible Codex task
  → overflow_delegate
  → relay queue
  → friend's visible /earn Codex task
  → overflow_claim returns the order into that conversation
  → that conversation performs the work
  → overflow_return
  → original overflow_delegate call receives the artifact
```

The relay is a Cloudflare Worker with one Durable Object. Requester and earner
tools hold hibernatable WebSockets while waiting; no process polls.

## Repository layout

```text
plugins/codex/
  hooks/session_start.py    detects the configured remaining-allowance threshold
  skills/work/SKILL.md      requester behavior
  skills/earn/SKILL.md      visible earner behavior
  mcp/server.mjs            delegate / claim / return / pool / join tools
  lib/config.mjs            trusted-pool configuration
relay/src/index.js          durable queue and result routing
test-support/               protocol-only test harnesses; never installed
```

## Run the relay

```sh
cd relay
wrangler secret put OVERFLOW_TOKEN
wrangler deploy
```
