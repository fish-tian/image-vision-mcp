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

## Windows PowerShell

1. Download the release zip from GitHub Releases.
2. Extract the zip to a permanent folder, for example:

```powershell
Expand-Archive .\image-vision-mcp-v1.0.0.zip -DestinationPath "$HOME\mcp\image-vision-mcp"
```

3. Run the installer:

```powershell
cd "$HOME\mcp\image-vision-mcp"
.\install-claude-code.ps1 -AnthropicAuthToken "your-token"
```

Optional endpoint/model:

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
ANTHROPIC_AUTH_TOKEN="your-token" ./install-claude-code.sh
```

Optional endpoint/model:

```bash
ANTHROPIC_AUTH_TOKEN="your-token" \
ANTHROPIC_BASE_URL="https://your-compatible-endpoint" \
QWEN_MODEL="openai/qwen3.6-plus" \
./install-claude-code.sh
```

## Verify

```bash
claude mcp get image-vision
```

Then restart Claude Code or start a new Claude Code session and use the `analyze_image` tool.

## Remove

```bash
claude mcp remove image-vision
```
