# Overflow 0.9.0: Claude Code manual work and earn

8 September 2026. The user's final scope excludes local usage servers, bridges,
account scraping, and status-line configuration. This release implements the
manual workflow through supported plugin manifests, skills, and remote HTTP MCP.
The earlier investigation's proposed status-line bridge is not implemented.

## Shipped shape

- Same `kiluazen/overflow` marketplace and `overflow@overflow` plugin identity.
  A native `.claude-plugin/plugin.json` sits beside the Codex manifest in the
  existing source directory. Both hosts use the same remote queue and files.
- `/overflow:work`, `/overflow:work status`, and `/overflow:earn` in Claude Code.
  Missing authentication directs the user to `/mcp` and Google sign-in.
- Claude hooks exit successfully without usage instructions or filesystem,
  network, or allowance reads. Codex keeps its native-tool usage policy.
- Browser opening is optional. Claude can use a connected Chrome integration;
  otherwise it returns the dashboard URL. Missing rename/scheduling capabilities
  do not block the work. Claude never creates a local polling process.
- The Google return page recognizes Claude and shows its manual commands,
  without Codex hook instructions. The authorization identity and PKCE handoff
  are unchanged. Activity is labeled as plugin activity rather than Codex.

## Verified locally

- Claude Code 2.1.263 strict native plugin validation passes.
- A real Claude session loads both namespaced skills and the production HTTP
  MCP server. Both SessionStart and UserPromptSubmit exit 0 with empty stdout
  and stderr, replacing the previous `/hooks/usage.sh` failure.
- Actual `/overflow:work status` invokes the correct skill, submits no job, and
  directs the unauthenticated user to `/mcp`. Actual `/overflow:earn` invokes
  its skill and asks for the earning workspace before claiming anything.
- Both host hook branches also pass with no executables on PATH: Claude emits
  no usage instructions; Codex emits the existing native usage policy.
- 28 Workers-runtime tests pass, including Claude OAuth screen selection and
  preservation of the original OAuth handoff, credits, presence, and private
  input/output attachment behavior. Worker dry-run build passes.

## Remaining evidence

Production deployment, public marketplace installation, and authenticated Claude
results are recorded below as they complete. An unauthenticated MCP discovery or
local schema test is not proof of successful Google login or a two-person task
exchange. Claude Code web/cloud and automatic allowance routing are outside this
release.

## Live results

- Public marketplace installation succeeded in Claude Code as
  `overflow@overflow`, version 0.9.0, using the native Claude manifest.
- Real Google sign-in and the browser callback completed through
  `claude mcp login plugin:overflow:overflow`. Claude reported authenticated;
  the next session reported the MCP server as connected and successfully called
  `overflow_pool` and `/overflow:work status` → `overflow_inbox`.
- The real browser exposed two existing final-screen defects, now fixed:
  `no-referrer` caused HTML form POSTs to send `Origin: null`, and
  `form-action 'self'` blocked the registered callback after the 303. The page
  now sends only its origin and allows the provider-validated callback origin.
  Browser-bound state, same-origin checks, PKCE, and single use remain enforced.
- A real Claude requester uploaded `palette.txt` (28 bytes) with its SHA-256 and
  delegated batch `e7a8dfc3-fb28-43e4-b2e1-fb3931d7e2ce` through `/overflow:work`.
- A separate Claude execution used `/overflow:earn`, claimed job
  `136bdefd-30a1-49cf-b396-dbf55e7544c9`, downloaded the input through Overflow,
  checked its checksum, and produced/uploaded/returned `result.txt`.
- A third Claude execution recovered the batch with `/overflow:work status`,
  downloaded the result from its private URL into the requester directory, and
  checked the ledger. Independent local verification confirms exactly 24 bytes:
  `The palette uses green.` plus a newline. The earner directory was not used
  as the requester's source.
- Same-account ledger reconciled: 100 reserved during delegation, 100 earned on
  return, balance restored to 10,000, reserved returned to 0. Earned/spent each
  increased by 100. This is a real production transport self-test, not proof of
  a two-person or two-laptop exchange.
- No usage server, cache bridge, status-line change, or monitoring process was
  created. Temporary browser-preview and older OAuth-test processes were stopped.

Confidence: **high** for local Claude Code install, Google OAuth, manual work,
earn, input/output byte delivery, and recovery. The next trial is a distinct
requester and earner; no automatic Claude allowance routing is claimed.
