#!/bin/sh
# Find node, then run the delegation server.
#
# Codex hands an MCP server a trimmed environment, so "command": "node" only
# works when node happens to sit on whatever PATH the server inherits. Node
# usually does not: nvm, Homebrew on Apple silicon, and ~/.local/bin are all
# off a minimal PATH. When it is not found the server simply never starts, the
# delegate tool is silently absent, and the session is left with no way to
# delegate and no explanation. Look in the usual places instead.
set -eu

here=$(cd "$(dirname "$0")" && pwd)

node_bin=$(command -v node 2>/dev/null || true)

if [ -z "$node_bin" ]; then
  for candidate in \
    "$HOME/.local/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node \
    /opt/local/bin/node
  do
    if [ -x "$candidate" ]; then node_bin=$candidate; break; fi
  done
fi

# nvm keeps versions in their own directories and puts none of them on PATH.
if [ -z "$node_bin" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  newest=$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -n 1)
  if [ -n "$newest" ] && [ -x "$HOME/.nvm/versions/node/$newest/bin/node" ]; then
    node_bin="$HOME/.nvm/versions/node/$newest/bin/node"
  fi
fi

if [ -z "$node_bin" ]; then
  echo "Overflow: could not find node. Install Node 22+, or set OVERFLOW_NODE to its path." >&2
  exit 127
fi

# The session hook calls this to find out, cheaply, whether the tool will load.
if [ "${1:-}" = "--check-node" ]; then
  exit 0
fi

exec "${OVERFLOW_NODE:-$node_bin}" "$here/server.mjs"
