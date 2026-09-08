# Overflow marketplace routes

Checked 8 September 2026 against current official documentation. Research only;
no directory submission, agreement acceptance, or outreach was made.

## Claude Code

The default `claude-plugins-official` marketplace accepts community plugins.
Listing receives basic automated review. The Anthropic Verified badge requires
additional review; listing does not confer that badge. This is separate from
the MCP Connectors Directory.

Submit a public GitHub plugin link through [Claude Console](https://platform.claude.com/plugins/submit).
An individual author can use Console with a Developer, Admin, or Owner role.
The Claude.ai form requires a Team or Enterprise organization and directory
management access. Validate the package with `claude plugin validate` first.
Review time depends on the queue. Once published, GitHub changes are mirrored
and screened automatically without resubmitting the form.

Source: [Anthropic plugin submission documentation](https://claude.com/docs/plugins/submit).
The live page specifies a GitHub link; older search excerpts also mention ZIP
upload, so GitHub is the verified route recorded here.

## OpenAI / Codex

The current portal supports skills-only, MCP-only, and skills plus MCP plugins.
Overflow fits **With MCP**, using its remote server and the unified skill bundle.
A reviewed and published plugin appears in the directory shared by ChatGPT and
Codex. The developer publishes after approval; review timing varies.

Required preparation includes a verified publisher identity, Apps Management
write permission, listing and policy URLs, server/domain/auth details, accurate
tool annotations, starter prompts, and five positive plus three negative test
cases. Authenticated test cases need credentials reviewers can use without
MFA, SMS, or email confirmation. Claude approval does not transfer.

Sources: [OpenAI submission](https://developers.openai.com/plugins/deploy/submission),
[Claude plugin migration](https://developers.openai.com/plugins/guides/submit-claude-plugin).

## Fit and next step

Verified locally: the Overflow repository is public; the package already has a
Claude manifest, skills, a remote HTTP MCP declaration, and a README. Shared
Codex metadata in the marketplace produces a tolerated Claude `policy` warning;
the native Claude plugin manifest passes strict validation.

Plugin source: [kiluazen/overflow/plugins/codex](https://github.com/kiluazen/overflow/tree/main/plugins/codex).
Remote MCP: `https://overflow.kushalsm.com/mcp`.

Claude is the smaller packaging step for the existing product. That is a scope
assessment, not evidence of faster approval. Before actual submission, inspect
the signed-in Console form and finish its required listing fields. For OpenAI,
complete a dedicated submission-readiness pass, especially reviewer sign-in,
public policy/support URLs, and annotations. The current OAuth flow depends on
Google; reviewer access has not been validated against directory requirements.

Confidence: high in the documented routes; unknown approval timing or outcome.
