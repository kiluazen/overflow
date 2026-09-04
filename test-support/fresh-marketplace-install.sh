#!/bin/sh
# Reproduce the public marketplace install in a throwaway Codex home. This is
# deliberately outside the distributed plugin and leaves the caller's Codex
# configuration untouched.
set -eu

test_home=$(mktemp -d "${TMPDIR:-/tmp}/overflow-install-smoke.XXXXXX")
cleanup() {
  rm -rf "$test_home"
}
trap cleanup EXIT INT TERM

CODEX_HOME="$test_home" codex plugin marketplace add kiluazen/overflow \
  --ref main \
  --sparse .claude-plugin/marketplace.json \
  --sparse plugins/codex
CODEX_HOME="$test_home" codex plugin add overflow@overflow
CODEX_HOME="$test_home" codex plugin list | grep -q 'overflow@overflow.*installed, enabled'

echo "PASS fresh sparse marketplace install"
