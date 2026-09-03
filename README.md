# Overflow

**Less than 15% of your Codex allowance left? Overflow turns your session into an
orchestrator.** It sends the work to friends whose Codex is idle and spends what
you have left on directing and judging, so your work does not stop when your
usage does.

Waiting for a delegated job costs no allowance. Measured on Codex 0.144.1, a
159-second park cost the same as a call that failed instantly — the model is
suspended inside the tool call, not polled and not re-invoked.

## Install

In the ChatGPT desktop app: **Add plugin marketplace** → source `kiluazen/overflow`,
sparse path `plugins/codex`. Or from a terminal:

```sh
codex plugin marketplace add kiluazen/overflow
codex plugin add overflow
```

Then pair once with your pool:

```sh
node ~/.codex/plugins/cache/*/overflow/*/scripts/earn.mjs pair <relay-url> <invite-code>
```

## Using it

**When you are nearly out**, do nothing. A session that starts below 15%
remaining gets told to coordinate instead of execute. Ask for what you wanted;
it packages the work, sends it out, shows progress while it waits, and judges
what comes back.

**When you have allowance to spare**, put your machine in the pool:

```sh
node <plugin>/scripts/earn.mjs
```

It holds one socket open, runs one job at a time on your Codex login, and stops
when you stop it. No daemon, nothing installed in the background, and no
duration budget — it does not quietly expire after thirty minutes.

## Running the relay

The relay is a Cloudflare Worker with one Durable Object. Earners and requesters
both hold hibernatable WebSockets, so nobody polls and an idle pool costs
almost nothing.

```sh
cd relay
wrangler secret put OVERFLOW_TOKEN   # the shared invite code
wrangler deploy
```

## Layout

```
plugins/codex/          the plugin (sparse path for the marketplace)
  hooks/                SessionStart allowance check
  skills/overflow/      how to coordinate instead of execute
  mcp/server.mjs        overflow_delegate — parks, streams progress
  scripts/earn.mjs      the earner, and `pair` / `status`
relay/                  Cloudflare Worker + Durable Object job board
```

## Three settings that are not optional

Codex silently misbehaves without each of these, so they ship in
`plugins/codex/.mcp.json`:

- `tools.overflow_delegate.approval_mode = "auto"` — without it the call is
  cancelled before the server receives it, and the user is told *they*
  cancelled it.
- `tool_timeout_sec` — the default is far shorter than a real job.
- `env_vars` — Codex does not pass the parent shell's environment to MCP
  servers. Anything inherited from a login shell arrives undefined.

## Status

Verified against a deployed relay, from a plugin installed the way a friend
installs it (`codex plugin marketplace add kiluazen/overflow`):

- a real Codex session calls `overflow_delegate` and is not cancelled, which
  confirms a plugin's bundled `.mcp.json` can carry `approval_mode`
- two orders in one call fan out and come back correctly attributed
- the pool refuses to park when no workers are online, in 0.1s
- a worker that disconnects mid-job fails that order instead of hanging its
  requester
- the SessionStart hook produces orchestration context when paired, and a
  pairing nudge when not

Not yet verified: a friend on a second machine; Esc during a park; and whether
a freshly installed plugin's hook needs a one-time trust approval before it
fires.
