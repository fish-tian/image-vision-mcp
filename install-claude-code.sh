#!/usr/bin/env sh
set -eu

NAME="${NAME:-image-vision}"
SCOPE="${SCOPE:-user}"
QWEN_MODEL="${QWEN_MODEL:-openai/qwen3.6-plus}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command '$1' was not found in PATH." >&2
    exit 1
  fi
}

require_command node
require_command claude

if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  printf "ANTHROPIC_AUTH_TOKEN: "
  stty -echo
  read -r ANTHROPIC_AUTH_TOKEN
  stty echo
  printf "\n"
fi

if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo "ANTHROPIC_AUTH_TOKEN is required." >&2
  exit 1
fi

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENTRYPOINT="$ROOT/dist/index.js"

if [ ! -f "$ENTRYPOINT" ]; then
  echo "Cannot find bundled server at $ENTRYPOINT. Make sure the release zip was extracted completely." >&2
  exit 1
fi

set -- claude mcp add -s "$SCOPE"
set -- "$@" -e "ANTHROPIC_AUTH_TOKEN=$ANTHROPIC_AUTH_TOKEN"
set -- "$@" -e "QWEN_MODEL=$QWEN_MODEL"
if [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
  set -- "$@" -e "ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL"
fi

echo "Registering Claude Code MCP server '$NAME'..."
set -- "$@" "$NAME" -- node "$ENTRYPOINT"
"$@"

echo
echo "Installed MCP server:"
claude mcp get "$NAME"
