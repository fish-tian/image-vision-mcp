#!/usr/bin/env sh
set -eu

NAME="${NAME:-image-vision}"
SCOPE="${SCOPE:-user}"
CONFIG_PATH="${IMAGE_VISION_CONFIG:-$HOME/.image-vision-mcp/config.json}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command '$1' was not found in PATH." >&2
    exit 1
  fi
}

mask_token() {
  token="$1"
  length=${#token}
  if [ "$length" -le 8 ]; then
    printf "********"
  else
    prefix=$(printf "%s" "$token" | cut -c 1-4)
    suffix_start=$((length - 3))
    suffix=$(printf "%s" "$token" | cut -c "$suffix_start"-"$length")
    printf "%s...%s" "$prefix" "$suffix"
  fi
}

confirm_default_yes() {
  prompt="$1"
  printf "%s [Y/n] " "$prompt"
  read -r answer
  case "$answer" in
    n|N|no|NO|No) return 1 ;;
    *) return 0 ;;
  esac
}

read_optional() {
  prompt="$1"
  default_value="$2"
  if [ -n "$default_value" ]; then
    printf "%s [%s]: " "$prompt" "$default_value"
    read -r value
    if [ -n "$value" ]; then
      printf "%s" "$value"
    else
      printf "%s" "$default_value"
    fi
  else
    printf "%s: " "$prompt"
    read -r value
    printf "%s" "$value"
  fi
}

json_escape() {
  printf "%s" "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

require_command node
require_command claude

AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-}"
BASE_URL="${ANTHROPIC_BASE_URL:-}"
MODEL="${QWEN_MODEL:-}"

if [ -n "$AUTH_TOKEN" ]; then
  masked=$(mask_token "$AUTH_TOKEN")
  if ! confirm_default_yes "Found ANTHROPIC_AUTH_TOKEN=$masked in environment. Use it for config?"; then
    AUTH_TOKEN=""
  fi
fi

if [ -z "$AUTH_TOKEN" ]; then
  printf "ANTHROPIC_AUTH_TOKEN: "
  stty -echo
  read -r AUTH_TOKEN
  stty echo
  printf "\n"
fi

if [ -z "$AUTH_TOKEN" ]; then
  echo "ANTHROPIC_AUTH_TOKEN is required." >&2
  exit 1
fi

if [ -n "$BASE_URL" ]; then
  if ! confirm_default_yes "Found ANTHROPIC_BASE_URL=$BASE_URL in environment. Use it for config?"; then
    BASE_URL=""
  fi
fi

if [ -n "$MODEL" ]; then
  if ! confirm_default_yes "Found QWEN_MODEL=$MODEL in environment. Use it for config?"; then
    MODEL=""
  fi
fi

if [ -z "$BASE_URL" ]; then
  BASE_URL=$(read_optional "ANTHROPIC_BASE_URL (optional)" "")
fi

if [ -z "$MODEL" ]; then
  MODEL=$(read_optional "QWEN_MODEL" "openai/qwen3.6-plus")
fi

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENTRYPOINT="$ROOT/dist/index.js"

if [ ! -f "$ENTRYPOINT" ]; then
  echo "Cannot find bundled server at $ENTRYPOINT. Make sure the release zip was extracted completely." >&2
  exit 1
fi

CONFIG_DIR=$(dirname "$CONFIG_PATH")
mkdir -p "$CONFIG_DIR"

AUTH_TOKEN_ESCAPED=$(json_escape "$AUTH_TOKEN")
BASE_URL_ESCAPED=$(json_escape "$BASE_URL")
MODEL_ESCAPED=$(json_escape "$MODEL")

if [ -n "$BASE_URL" ]; then
  BASE_URL_LINE="    \"baseUrl\": \"$BASE_URL_ESCAPED\","
else
  BASE_URL_LINE=""
fi

cat > "$CONFIG_PATH" <<EOF
{
  "api": {
    "authToken": "$AUTH_TOKEN_ESCAPED",
$BASE_URL_LINE
    "model": "$MODEL_ESCAPED",
    "maxTokens": 64000,
    "defaultPrompt": "Please analyze the image content."
  },
  "cache": {
    "dir": "~/.image-vision-cache",
    "ttlHours": 24,
    "maxMb": 500,
    "lockTimeoutMs": 5000
  },
  "image": {
    "fetchTimeoutMs": 30000,
    "maxBytes": 20971520
  },
  "log": {
    "level": "info"
  }
}
EOF

echo "Wrote config: $CONFIG_PATH"
echo "Registering Claude Code MCP server '$NAME'..."
claude mcp add -s "$SCOPE" "$NAME" -- node "$ENTRYPOINT"

echo
echo "Installed MCP server:"
claude mcp get "$NAME"
