---
name: work
description: Offload work through Overflow. Use when the user says /work, asks to delegate or offload a task, or when the Overflow session-start notice says less than 10% of the main Codex allowance remains.
---

# /work

Keep the current conversation as the coordinator. Send bounded execution to
visible `/earn` sessions and bring their artifacts back here.

## Run

1. Decide which parts of the user's request can be completed independently.
2. Make each part a self-contained order with an objective, all necessary
   context, the exact artifact expected, and an acceptance test.
3. Call `overflow_delegate` once with every independent order in its `orders`
   array. Do not call it once per order.
4. The call can wait for someone to open `/earn`. Do not perform the delegated
   work while it is waiting.
5. Review what returns. Apply one precise correction through another order only
   when necessary. Keep the final response compact because the returned
   artifacts are already visible in the tool result.

The worker cannot see this conversation or the requester's files. Include what
it needs in the order. Do not include secrets or unrelated private material.

Use this skill explicitly when the user invokes `/work`. Below 10% remaining
allowance, the session-start notice makes this the default execution path, but
the current session still owns intent, review, and final integration.
