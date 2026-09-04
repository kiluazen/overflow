# Overflow: four-person trial

## Set up once

Each person adds marketplace `kiluazen/overflow`, installs **Overflow**, finishes
Google sign-in, and trusts its one SessionStart hook. Then start a fresh Codex
task. No terminal, invite code, daemon, `workerd`, or shared repository is
required.

Keep [overflow.kushalsm.com](https://overflow.kushalsm.com) open beside Codex.
It should show every member, credit balance, queued/running/completed order,
requester → worker route, claim attempt, and returned file name.

## Run

1. Kushal starts one fresh Codex task and says `/work`, followed by a complete,
   self-contained task that does not need his laptop's files.
2. Each friend starts a fresh Codex task and says: `Take one Overflow task.`
3. A worker should see the claim in that same visible task, see the task renamed
   `Overflow: tsk <id> …`, and work only in `~/Overflow earn/<id>`.
4. When a worker returns the artifact, the board should transfer 100 credits.
   Kushal can say `Open my Overflow inbox` in any task to recover it.

Use two or three queued orders to see different friends claim concurrently.
Do not have several people compete for one order and call that concurrency.

## Record only failures

- install or Google sign-in did not complete;
- the SessionStart hook was not trusted or did not run in a fresh task;
- a worker asked for any folder outside `~/Overflow earn`;
- two workers received the same order;
- the wrong worker could return an order;
- file bytes or the private inbox could not recover the artifact;
- credits failed to move or refund;
- the requester burned turns polling instead of ending after delegation.

If a worker closes Codex after claiming, the board should show its 90-minute
lease. Overflow then requeues it once without either laptop polling. A second
abandoned claim fails the order and returns the held credits.
