# Overflow

**Keep working with a little help from your friends.**

Overflow shares spare AI allowance between people. Keep talking to Codex as
usual: when the native usage check reports less than 10% remaining, the agent packages
substantive work and delegates it. You do not need to write a separate order.
`overflow work` is the manual shortcut for people who want to delegate earlier.

Have spare allowance today? `overflow earn` takes one task into your current, visible
Codex conversation. Help someone now, keep the credits for when you need work
next week.

Every Google account starts with 10,000 credits. Delegating one order reserves
100 credits; successful completion transfers them to the worker, while failure
refunds the requester.

The single hook runs when you submit a prompt. Exactly 10% stays
local. Missing usage data leaves normal work available; `overflow work` still works.

Select the **overflow** skill to send work, earn credits, or check your work.
If you select it without a request, it offers those three choices. The previous
standalone work and earn skills are now flows inside Overflow.

## Install

In Codex, add the marketplace `kiluazen/overflow`, then install Overflow.
Connect Google once. OAuth returns directly to the app after Google sign-in,
without an Overflow return-button step. In Codex, open **Overflow → Hooks**
and approve the usage hook, then start a new task.

The hook uses the system shell to give the current agent instructions. The
agent reads the host's native `get_usage_limits` tool. No Python, Node, separate
Codex CLI, local MCP server, or background process is needed for this check.
This requires the Codex desktop host to expose that native tool; an unsupported
host keeps manual `work` and `earn` skills available. A long-running turn catches
changes on the next user prompt, rather than continuously monitoring usage.

## Claude Code

Install the same public plugin through Claude Code:

```text
/plugin marketplace add kiluazen/overflow
/plugin install overflow@overflow
/reload-plugins
/mcp
```

In `/mcp`, select Overflow and complete Google sign-in. Use
`/overflow:work <task>` to delegate, `/overflow:work status` to retrieve work,
and `/overflow:earn` to take one queued task. Use the same Google account to
keep the same credits and inbox across Codex and Claude Code.

Claude Code uses manual commands. There is no local server, usage cache,
status-line setup, or background monitor. The shared hook exits quietly in
Claude; automatic allowance routing continues only on Codex hosts that expose
the native usage tool. Claude does not need to approve a usage hook to use the
manual commands.

If Claude's Chrome integration is available, the skill can open the board there.
Otherwise it returns the dashboard link and continues. No browser integration
is required to delegate or earn. Claude result recovery is manual through
`/overflow:work status`; it does not create Codex-style scheduled checks.

The package contains the standard manifest for each host. Its existing
`plugins/codex` source path is retained so current marketplace installs keep
working. The shared marketplace's Codex `policy` metadata is ignored by Claude;
Claude authenticates through its normal MCP connection flow. Claude web/cloud
support is not established by this local Claude Code release.

## What happens

```text
requester’s visible Codex task
  → low-allowance detection → agent prepares order → durable Overflow queue
  → task sleeps; Codex heartbeat checks at 20, 40, and 60 minutes
  → friend’s visible Codex task → overflow earn
  → worker performs the task on screen → overflow_return
  → requester’s private Overflow inbox receives the artifact
```

The remote MCP connection identifies both sides using the Google account they
connected during installation. A worker task is renamed to
`Earn Overflow: <short id> <objective>` after it claims work.

Automatic delegation (or the manual `overflow work` shortcut) makes one short delegation call, stores the batch durably, and, when supported by the host, creates a
finite Codex task heartbeat. The original turn ends after scheduling succeeds or reports its absence. Codex wakes
the same task after 20 minutes, checks that batch once, and repeats at 40 and 60
minutes only while needed. There is no model activity between those checks. A
completed heartbeat returns the artifact in the original task and deletes
itself. `overflow_inbox` remains the manual recovery path even if the original
task or batch ID was lost.

`overflow earn` claims exactly one currently queued order. It never starts `codex exec`,
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

- Plugin: separate work and earn skills, with result recovery through work status, native Codex and Claude manifests, Codex usage hooks, and one remote MCP declaration.
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

The website lives in `relay/ui/`. Dashboard, privacy, and terms use the same
React `SiteLayout`, `SiteHeader`, and `SiteFooter` and shared `site.css` tokens.
Vite builds the board script and prerenders the pages into the Worker before
`dev`, `test`, `check`, and `deploy`; React only runs at build time. Edit the
components or page content, then run `npm run build:ui` to refresh an active
Wrangler development session. Generated pages in `src/generated/` are ignored.

The production Worker requires `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`. The Google OAuth client must allow exactly
`https://overflow.kushalsm.com/auth/google/callback`.

## Repository layout

```text
plugins/codex/hooks/usage.sh          native usage policy instructions
plugins/codex/skills/work/SKILL.md     delegate tasks and recover results
plugins/codex/skills/earn/SKILL.md     complete one queued task
plugins/codex/.mcp.json               remote authenticated MCP
relay/src/mcp.js                      pool tools
relay/src/oauth.js                    OAuth and Google sign-in
relay/src/index.js                    durable queue, credits, and presence
relay/src/input-attachments.js        private requester input files
relay/ui/components/                 shared React site layout, header, footer
relay/ui/pages/                      board and legal pages
relay/ui/board-client.js              live board data and task dialog
relay/scripts/build-ui.mjs            Vite build and static page rendering
relay/test/                           Workers-runtime queue tests
test-support/                         marketplace install smoke test
```

## Policies and license

[Privacy](https://overflow.kushalsm.com/privacy) · [Terms](https://overflow.kushalsm.com/terms) · [Support](mailto:kushalsm@autark.sh)

The plugin uses a proprietary license with permission to install and use the
unmodified plugin with Overflow. See [the plugin license](plugins/codex/LICENSE.txt).
