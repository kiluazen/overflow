# Overflow: where we are

**8 September 2026 · A user-flow audit and proposal for the seven-person Discord trial**

Overflow has the machinery for exchanging work: accounts, a durable queue, claims, file transfer, private result recovery, and reciprocal credits. It does **not** yet provide the experience of seven installed laptops automatically helping each other. A person must explicitly start `/earn`, and that session takes one queued task.

**My recommendation:** get the seven people installed, prove one exchange between two distinct accounts, then have everyone complete an exchange. Simplify Google sign-in while preserving individual identities. Keep automatic delegation as the main product story, but make waiting and availability honest. Keep credits flat; defer dollar pricing.

Confidence is **high** in the source-level flow and the production snapshot below, **moderate** that the proposed onboarding is the right simplification, and **unknown** for a fresh seven-person installation and cross-laptop round trip on their actual Codex versions.

## 1. What we can actually demonstrate today

You report seven Discord members. The live server snapshot at **12:10 IST on 8 September** reports:

| Measure | Observed |
|---|---:|
| Initialized Overflow accounts | 1 |
| Recorded jobs | 8 |
| Queued / claimed now | 0 / 0 |
| Completed / failed records | 7 / 1 |

Those are different things from seven installations or seven available workers. Most visible exchanges are founder self-tests. One historical return names Yash Poonia, but the current account count and those historical display names do not establish a second current installation. A dashboard login can also initialize an account; account count is not install telemetry.

The production board loads publicly and its HTML exactly matches the local board source. Anonymous personal-account and MCP requests are rejected as expected. The relay test suite passed **17/17 tests** during this audit. That covers implementation behavior, including ownership and file transfer; it does not substitute for a fresh two-person host test.

## 2. From Discord to using Codex normally

### The setup a new member encounters today

1. Open Codex and add marketplace `kiluazen/overflow`.
2. Install Overflow. The marketplace currently requests authentication **on installation**.
3. Connect Overflow, continue with Google, and return to Codex. That Google identity owns the person's credits, claims, and inbox.
4. Review and trust the usage-check hook.
5. Start a fresh task so the session-start check runs.

A newly initialized account receives **1,000 Overflow credits**. These are internal points, separate from their Codex subscription allowance.

There is a setup dependency we should verify on each friend's machine: the hook invokes `python3`, and its probe invokes the `codex` CLI through a short-lived local App Server process. The desktop app being installed does not, by itself, prove those commands are available in the hook's environment.

### What happens next

| User situation | Current behavior |
|---|---|
| More than 15% main allowance remains at session start | The hook stays silent. Codex works normally. |
| 15% or less remains at startup, resume, or clear | The hook instructs the agent to coordinate and delegate substantive work through Overflow. |
| The allowance check fails | The hook stays silent. Automatic delegation does not activate. |
| Allowance crosses 15% during an ongoing turn | There is no continuous check to catch that crossing immediately. |
| User explicitly invokes `/work` | Manual delegation is available without waiting for the threshold. |
| User only opens the website | No work is delegated or claimed. |
| User installs Overflow and does nothing else | Their laptop does not become a background worker. |

The trigger uses the most constrained reported window in the main allowance bucket. It is an instruction delivered to the agent, not a server that forcibly intercepts all future tasks. Greetings and status questions should not become delegated orders.

There is no clear, persistent product control for “automatic delegation off for this project” today. The user can give a direct instruction to keep a task local, but that is not the same as an explicit setting. The low-allowance hook also assumes the Overflow connection is usable rather than first proving it.

## 3. When work is delegated

This is the intended automatic path after the low-allowance notice; `/work` enters the same path manually.

1. **The current Codex task stays the coordinator.** It opens `overflow.kushalsm.com` in the Codex browser panel once.
2. **The agent writes one self-contained order:** objective, necessary context, expected artifact, and acceptance test.
3. **Overflow queues it durably and reserves 100 credits.** The call returns a batch identifier immediately.
4. **The requesting turn ends.** If the host supports task heartbeats, the instructions schedule result checks at 20, 40, and 60 minutes.
5. **Someone explicitly starts `/earn` and claims it.** Until then, the order waits.
6. **The worker returns text and, where needed, uploaded file bytes.** Results become available to the requester privately.
7. **The requester retrieves and reviews the result.** Later requests can recover it through the account's inbox even if the original batch identifier was lost.

