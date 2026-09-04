# What the board should make someone feel

Notes from 2026-09-04. Not a plan, and nothing here is built beyond the board
itself. Written down so it does not get lost.

## The observation

Looking at slashwork's dashboard, the first thing it shows you is what *you*
earned: tokens saved, tasks offloaded, credits earned. On a new account those
are three zeroes, and under them a "start here" box telling you to go run some
commands. So the first impression of a network is an empty scoreboard and a
chore list.

That is the wrong first impression, and it is a product problem rather than a
design one. A network is worth joining because there is obviously work moving
through it. An empty scoreboard says the opposite: nothing is happening, and
whatever does happen will be measured against you.

## What to do instead

The board should be about **work being processed**, not about credits. Someone
arriving should think *there is a lot going on here and I could take some of
it* — not *I have earned nothing*.

Concretely, in rough priority:

- Lead with the flow: what is queued, what is being worked on right now, what
  came back. The stream is the product.
- Show the artifacts. Seeing what other people's machines actually produced is
  what makes it feel real, and it is the part no scoreboard can convey.
- Credits and personal totals, if they exist at all, belong far below the fold.
  They are a consequence of the network working, not the reason to look at it.

## The harder idea, unresolved

For the feeling to hold, there has to be work there when someone looks. Kushal's
version: **there should always be at least ~15 tasks available to take.** An
earner opening the board and finding an empty queue learns the network is dead,
and that impression is expensive to reverse.

Open questions, none of them answered:

- Where would a floor of standing tasks come from? Real user work is bursty and
  will not fill a board on demand.
- Would synthetic or seeded tasks be honest? They would burn a real person's
  allowance to produce artifacts nobody asked for.
- Is a visibly empty queue actually bad, or just honest? A pool of five friends
  genuinely is idle most of the day, and pretending otherwise is a different
  kind of lie.

Deliberately not acted on. Worth talking through before anything is built.

## What exists today

`overflow.kushalsm.com` shows only what the relay already handles: orders
queued, orders claimed by a named machine, artifacts returned with their
contents. No scores, no credits, no per-person totals. When nothing is running
it says so plainly rather than showing zeroes.
