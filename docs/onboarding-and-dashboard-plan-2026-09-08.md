# Overflow: onboarding and dashboard cleanup

**Approved 8 September 2026 · Implementation record: [release verification](./release-0.8.0-verification.md)**

Final review supersedes the earlier controls proposal: **zero dashboard buttons**. All actions remain in the plugin. Use the familiar last-seen mechanic; remove anything the board does not need to show people, credits, and task progress.

The next release should let the seven Discord members connect once, see each other's credits and activity, and exchange a task with all its necessary files. The dashboard will have two subjects: **people and their credits**, then **work moving between them**.

This replaces the previous proposal to remove Google from plugin setup. **Keep plugin Google OAuth. Remove dashboard login.** Model selection, API-style pricing, and a broader quality system are outside this release.

## 1. The experience I will build

1. Add the marketplace and install Overflow.
2. Connect Google once.
3. See the hook setup instruction with your screenshot; return to Codex and approve the hook.
4. Start using Codex normally. Overflow checks allowance through the host and delegates substantive work when **less than 10% remains**.
5. Opening the dashboard shows everyone's avatar, credits, recent activity, and one task list. No login gate or personal-account panel.
6. A queued task shows **“Waiting for a computer”**. Once someone runs `/earn` and claims it, the row shows that person working on it.
7. The earner receives the brief and actual input files, produces the output in their chosen workspace, and returns it to the requester.

I interpret your “<10 usage limit” literally: **remaining allowance <10%**, replacing the current ≤15% rule. At exactly 10%, normal work continues. The starting grant becomes **10,000 credits**; the reward/cost remains **100 per completed order**.

## 2. A simpler usage check

**Target: no Python, Node, separately installed Codex CLI, or extra background service for the usage check on the trial machines.**

There is a better path available in this Codex session: the host's native `get_usage_limits` tool. I called it successfully during this review. We should use that capability instead of launching another App Server to read information the current host already knows.

I will replace the current executable usage probe with a minimal hook that emits instructions using the system shell. The agent then reads usage through the native host tool. The hook itself will not parse credentials, launch another Codex process, or make a separate model call.

The tradeoff is one native tool call inside the existing agent turn, with the agent applying the threshold. This is not a deterministic background watcher, and crossing the threshold during a long uninterrupted turn is still detected on the next user prompt.

The intended behavior:

- Session-start instructions establish the policy. A `UserPromptSubmit` hook refreshes the instruction before a new user turn, so a long-lived task can catch the threshold on the next prompt.
- At most one native allowance read per new substantive user turn. No polling after every tool call and no idle model turns.
- Use the most constrained available window in the main Codex allowance bucket. Missing data is unknown, never zero.
- Below 10%, delegate a suitable substantive task. Respect an explicit keep-local instruction.
- `/work` still delegates manually. `/earn`, an already-claimed earning task, status questions, and result collection must not recursively delegate themselves.
- A failed usage read leaves normal work available. Explain a setup problem once when actionable; avoid repetitive warnings.
- Never infer which model is running from the allowance bucket.

**First implementation check:** install this minimal hook in a fresh Codex task and prove that it can trigger a native usage read without `python3` or a separately installed `codex` on the hook's path. Repeat on a second trial machine. Native tool availability in this task does not prove availability in every installation.

If that host capability is absent, I will report the precise compatibility gap and preserve manual `/work` and `/earn`; I will not quietly substitute another required runtime and claim dependency-free onboarding. Automatic usage checks are only marked ready after that test passes. Confidence: **high** that the native tool works here; **moderate** in this proposed integration until the fresh-install test.