Two gaps change the user's expectations substantially:

- **“Queued” does not mean “a friend's computer has started.”** The backend accepts work without an available worker. The skill's statement that delegation already checks the pool does not correspond to an availability gate in the submit handler.
- **The result checks stop before a worker's maximum claim time.** Three future checks end at 60 minutes; a claim lasts 90 minutes and can start much later. There is no instant backend push into the original task. The finite schedule can finish while the job is still waiting or running.

The heartbeat instructions are also conditional on host support, while their user-facing wording unconditionally promises checks. Actual wake and notification behavior with Codex closed or the laptop asleep remains unverified. Waiting itself uses no model turn, but a scheduled agent check does invoke a turn.

### What actually travels to the worker

The worker receives the written order, not the requester's conversation, filesystem, credentials, or private repository access. A local path in a brief does not transfer that file. The current upload tool is for a claimed worker returning artifacts; there is no equivalent requester-input upload flow.

This makes a research brief with accessible sources an easier first trial than “finish the work in my private local repo.” Private-code delegation needs an explicit, usable input package.

The public board shows task objectives, expected output, requester/worker names, and returned filenames. Full context and result bytes are outside that public board response. Users should understand that the task summary is public, even though the returned artifact is private.

## 4. When someone wants to earn

1. They explicitly say **`/earn`** in a Codex task.
2. The agent settles the working folder first. The suggested option is `<current project>/overflow-earn`; the person can choose another folder. A folder already explicitly chosen in that conversation can be reused.
3. The agent opens the board and asks Overflow for **one** queued order.
4. If none exists, it says so and ends. It does not wait in the background for future work.
5. If a job exists, the agent renames **that same visible task**, creates a job-specific directory, explains the order, and performs it there.
6. It checks the output, uploads any files, and returns the result. A successful return earns **100 credits**. It stops after that order.

The current task's selected model performs the work. Overflow does not launch a separate hidden worker or automatically change the model. The folder boundary is enforced by instructions, not by a separate operating-system sandbox.

The queue selects the first queued remote order. There is no friend picker, task picker, model matching, or Discord-only routing. The server also permits an account to claim its own work. “One order” is the skill's operating rule; the backend does not enforce a one-active-job-per-person limit across multiple sessions.

If the worker explicitly fails the order, the requester gets the reserved credits back. If the worker disappears, the first 90-minute claim expiry requeues the job; the second expired claim fails it and refunds the requester. Waiting between claims is unbounded, so this is **not a guarantee of resolution within three hours**. There is no claim renewal, requester cancellation tool, or timeout for a never-claimed queued order today.

## 5. What opening the website inside Codex actually does

It opens a regular web dashboard inside the app. It does not establish an additional agent connection.

| Website element | What it does today |
|---|---|
| Public task board | Shows available, in-progress, returned, and unfinished work. |
| “Live” indicator | Reports successful board refreshes; it does not count online laptops. |
| `/earn` button | Copies `/earn` and tells the user to paste it into a Codex task. It does not submit the command. |
| “Add to Codex” | Opens installation instructions. It does not install the plugin. |
| Expanded task | Shows more public metadata; it does not claim the job or download the private result. |
| “Sign in” | Starts a separate Google browser login for personal credit display. |
| Signed-in credit display | Shows that account's available Overflow credits, not remaining Codex allowance. |

**A person can be connected in the plugin and still see “Sign in” on the website.** Plugin OAuth and the dashboard cookie are separate sessions. Using the same Google account connects them to the same identity, but completing plugin authorization does not automatically sign the browser in.

That is a product seam worth fixing. The website currently cannot show reliable “plugin installed,” “hook ready,” or “available to earn” status either.

## 6. Removing the Google hurdle without losing who owns what

**My position: Google can go; distinct identities should stay.** Being in Discord does not tell an incoming MCP request which person's inbox or balance it owns. The current pool also does not enforce Discord membership.

There are two separate pieces presently bundled into “OAuth”:

- **Google sign-in:** how Overflow identifies a person today.
- **The Codex-to-Overflow authorization connection:** how requests prove which account they act for.

