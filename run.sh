#!/usr/bin/env sh
# macOS / Linux launcher. See scripts/run.mjs for the commands.
command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required: https://nodejs.org" >&2; exit 1; }
exec node "$(dirname "$0")/scripts/run.mjs" "$@"