Codex documents hook context injection for `SessionStart` and `UserPromptSubmit`; its documented hook input does not include an allowance snapshot. This design therefore asks the current agent to use the host tool, rather than claiming the hook receives usage automatically. [Official hook documentation](https://developers.openai.com/codex/hooks/).

## 3. Keep OAuth, then show the hook setup

I will retain the existing Google authorization connection and individual accounts. Google already receives the `profile` scope request; I will persist the returned profile picture when available, alongside the display name and existing stable identity.

After successful Google authentication, show a short final setup screen:

> **Google connected**
>
> Return to Codex, open Overflow → Hooks, and approve the hook. This lets Overflow check when you have less than 10% allowance left.
>
> **Return to Codex**

Place your screenshot immediately below that instruction, with emphasis through page layout around its Hooks section. The supplied screenshot shows where Hooks lives; it does **not** show the final trust button. During implementation I will capture the actual approval step from the tested host and add it only if it makes that action clearer.

![Supplied reference showing the Overflow Hooks section](/Users/kushalsm/solo/overflow/docs/assets/codex-overflow-hooks-reference.png)

Implementation detail: the screen sits after Google identity verification and before the final OAuth return to Codex. Its button completes the normal authorization handoff. Keep the pending state short-lived, browser-bound, and single-use; mint the final authorization code on continuation so time spent reading the screenshot does not waste its lifetime. Do not show “plugin connected” before Codex has completed the connection.

The web page cannot approve a native Codex hook or prove that approval happened. It directs the person to the real control. Verify the return path end to end, including refresh, expiry, and a cancelled connection. If the host closes the browser or owns the final success screen, use this Overflow-controlled final step rather than trying to replace the host's page.

We will call it the **usage hook** in the UI. “Post hook” is not the current trigger: usage should be checked before deciding to do work, not after the work has already consumed allowance.

## 4. The dashboard: people first, one list second

Keep the existing restrained visual direction. Remove the explanatory blocks, the four persistent task tabs, dashboard Google sign-in, “My credits,” and the reward caption under `/earn`.

The layout will be approximately:

```text
overflow

[avatar •] Kushal       [avatar] Member       [avatar] Member
           10,000                 10,000               10,000

Tasks
Research brief          requester → —         Waiting for a computer
Landing page review     requester → earner    Working
Book comparison         requester → earner    Done
```

The member examples are placeholders, not claims about who has installed.

### People and credits

- Show each initialized member's Google avatar, display name, and **available credits**. Use initials when the picture is missing or fails to load.
- Show recently active people first, with a stable name order within each activity group. This is not a score leaderboard.
- Refresh balances from the server after changes. Reserve/refund behavior stays intact; the number shown is what the person can spend now.
- Provide an activity dot and a short hover/tap detail such as “Active in Codex 1m ago.”
- Make this readable without any dashboard login. Public member data is limited to display identity, credit balance, and coarse activity; exclude email, Google subject IDs, tokens, and Codex allowance.
- Show real initialized accounts, not seven fabricated cards based on Discord membership.

### Tasks

- One list by default. Queued and working tasks come first, newest-created first within that group. Terminal tasks follow, newest-finished first. Use a stable tie-breaker so refreshes do not shuffle equal rows.
- No filters, tabs, action buttons, or menus. The single ordered list is the complete dashboard task surface.
- Each row contains a short objective, requester → earner identity, compact status, and time. No long expected-output paragraphs or repeated explanations in the list.
- No expandable rows. Detailed briefs and private file links stay in the authorized plugin task.
- Empty state: **“No tasks yet.”**
- `/earn` lives only in the plugin. The agent confirms earned credits when an order finishes.

Remove the website command-copy and installation controls entirely. Opening the dashboard triggers no task action.

## 5. Activity dots without pretending to know the whole laptop

**A hook firing is evidence of activity at that moment. It is not a lasting online connection.** I will use it as a recent-activity signal, not leave someone green indefinitely.

Implement dedicated presence records, separate from account updates and job leases:

- When the hook's instruction runs in the agent, make one authenticated Overflow activity call. Normal user-originated Overflow tool calls also refresh that person's activity.
- Never mark a requester active merely because an earner completed their job or because the server read their account.
- An authenticated Codex activity event gives an **“Active recently”** dot for two minutes, then fades to a last-active time. These are initial product settings, not proof of continuous availability.
- A visible dashboard can send a lightweight heartbeat every 30 seconds, expiring after 90 seconds. Its detail says **“Viewing Overflow”**; it does not imply Codex is executing work.
- Bind browser presence to a limited session established during plugin OAuth, without asking the person to sign in again. If OAuth used a different browser, let the plugin open a one-time handoff URL in its Codex browser panel. Exchange it for a presence-only cookie and immediately remove the token from the address bar. Anonymous viewers cannot select another member's identity.
- Stop browser heartbeats when hidden. A best-effort page-close signal can clear presence sooner, but expiry is the reliable fallback. Combine multiple sessions so closing one does not mark another active session offline.

This gives the dashboard the social signal you want: people have been around recently. It does not claim an idle laptop will accept work. `/earn` remains explicit, and Discord remains useful for arranging an exchange. Continuous laptop-wide presence would require a resident connection; I will not add a daemon for this release.

Confidence: **high** in the distinction between recent activity and reachability; **moderate** in these timing choices until we see the seven people's use.

## 6. Make queued work legible

Use a simple status progression:

**Waiting for a computer → Working with [name] → Done**

“Waiting for a computer” is accurate for a queued order. Do not imply active matchmaking, a reserved machine, or an estimated start time when nobody has claimed it.

After delegation, the agent gives one brief confirmation and opens the board. It does not narrate an imaginary search or emit repeated progress messages. The row changes when the backend receives a real claim or return.

I will also remove the skill's false claim that submission already verifies worker availability. Keep account inbox recovery and the current scheduled checks, but only promise checks when the host actually creates them. State a check schedule's end accurately; do not present it as guaranteed completion. Reworking the entire scheduler and job-expiry policy is outside this cleanup.

## 7. Let the requester send actual files

Add a generic **input attachments** path alongside existing returned artifacts. It should handle documents, images, data, and a portable source archive without requiring a separate integration for each type.

### User flow

1. The requester says what to do and identifies the necessary files/assets in the current task.
2. Their agent selects the required inputs, uploads the bytes to Overflow, and includes attachment IDs in the order.
3. Overflow makes the job claimable only after all declared attachments are uploaded and validated.
4. The earner receives the brief and a file manifest, downloads the inputs into that job's `inputs/` directory, and works from them.
5. Outputs return through the existing artifact path. The requester does not manually host either inputs or outputs.

### What I will implement

- Add `overflow_prepare_input_upload` and an `inputArtifactIds` field on delegation. Reuse the R2 storage machinery, with explicit input ownership rather than pretending the requester has a worker claim.
- Start with up to **10 input files**, **50 MiB per file**, and **200 MiB total per order**. A source folder can be a ZIP inside those limits. These are proposed initial limits; existing output limits remain separate.
- Store original filename, safe download filename, content type, size, and checksum. Keep file bytes out of the model's textual order payload.
- Verify upload completion, ownership, size, and integrity before accepting the order and reserving credits. A missing upload cannot create a half-usable job.
- Return fresh input download access to the requester and the **current claiming worker** only. Requeue invalidates the previous claim's input access. The next claimant can fetch the same inputs through newly issued access.
- Support refreshing expired input links during a valid claim. Keep the original attachment IDs stable across retries.
- Remove abandoned, unattached uploads after 24 hours. Keep attached inputs through queued/claimed states and for 30 days after the job finishes; perform cleanup independently of a person's browser being open.
- Download only into the selected job workspace. Validate archive paths and symlinks before extraction, and do not automatically execute uploaded scripts. Choose necessary files, not the requester's entire project or unrelated credentials.
- Keep the existing text-only order path working. Preserve separate success criteria in every brief so the earner knows what to check.

The key test is physical: a file exists on laptop A, its bytes arrive on laptop B without shared disk access, B uses it, and A retrieves the finished output. Merely passing a local path or a URL string does not pass.

## 8. Increase the starting grant safely

- New accounts start with **10,000** credits.
- Existing accounts get a **one-time +9,000** grant. Preserve their earned, spent, and reserved amounts instead of resetting the ledger.
- Record the grant migration so retries, reconnects, and repeated deploys cannot award it twice. Accounts created under the new grant are marked already migrated.
- Keep the current 100-credit order cost/reward and refund semantics. Remove promotional explanations of that number from the dashboard.

An existing account with 900 available and 100 reserved becomes **9,900 available and 100 reserved**. Someone who has already earned additional credits keeps them.

## 9. Execution order and proof

| Step | Deliverable | Done when |
|---|---|---|
| 1. Native usage check | Minimal hook, <10% policy, no external usage probe | Fresh installed tasks read native limits without Python or a separate CLI; exactly 10% stays local, below 10% delegates; earning never delegates itself. |
| 2. OAuth onboarding | Google profile picture capture and screenshot-guided return | One login completes the plugin connection; the person finds and approves the real hook; the dashboard needs no second login. |
| 3. Credits and dashboard | Idempotent grant migration, public member strip, one read-only task list | New and existing balances are correct; missing avatars work; sorting is correct on desktop and phone widths. |
| 4. Activity | Authenticated activity events and browser heartbeat expiry | A real event lights the correct person; stale activity fades; sleep/disconnect/hidden tabs cannot leave a permanent green dot. |
| 5. Input files | Upload, attach, claim, download, refresh and cleanup | Two accounts exchange actual input and output bytes; unauthorized or expired claims cannot fetch inputs. |
| 6. Release verification | Matching plugin/marketplace versions, updated instructions and deployment checks | A friend installs the release and completes an exchange in the actual host; staging and production evidence are recorded separately. |

Run focused tests for credit migration, attachment access/lifecycle, public response fields, presence expiry, and queue sorting. Test OAuth and hook trust in the real browser/host. A mocked threshold test checks the branch; it does not prove the host supplies the signal.

The trial record will distinguish **connected**, **hook exercised**, **requested**, and **earned** for each trial member. We cannot count a Discord join as any of those. The goal is all seven connected and able to participate, with at least one distinct-account exchange fully verified before calling the flow ready.

## 10. Scope and review boundary

The user approved implementation on 8 September, with the final correction that the dashboard has zero buttons. Implementation and validation evidence are recorded separately; a shipped release does not prove that seven people have installed it.

The approved scope is the steps above. Model enforcement, token-priced credits, automatic background earning, automatic Discord messages, sophisticated matching, and a new output-quality system are deferred. The earner will continue to work against a clear artifact and acceptance test.

Source checked for this plan: [hooks](/Users/kushalsm/solo/overflow/plugins/codex/hooks/hooks.json), [native usage hook](/Users/kushalsm/solo/overflow/plugins/codex/hooks/usage.sh), [Google callback](/Users/kushalsm/solo/overflow/relay/src/oauth.js), [presence-only browser identity](/Users/kushalsm/solo/overflow/relay/src/browser-presence.js), [board](/Users/kushalsm/solo/overflow/relay/src/board.js), [MCP tools](/Users/kushalsm/solo/overflow/relay/src/mcp.js), and [queue/accounts/artifacts](/Users/kushalsm/solo/overflow/relay/src/index.js). Host-native usage was tested read-only during this review. See the release verification record for what has been tested and what still needs a real friend trial.