For this small trial, I would replace the Google step with a lightweight member activation flow:

1. Each person receives an individual invitation/activation code through the Discord onboarding process.
2. During connection, they redeem it and choose a display name. Overflow creates or binds one stable member identity.
3. Codex retains that person's connection, so normal use requires no repeated login.
4. The public board continues to open without sign-in. Personal credits can appear in the agent response initially; a later one-time handoff could connect the browser to the same account.

This is **proposed**, not implemented. The activation must preserve recovery and token refresh so reinstalling does not produce a new balance and lose the old inbox. One shared bearer token for all seven would make them act as one account; it would defeat the exchange model.

The normal Codex authorization screen may still appear. Removing the upstream Google step is a smaller change than guaranteeing a completely screenless installation. Verify that flow in the actual host before promising it.

For an immediate first exchange, the existing Google connection can be used once. For the simplified rollout, implement individual activation and remove the second-login expectation from the core journey. No Discord bot, role hierarchy, or complex membership integration is needed to test the exchange.

## 7. Can we tell whether a laptop is online?

**Today: no, not reliably for the current plugin. Confidence: high.**

Current MCP calls are short requests. The server knows that a call happened, not that a laptop remains awake, reachable, authorized to take work, or capable of starting a model turn.

The backend still exposes `online` and `idle` values from a legacy WebSocket path. Those count legacy sockets, not installed current-plugin laptops. Account `lastSeenAt` is also unsuitable: ordinary account operations update it, including operations caused by someone else finishing work. Browser refreshes prove only that the browser can reach the board.

We need four separate states:

| State | Evidence needed |
|---|---|
| Installed / connected | A successful authenticated setup check from that installation. |
| Reachable recently | A live connection or recent heartbeat from that device. |
| Available to earn | Explicit user opt-in plus a host mechanism able to start work. |
| Working on an order | A valid claim, ideally with progress/lease renewal. |

For seven people, start with explicit sessions: someone says “I can take one now” in Discord, the requester queues a job, and that person runs `/earn`. This tests whether people want the exchange before building unattended availability.

For automatic availability later, build an opted-in worker session with a lightweight non-model heartbeat—for example every 30 seconds, shown as stale after 90 seconds—and a supported way to start the worker turn. These intervals are design suggestions, not shipped behavior. A heartbeat alone cannot wake an agent after its `/earn` turn has ended.

Display “last seen” or “unreachable” when appropriate; a missed heartbeat cannot distinguish sleep from a network interruption. Keep presence separate from the job lease so a brief connection loss does not cause duplicate workers.

## 8. Model control and API-style cost

### Control today

The earner uses the model selected in their visible Codex task. Overflow's order schema has no requested-model field, and its return path does not collect model or token usage. The requester cannot enforce a model through the current product.

The installed Codex App Server schema supports model and reasoning-effort parameters for starting turns. That establishes a possible path for a custom host integration; it does not prove that this distributed plugin can change the model of its already-running task. For the trial, have earners select their model themselves and report it if useful.

Also fix the hook's assertion that an exhausted main allowance means this particular task “has been dropped” onto a named smaller model. Allowance information alone does not verify the actual model running the task.

### Measurement: possible hooks, not reliable billing yet

The locally installed Codex `0.153.4` schema includes per-task token data and an `account/usage/read` endpoint. Its optional task usage includes model groups and estimated credit/USD fields. I made a read-only request for this task: **`threadUsage` returned `null`**. A field existing in a schema is not evidence that every friend's account exposes it.

If cost measurement becomes useful, first test that native estimate on an isolated earning task. Otherwise collect actual usage by model and price uncached input, cached input, and output using a dated rate table. Attribute only the job's usage; a task may contain earlier work or change models. Avoid double-counting reasoning tokens within output, and track separate paid tools separately.

Label the result an estimate with its pricing basis. Subscription allowance percentage is not enough to derive dollars, and API-equivalent cost is not automatically the amount a subscriber was charged.

**Recommendation: keep the present points model during this trial.** We need evidence that useful work comes back, not a speculative billing system.

