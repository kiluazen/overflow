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
4. Call `overflow_delegate` exactly once with `timeoutSeconds: 1200`. It is a
   blocking, event-driven wait: the current Codex turn parks inside the tool
   call until an earner returns the artifact, the relay fails, or the 20-minute
   deadline expires. Do not poll and do not duplicate the work.
5. When the tool returns, review the artifact. Apply one precise correction
   through another order only when necessary. Keep the final response compact
   because the returned artifact is already visible in the tool result.

The worker cannot see this conversation or the requester's files. Include what
it needs in the order. Do not include secrets or unrelated private material.

Use this skill explicitly when the user invokes `/work`. At or below the
configured remaining-allowance threshold, the session-start notice makes this
the default execution path, but the current session still owns intent, review,
and final integration. The dogfood build currently uses 80%; the intended
product threshold is 10%.
