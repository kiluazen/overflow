---
name: work
description: Offload work through Overflow when the user says /work or /overflow:work, asks to delegate, or a supported Codex native allowance check reports strictly less than 10% remaining. Keep this task as the coordinator.
---

# /work

Send one self-contained order and bring its result back here.

In Claude Code this command is `/overflow:work`; in Codex it is `/work`.
Claude uses manual delegation only. Do not read allowance files, configure a
status line, launch a usage process, or infer allowance from the context window.

If the argument is `status`, or the user asks about existing work, call
`overflow_inbox` once and show the returned results/status. Do not submit a new
order. If Overflow tools are missing or request authentication, tell a Claude
Code user to open `/mcp`, select Overflow, and complete Google sign-in. Stop
until connected; do not read credentials or add a duplicate MCP configuration.

1. When opening the board, use the Codex browser panel if available. In Claude
   Code, use its connected Chrome integration only if it is available. Call
   `overflow_touch` with `openDashboard: true` immediately before opening its
   returned URL so browser activity is attributed. If no browser tool is
   available, include `https://overflow.kushalsm.com` as a link in the final
   confirmation and continue the task. Opening the board is optional.
2. Package the substantive task with its objective, necessary context, exact
   artifact, and acceptance test. The worker cannot see this conversation or
   your filesystem. Describe what success requires, not just the activity.
3. Include the actual files the task needs. For each required local input,
   compute its byte size and SHA-256, call `overflow_prepare_input_upload`,
   and upload the bytes to its URL. Check the upload response before proceeding.
   Include the returned IDs in the order's `inputArtifactIds`. Up to 10 files,
   50 MiB each, 200 MiB total per order. For a folder, make a portable ZIP of
   the needed files; exclude credentials, dependency caches, and unrelated
   files. Do not treat a local path as a transferred file. Accessible remote
   references can remain links when that is sufficient for the task.
4. Call `overflow_delegate` exactly once with one complete order. If an input
   upload failed, fix it before submitting. Do not duplicate the delegated
   execution here. A successful call means the order is waiting for someone
   to claim it; it does not prove a computer has started.
5. In Codex only, if the host supports task heartbeats, create one attached to this task,
   named `Overflow <batch UUID>`. Schedule `FREQ=MINUTELY;INTERVAL=20;COUNT=4`:
   Codex counts the creation-time occurrence, leaving future checks at 20,
   40, and 60 minutes. Retain the actual automation ID returned by the host.
   Its prompt must call `overflow_collect` once for this batch and end quietly
   if incomplete. If complete, review and return the result and artifact links
   here, then delete that automation. On its third incomplete run, say only
   that the work has not returned and can be recovered later through Overflow.
   Do not create a second heartbeat for the same batch. In Claude Code, skip
   this scheduling step. Do not create cron jobs, loops, or background workers.
6. Say briefly that the task is waiting for a computer, and give the actual
   reserved/available credits from the tool response. Mention scheduled checks
   only if creation succeeded. If heartbeats are unavailable, say that the user
   can ask for the result later (`/overflow:work status` in Claude Code). End
   the turn; do not poll or invent progress.
7. When asked about the work later, call `overflow_inbox` once. It recovers the
   requester's batches without a saved ID. Read the artifact and open/download
   returned files before presenting the outcome. A necessary correction can
   be a new, precise order; do not resubmit the original as a status check.

Automatic delegation uses the host-native allowance reading: the main bucket's
most constrained available window must have strictly less than 10% remaining.
Exactly 10% is outside that condition. Respect a keep-local instruction. Do not
delegate greetings, status requests, setup, `/earn`, or work already claimed
from Overflow. Missing usage data is unknown, not low allowance.

Overflow identity is the Google account connected during installation. Never
invent an identity or read authentication files to make a tool call.