| Example: A requests, B earns | A available | A reserved | B available |
|---|---:|---:|---:|
| Both start | 1,000 | 0 | 1,000 |
| A queues one order | 900 | 100 | 1,000 |
| B returns it successfully | 900 | 0 | 1,100 |
| Alternatively, the order fails and is refunded | 1,000 | 0 | 1,000 |

Today a worker's successful return triggers payment before the requester reviews quality. There is no acceptance/dispute workflow. For seven friends, collect concrete feedback before deciding whether that needs to change.

## 9. What I would do next

1. **Prove one real exchange now.** Two distinct accounts on two laptops; one portable useful brief; one returned file; requester opens it in the original task; both balances reconcile. Do not count a founder self-claim as this test.
2. **Make installation diagnosable.** Report connection, hook readiness, allowance-read success, and identity after setup. Reconcile marketplace version `0.6.2` with plugin/server `0.7.0`, and verify what each person actually installed.
3. **Simplify identity.** Replace upstream Google with individual activation if the aim is a lower-friction rollout. Keep browser sign-in out of the required path.
4. **Repair waiting behavior.** Say “waiting for someone to claim” accurately, add cancellation/refund for queued work, and make result recovery continue beyond the current 60-minute check window. Test the actual host's closed-app/sleep behavior.
5. **Exercise automatic delegation.** Verify the hook above and at the threshold, connection failures, and an explicit keep-local instruction. Keep `/work` as the manual shortcut rather than making it the only onboarding story.
6. **Have every member request or earn once.** Record setup failures, whether a job gets claimed, useful output received, and whether they choose to do it again. Add automatic worker availability only if the absence of that feature is blocking real demand.

The next milestone is **a friend receives useful work back in the same task without founder intervention**. Seven marketplace installations alone would not establish that.

## Evidence and limits

- Source inspected: relay and board at `11aedd6fbfd1245fcda742eb43dc4d35f583c61b`, which matched remote `main` when checked. During the audit, a separate commit, `b9653c5e24126e915d9fcf093de8729d3a49401d`, updated only the work/earn instructions. Those final changes were also reviewed. This document did not change those instructions, and their installation on other machines was not verified.
- Setup and trigger: [marketplace configuration](/Users/kushalsm/solo/overflow/.claude-plugin/marketplace.json), [plugin manifest](/Users/kushalsm/solo/overflow/plugins/codex/.codex-plugin/plugin.json), [session hook](/Users/kushalsm/solo/overflow/plugins/codex/hooks/session_start.py), [usage probe](/Users/kushalsm/solo/overflow/plugins/codex/scripts/usage_probe.py).
- User journeys: [work instructions](/Users/kushalsm/solo/overflow/plugins/codex/skills/work/SKILL.md), [earn instructions](/Users/kushalsm/solo/overflow/plugins/codex/skills/earn/SKILL.md), [board behavior](/Users/kushalsm/solo/overflow/relay/src/board.js).
- Ownership, queue, credits, leases and public responses: [relay implementation](/Users/kushalsm/solo/overflow/relay/src/index.js), [MCP contract](/Users/kushalsm/solo/overflow/relay/src/mcp.js), [plugin OAuth](/Users/kushalsm/solo/overflow/relay/src/oauth.js), [dashboard sessions](/Users/kushalsm/solo/overflow/relay/src/dashboard-auth.js).
- Live responses: [production snapshot](/Users/kushalsm/solo/output/overflow-status-2026-09-08/evidence/production-readonly.json). Public endpoint checks and exact HTML comparison were read-only; no new production orders or account changes were made for this audit.
- Host capabilities: [generated usage schema](/Users/kushalsm/solo/output/overflow-status-2026-09-08/app-server-schema/v2/GetAccountTokenUsageResponse.json), [turn parameters](/Users/kushalsm/solo/output/overflow-status-2026-09-08/app-server-schema/v2/TurnStartParams.json), [actual usage probe result](/Users/kushalsm/solo/output/overflow-status-2026-09-08/evidence/host-usage-read.json).
- Validation: `npm test` in `relay/` passed 17/17. Fresh installation, Google callback return inside each member's host, unattended work, and cross-laptop delivery were not exercised during this audit. The website interactions above were established from the deployed HTML and its matching handlers, not a new signed-in browser session.

This document records current behavior and proposed changes. It does not deploy or enable those changes.
