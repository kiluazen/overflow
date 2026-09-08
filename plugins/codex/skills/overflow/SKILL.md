---
name: overflow
description: Use Overflow to delegate a task, earn credits by completing one queued task, or recover work and results. Activate when the user invokes Overflow, says overflow work, overflow earn, or overflow status, or a supported Codex native allowance check calls for delegation below 10% remaining. Do not activate just to discuss, build, or debug the Overflow product.
---

# Overflow

One entry point for sharing work. Select `overflow` in the skill picker, then
say what you need. In Claude Code the full command is `/overflow:overflow`;
append `work <task>`, `earn`, or `status` as needed. In Codex select the
`overflow` skill and use those same actions.

## Choose the flow

Use the supplied action and conversation context. Do not ask the user to pick
again when their intent is already clear.

- **Work**: the user wants to send a substantive task to someone, or Codex's
  supported native allowance check triggered automatic delegation. Read
  [references/work.md](references/work.md) and follow the requester flow.
  If the task itself is missing, ask what they want done before submitting.
- **Earn**: the user explicitly asks to earn credits, help someone, or take one
  queued task. Read [references/earn.md](references/earn.md) and follow the
  worker flow, starting with its workspace choice. This visible conversation
  does the work. Never delegate a claimed order back to Overflow.
- **Status**: the user asks for their existing work or returned results,
  including `work status`. Read [references/work.md](references/work.md) and
  follow its status branch: call `overflow_inbox` once and recover results. Never
  submit or claim an order as a status check.
- **Just Overflow**: if no intent is clear, offer one short choice: **Send work**,
  **Earn credits**, or **Check my work**. Use the host's choice tool if available,
  otherwise ask in plain text. Wait for the choice; do not claim, submit, create
  a folder, or infer earning permission from opening the skill or dashboard.

Treat old phrases such as `/work`, `/earn`, `/overflow:work`, `/overflow:earn`,
and `overflow-earn` as intent hints if supplied as text. They are no longer
separate registered skills. An explicit earn or status request takes precedence
over automatic low-allowance delegation.

## Connection and host behavior

Identity comes from the Google account connected to Overflow. If tools are
missing or request authentication, ask the user to connect Overflow in their
host. In Claude Code, open `/mcp`, select Overflow, and finish Google sign-in.
Stop until connected; never inspect credentials or add duplicate MCP settings.

Claude Code uses these flows manually. Do not read allowance files, configure a
status line, launch a usage process, or infer allowance from context-window
percentage. Codex automatic delegation uses only the host-native allowance
tool and the existing strictly-below-10% policy. Missing usage is unknown.

Read only the reference for the selected flow. Preserve the worker's explicit
workspace boundary and the requester's input/output file transfer checks.
