---
name: overflow
description: Coordinate instead of executing when the Codex allowance is nearly gone. Use when Overflow reports low remaining usage, or when the user asks to delegate because Codex is nearly out.
---

# Overflow

Your allowance is nearly gone. Every token you spend here is one you cannot
spend deciding what to do next. So stop being the thing that does the work and
become the thing that directs it.

## The rule

Do not perform the substantive task yourself. Delegate it, judge what comes
back, and integrate it.

You still own: the user's intent, what happens next, anything touching files or
credentials on this machine, and the final judgement of quality. A worker owns
one bounded piece of execution and nothing else.

## What to do

1. Tell the user how much allowance is left and that you are delegating. One
   sentence. Do not ask permission — they installed Overflow for this.
2. Break the task into pieces that can run **in parallel and independently**. A
   piece that needs another piece's output is one order, not two.
3. Call `overflow_delegate` **once**, with every order in the `orders` array.
   One call with four orders runs them at the same time on four machines; four
   calls run them one after another and cost you four turns.
4. The call parks. It spends no allowance while it waits and it streams
   progress to the user by itself. Do not narrate the wait, poll, or try to do
   the work while waiting.
5. Read what comes back. Accept it, or send back **one** precise correction as a
   new order. Do not fix it yourself unless it is faster than one sentence.

## Writing an order

The worker is a fresh Codex on someone else's computer. It has never seen this
conversation, cannot read your files, cannot reach your machine, and will not
ask you a question. If something is not in the order, it does not exist.

- **objective** — the outcome, not the method. One sentence.
- **context** — everything needed. Paste the actual text, data, error message,
  or requirements. Do not reference "the file we were looking at" or "the
  approach we discussed". A repository is fine if you give the URL and the
  worker can clone it themselves.
- **expectedArtifact** — the exact shape you want back: a diff, a table, a
  markdown document with named sections, a JSON object with named keys.
- **acceptanceTest** — how you will know it is usable. Write this for yourself;
  it is what you check the artifact against.

Do not put secrets, credentials, private keys, or anything the user would not
show a friend into an order. It runs on someone else's machine.

## What delegates well

Research and comparison. Analysis of material you paste in. Drafting prose,
docs, or copy. Reviewing code you include in the order. Producing a file to a
specification. Anything self-contained enough to hand a competent stranger.

## What does not

Work needing files only this machine has. Anything touching the user's
credentials or accounts. Decisions about what the user actually wants. A task
too small to be worth describing — if writing the order costs more than doing
it, do it.

## When the pool is empty

`overflow_delegate` returns immediately saying no workers are online. Tell the
user plainly, do the smallest useful piece locally, and stop. Do not burn the
rest of the allowance compensating.
