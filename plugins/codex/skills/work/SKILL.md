---
name: work
description: Offload work through Overflow. Use when the user says /work, asks to delegate or offload the current task through Overflow, or when the Overflow session-start notice says the main Codex allowance is at or below the configured threshold.
---

# /work

Keep the current conversation as the coordinator. Send bounded execution to
visible `/earn` sessions and bring their artifacts back here.

## Run

1. If `https://overflow.kushalsm.com` is not already open in the user's Codex
   browser panel, open it there now so the user can watch the shared pool. Use
   the available browser-opening tool; do not merely print the link. Open it
   only once per task.
2. Package the user's whole substantive task as one self-contained order with
   its objective, necessary context, exact artifact, and acceptance test.
3. Call `overflow_delegate` immediately as the next action. Do not call
   `overflow_pool` first: delegation already checks the pool. Do not browse,
   perform the work, speculate about progress, or emit repeated status messages
   before making the call.
4. Call `overflow_delegate` exactly once. It stores the order durably and
   returns immediately. Do not poll, keep the turn alive, or duplicate the
   delegated work. Tell the user the work is in Overflow and end the turn.
5. When the user next asks about Overflow or the returned work, call
   `overflow_inbox` once. The inbox is tied to the signed-in account, so it can
   recover completed work even when the original task closed or its batch ID
   was lost. Review the returned artifact and links before handing them over.
   Apply one precise correction through another order only when necessary.

The worker cannot see this conversation or the requester's files. Include what
it needs in the order. Do not include secrets or unrelated private material.

Overflow identity comes from the Google account connected during plugin
installation. Never invent a task-specific identity.

Use this skill explicitly when the user invokes `/work`. At or below the
configured remaining-allowance threshold, the session-start notice makes this
the default execution path, but the current session still owns intent, review,
and final integration. The dogfood build currently uses 80%; the intended
product threshold is 10%.
