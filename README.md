# Overflow

**Your Codex allowance runs out. Your friends' hasn't.**

When your main Codex allowance is gone, Codex doesn't stop — it drops you onto a
small model and you spend the rest of the week fighting it. Overflow turns that
session into an orchestrator instead: it splits the work into orders, runs them
on friends' idle Codex installations, and brings the results back into the same
conversation.

Waiting costs you nothing. A delegated call suspends the session inside the tool
call — measured on Codex 0.144.1, a 159-second wait cost the same as a call that
failed instantly. You pay to decide what to delegate and to judge what comes
back. That's it.

## Join a pool

Someone gives you a relay URL and an invite code. Three steps:

```sh
codex plugin marketplace add kiluazen/overflow
codex plugin add overflow
```

```sh
node ~/.codex/.tmp/marketplaces/overflow/plugins/codex/scripts/earn.mjs pair <relay-url> <invite-code>
```

In the ChatGPT desktop app it's **Add plugin marketplace** → source
`kiluazen/overflow`, sparse path `plugins/codex`.

## Then two things happen by themselves

**When you're nearly out**, do nothing. A session that starts below 15%
remaining is told to coordinate rather than execute. Ask for what you wanted; it
writes the orders, sends them out, shows progress while it waits, and assembles
the answer.

**When you have allowance spare**, put your machine in the pool:

```sh
node <plugin>/scripts/earn.mjs
```

One socket, one job at a time, on your own Codex login. No daemon, nothing
installed in the background, no duration budget — it does not quietly expire
after thirty minutes. It stops when you stop it.

## What running `earn` actually means

Worth knowing before you put your laptop in someone's pool. A job is a prompt
written by another person in the pool, run on your machine by `codex exec` with
approvals turned off. Measured, not assumed:

- **It cannot write outside its scratch directory.** `workspace-write` blocks it,
  and the directory is deleted when the job ends.
- **It has no network access**, so it cannot send anything anywhere. Set
  `OVERFLOW_WORKER_NETWORK=1` if you want jobs to reach the internet — that also
  removes the thing stopping a job from posting what it read on your machine.
- **It can read your files.** `workspace-write` sandboxes writes, not reads, so a
  job can read anything your user account can, `~/.codex/auth.json` included, and
  put what it finds in the artifact it returns.

That last one is the real limit: a job's output goes back to whoever submitted
it, so an order could be written to read something of yours and return it. This
is why a pool is people you know. Run `earn` for friends, not for strangers.

## Run your own relay

One Cloudflare Worker with a single Durable Object. Both sides hold hibernatable
WebSockets, so nobody polls and an idle pool costs almost nothing.

```sh
cd relay
wrangler secret put OVERFLOW_TOKEN   # the shared invite code
wrangler deploy
```

## Layout

```
plugins/codex/          the plugin (the marketplace sparse path)
  hooks/                allowance check at session start
  skills/overflow/      how to coordinate instead of execute
  mcp/server.mjs        overflow_delegate — parks, streams progress
  scripts/earn.mjs      the earner, plus pair / status
relay/                  Worker + Durable Object job board
```

## Four settings that are not optional

Codex misbehaves quietly without each of these, so they ship in
`plugins/codex/.mcp.json`:

- `tools.overflow_delegate.approval_mode = "auto"` — without it the call is
  cancelled before the server ever receives it, and the user is told *they*
  cancelled it.
- **Tool search, named explicitly.** Codex defers MCP tools, so
  `overflow_delegate` is not in the model's immediate tool list — it must be
  loaded through tool search. An orchestrator that doesn't know this reports the
  tool missing and delegates nothing while the server runs fine. The
  instructions have to name tool search, and separately forbid hunting on the
  filesystem: they are two different searches, and conflating them costs you
  either way.
- `tool_timeout_sec` — the default is far shorter than a real job.
- `env_vars` — Codex does not pass the parent shell's environment to MCP
  servers. Anything inherited from a login shell arrives undefined.

## Does it actually save you anything?

Measured, requester on the small model and workers on the good one:

| job | | output tokens | content delivered |
|---|---|---|---|
| ~550 words | written directly | **988** | 558 words |
| | delegated | 2,400 | 546 words |
| ~1,900 words | written directly | 4,223 | 1,930 words |
| | delegated | **2,356** | **2,599 words** |

Delegating a short job is a straight loss — writing the orders costs about what
writing a thousand words of answer costs. Delegating a substantial one costs
under half the output and returns more finished text, because the writing
happened on someone else's allowance. Overflow estimates the answer length and
declines to delegate below roughly a thousand words.

Two things had to be true for that second row. The orchestrator must not retype
what the workers wrote — the tool result is already on screen, and copying it
into its own reply pays for every word twice. And the job has to be big enough
to earn back the orders.

## What's been verified

Against the deployed relay, from a plugin installed the way you'd install it:

- a real low-allowance session, from a clean marketplace install, splits a
  release-notes request into four parallel orders, delegates in one call, gets
  4/4 back from two real Codex workers, and assembles the answer — zero shell
  commands
- six orders with 3.6 KB of context each, across two workers, return 6/6
- a batch that runs out of time keeps the artifacts that came back and names the
  ones that didn't, and the orchestrator re-delegates only those
- an empty pool refuses to park, in 0.1s
- a worker that dies mid-job fails that order instead of hanging its requester
- workers dropped by a relay deploy reconnect on their own within seconds

Not yet verified: two people on two machines with two different accounts, and
Esc during a park.
