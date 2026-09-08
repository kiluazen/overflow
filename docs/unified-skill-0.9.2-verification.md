# Overflow 0.9.2: one skill

8 September 2026. The package now registers one `overflow` skill. Work and earn
instructions live in its reference files; status uses the requester recovery
branch. An invocation without intent offers Send work, Earn credits, and Check
my work. Old work/earn names are understood as text hints, not separate skills.

Validation: Codex plugin and shared skill validators pass; the Claude manifest
passes strict native validation. Both hook branches pass: Codex emits the
updated routing instruction and Claude exits quietly. The marketplace retains
its existing tolerated Codex-only `policy` field warning in Claude.

Actual Claude Code runs with isolated settings and no MCP servers confirmed:
- Only `overflow:overflow` is registered for this plugin.
- Bare invocation calls the skill and offers the three flows without mutations.
- Earn reads references/earn.md and stops with /mcp sign-in guidance.
- Status reads references/work.md and stops with /mcp sign-in guidance.
- Work without a task asks what to send.

The final clean runs use stdin disconnected from the test harness. Evidence is
in /Users/kushalsm/solo/output/overflow-unified-0.9.2. These checks establish
skill discovery and routing, not a new production exchange. The existing file
transfer, queue, OAuth, and credit implementation was not changed.
