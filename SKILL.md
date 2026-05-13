# image-vision-mcp Claude Code Install Skill

[中文](./SKILL.zh-CN.md)

Use this guide to install `image-vision-mcp` from the release zip without running `npm install`, `bun install`, or any platform-specific installer script.

## What The Release Contains

The release zip is self-contained:

- `dist/index.js`: bundled MCP server with runtime dependencies included
- `package.json`: minimal ESM package metadata with `"type": "module"`
- `config.example.json`: user configuration template
- `README.md`: project overview
- `SKILL.md`: this installation guide

## Requirements

- Node.js available as `node`
- Claude Code CLI available as `claude`
- An Anthropic-compatible API token

Check:

```bash
node --version
claude --version
```

## Install

1. Extract the release zip to a permanent directory.

Example locations:

```text
~/mcp/image-vision-mcp
C:\Users\you\mcp\image-vision-mcp
```

2. Register the MCP server with Claude Code.

Use the absolute path to `dist/index.js` inside the extracted release directory.

macOS / Linux:

```bash
claude mcp add -s user image-vision -- node /absolute/path/to/image-vision-mcp/dist/index.js
```

Windows PowerShell:

```powershell
claude mcp add -s user image-vision -- node C:\absolute\path\to\image-vision-mcp\dist\index.js
```

The server reads configuration in this order:

```text
non-empty ~/.image-vision-mcp/config.json values > environment variables > built-in defaults
```

If the Claude Code process can see `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `QWEN_MODEL`, or `ANTHROPIC_MODEL`, the server will use them automatically. If not, create or edit `~/.image-vision-mcp/config.json`.

3. Verify.

```bash
claude mcp get image-vision
```

Start a new Claude Code session and use the `analyze_image` tool.

## Update Configuration

Create or edit:

```text
~/.image-vision-mcp/config.json
```

You do not need to reinstall the MCP server after changing model, base URL, token, cache limits, image limits, or diagnostics settings. Restart Claude Code or start a new session for changes to take effect.

To start from the template, copy `config.example.json` to `~/.image-vision-mcp/config.json`.

Only non-empty config values override environment variables. Empty strings in the config file are treated as unset.

Optional: register with explicit environment variables if Claude Code cannot see your shell environment:

```bash
claude mcp add -s user \
  -e ANTHROPIC_AUTH_TOKEN=your-token \
  -e ANTHROPIC_BASE_URL=https://your-compatible-endpoint \
  -e QWEN_MODEL=openai/qwen3.6-plus \
  -e ANTHROPIC_MODEL=your-diagnostic-text-model \
  image-vision -- node /absolute/path/to/image-vision-mcp/dist/index.js
```

`ANTHROPIC_MODEL` is only used for optional error diagnosis. It does not have to be a Claude model; use any text model supported by your configured Anthropic-compatible endpoint.

## Remove

```bash
claude mcp remove image-vision
```
