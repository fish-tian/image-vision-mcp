# Claude Code Installation

This guide installs `image-vision-mcp` from the release zip and registers it as a Claude Code MCP server.

## Requirements

- Node.js available as `node`
- Claude Code CLI available as `claude`
- An Anthropic-compatible API token

Check:

```bash
node --version
claude --version
```

## What The Installer Does

The installer:

- Checks `node` and `claude`.
- Looks for `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, and `QWEN_MODEL` in the current shell.
- If those environment variables exist, asks whether to use them. The default answer is yes.
- Masks the token when showing it.
- Writes user config to `~/.image-vision-mcp/config.json`.
- Registers Claude Code with:

```bash
claude mcp add -s user image-vision -- node /path/to/dist/index.js
```

The token is not written into the repository or the release folder. It is written only to the user config file on your machine.

## Windows PowerShell

1. Download the release zip from GitHub Releases.
2. Extract the zip to a permanent folder, for example:

```powershell
Expand-Archive .\image-vision-mcp-v1.0.0.zip -DestinationPath "$HOME\mcp\image-vision-mcp"
```

3. Run the installer:

```powershell
cd "$HOME\mcp\image-vision-mcp"
.\install-claude-code.ps1
```

You can also pass values explicitly:

```powershell
.\install-claude-code.ps1 `
  -AnthropicAuthToken "your-token" `
  -AnthropicBaseUrl "https://your-compatible-endpoint" `
  -QwenModel "openai/qwen3.6-plus"
```

## macOS / Linux

1. Download and extract the release zip:

```bash
mkdir -p "$HOME/mcp/image-vision-mcp"
unzip image-vision-mcp-v1.0.0.zip -d "$HOME/mcp/image-vision-mcp"
```

2. Run the installer:

```bash
cd "$HOME/mcp/image-vision-mcp"
chmod +x ./install-claude-code.sh
./install-claude-code.sh
```

You can also pass values with environment variables:

```bash
ANTHROPIC_AUTH_TOKEN="your-token" \
ANTHROPIC_BASE_URL="https://your-compatible-endpoint" \
QWEN_MODEL="openai/qwen3.6-plus" \
./install-claude-code.sh
```

## Change Configuration After Install

Edit:

```text
~/.image-vision-mcp/config.json
```

Example:

```json
{
  "api": {
    "authToken": "your-token",
    "baseUrl": "https://your-compatible-endpoint",
    "model": "openai/qwen3.6-plus",
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
```

Configuration priority:

```text
environment variables > config.json > built-in defaults
```

Set `IMAGE_VISION_CONFIG` to use a custom config file path.

## Verify

```bash
claude mcp get image-vision
```

Then restart Claude Code or start a new Claude Code session and use the `analyze_image` tool.

## Remove

```bash
claude mcp remove image-vision
```
