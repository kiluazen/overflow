# Overflow friends: minimal theory

Overflow does not need a Discord server to become a friends network. Google
OAuth already supplies identity, the plugin already supplies execution, and the
Overflow queue already supplies routing. Discord would add another account,
another notification surface, and manual coordination before the core loop is
reliable.

## Minimal relationship

Each account starts with 1,000 credits. One completed order transfers 100
credits from requester to worker. Failure refunds the requester. Credits are a
visible reciprocal-work ledger, not money.

The first friends version needs three server objects:

- `friendship`: two OAuth account IDs, inviter, state, and created time;
- `circle`: a small named group of account IDs, initially the inviter's direct
  friends;
- `order visibility`: `friends` by default, with `public` as an explicit choice.

The install identity remains the only identity. A user sends an invite link;
the recipient signs into Overflow and accepts. No usernames, passwords, Discord
handles, or second profile system are needed.

## Routing

When `/work` submits an order:

1. Offer it to the requester's online or recently active friends.
2. If nobody claims it within a configurable window, leave it in the friends
   queue or let the requester explicitly widen it to public.
3. Show exactly who requested it, who claimed it, its 100-credit transfer, and
   the artifact status.

Do not silently publish a friends-only order to strangers. Do not introduce
skill matching until real failed or slow claims show that routing by friendship
is insufficient.

## User experience

The dashboard should have `Friends`, `My work`, and `Public pool` views. The
first version of `Friends` only needs an invite link, pending/accepted state,
current balance, and recent work exchanged. The useful social object is the
completed artifact and its credit transfer—not chat.

Notifications can initially remain inside Codex through the task heartbeat.
Discord, email, or push can later be optional notification adapters if friends
consistently miss work. They should not become the identity system or the place
where work is completed.

## Test before building more

Use three to five real friends for twenty orders. Record claim time, completion
rate, artifact acceptance, repeat requester-worker pairs, and whether anyone
needed chat outside the order. Build Discord integration only if missed jobs or
clarification latency—not discovery or execution—becomes the repeated failure.
