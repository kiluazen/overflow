# Automatic OAuth return after Google sign-in

8 September 2026. Deployed to production and verified with a real Claude login.

Source commit: `e55cc39`. Cloudflare Worker version:
`a6a1cc6b-4e49-46c8-ae86-7f880a799a2e`.

The proposed Claude usage adapter was removed before release. Claude remains
manual `/overflow:work` and `/overflow:earn`; Codex retains its native usage
hook. Both Claude hooks were verified to exit quietly, and both Codex hooks
still emit the native `get_usage_limits` policy. The temporary adapter test
installations were deleted; normal Claude settings have no Overflow status line.

The former "Google connected" page held a pending Overflow OAuth authorization.
Its "Return to Claude/Codex" button posted to `/auth/complete`, which issued the
authorization code and redirected to the registered host callback. Closing the
page instead left the host unconnected.

The Google callback now completes the original OAuth request immediately and
returns HTTP 303 to the provider's callback URL. There is no intermediate HTML,
JavaScript, timer, or return-button click. The original state, PKCE challenge,
scope, browser binding, and verified Google identity remain in the flow.
A Durable Object consume-once operation prevents concurrent completion of the
same consent. Account initialization and browser presence are preserved.
Previously opened forms remain supported until their existing tokens expire.

`npm test` passed all 29 tests. The tests cover immediate completion and callback
delivery, Claude's loopback callback, original state/PKCE preservation, concurrent
callback replay, wrong-browser requests, invalid identity claims, and old pending
form expiry/origin/single-use protection. `npm run check` passed the Worker dry
run, and `git diff --check` passed.

The unit tests mock provider completion and Google responses. Separately, after
deployment, `claude mcp login plugin:overflow:overflow --no-browser` started a
real Claude Code authorization. Selecting the existing Google account navigated
straight to Claude's localhost callback with no Overflow return-button click.
The CLI reported authentication successful and exited with code 0. Claude's
callback page displayed "Authentication successful" and "You can close this tab
and return to Claude Code."

A new Claude process then called `overflow_pool` successfully using the newly
connected account. Its JSONL evidence is in
`/Users/kushalsm/solo/output/overflow-oauth-direct-2026-09-08/authenticated-pool.jsonl`.
Both production hostnames and the protected-resource metadata endpoint returned
HTTP 200. Fresh Codex OAuth was not separately exercised; its shared completion
path and original state/PKCE preservation are covered by the unit tests.

Once navigation reaches Claude/Codex's callback, that host controls its success
page and app focus. Overflow cannot guarantee that the browser tab closes:
[browser restrictions on window.close](https://developer.mozilla.org/en-US/docs/Web/API/Window/close).
