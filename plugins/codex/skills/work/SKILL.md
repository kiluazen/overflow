---
name: work
description: Offload work through Overflow. Use when the user says /work, asks to delegate or offload a task, or when the Overflow session-start notice says the main Codex allowance is at or below the configured threshold.
---

# /work

Keep the current conversation as the coordinator. Send bounded execution to
visible `/earn` sessions and bring their artifacts back here.

## Run

1. Call `overflow_pool` once to see how many `/earn` sessions are currently
   idle.
2. Default to one self-contained order for the user's whole substantive task.
   Split it only when parallel work materially helps and the pool already has
   enough idle earning sessions to take every order. Never create more orders
   than the current idle-session count. When no earner is waiting yet, send one
   whole-task order.
3. Give every order an objective, all necessary context, the exact artifact
   expected, and an acceptance test.
4. Call `overflow_delegate` once with the complete `orders` array. Do not call
   it once per order.
5. The call can wait for up to one hour for someone to open `/earn` and finish.
   Do not perform the delegated work while it is waiting.
6. Review what returns. Apply one precise correction through another order only
   when necessary. Keep the final response compact because the returned
   artifacts are already visible in the tool result.

The worker cannot see this conversation or the requester's files. Include what
it needs in the order. Do not include secrets or unrelated private material.

Use this skill explicitly when the user invokes `/work`. At or below the
configured remaining-allowance threshold, the session-start notice makes this
the default execution path, but the current session still owns intent, review,
and final integration. The dogfood build currently uses 80%; the intended
product threshold is 10%.
