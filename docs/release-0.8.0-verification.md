# Overflow 0.8.0 verification

8 September 2026. Implements the approved onboarding/dashboard plan and its final correction: the public dashboard has zero buttons. All task actions stay in the plugin.

## Implemented

- Google remains mandatory for plugin identity. Its final setup page shows the supplied Hooks screenshot before completing the normal OAuth return.
- Public Google avatars, available credits, recent activity, and one ordered task list. Dashboard Google login, installation/earn buttons, filters, expandable rows, and decorative background removed.
- New accounts receive 10,000 credits; existing accounts receive a one-time +9,000 while keeping their ledger and reservations.
- A system-shell hook directs the current agent to use the native host allowance tool. Strictly below 10% delegates; exactly 10%, unknown usage, explicit keep-local, and earning work do not. Python and the separate Codex usage subprocess are removed.
- Authenticated plugin activity and presence-only browser sessions drive expiring activity indicators. Merely reading someone else's account never marks them active.
- Requester input uploads stream into private R2 storage. Size, SHA-256, ownership, attachment limits, claim access, link renewal, and retention are enforced. Outputs use the existing private return path.

## Evidence before deployment

- **27 tests passed** across four Workers-runtime test files. These cover credit migration, ledger reservation/refund, queue ownership, Google identity and browser-bound single-use handoff, public field boundaries, presence expiry/multiple tabs, task ordering, input lifecycle, checksum rejection, and input/output byte exchange.
- An integration test uses the actual local Workers R2 binding, verifies checksum rejection leaves no object, and retries successfully with the correct bytes. The production code streams without buffering entire input files.
- Worker dry-run build passed. Shell hook runs with an empty executable search path; it needs only `/bin/sh` and its built-in `printf`.
- Browser checks at desktop and 390px phone widths: zero buttons/links/forms; seven local fixture members and four task states fit without horizontal scrolling; long names, long objectives, and failed avatar loads fall back correctly. These fixture identities never deploy.
- Native `get_usage_limits` works in the current Codex desktop task. This does not establish hook trust or native tool availability on a fresh installation or a second laptop.

## Release and remaining host trial

Deployment and production evidence are appended after the release checks. The next real friend trial must distinguish connected, hook exercised, requested, and earned. Discord membership and a same-account transport self-test do not prove a two-person exchange.

Model enforcement, token-priced credits, automatic background earning, and output-quality adjudication remain deferred. The existing requester schedule still ends after 60 minutes, while a claim can last 90 minutes; private inbox recovery remains available afterward.
