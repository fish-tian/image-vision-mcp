# image-vision-mcp Claude Code Install Skill

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

2. Register the MCP server with Claude Code and pass the initial API configuration as environment variables.

Use the absolute path to `dist/index.js` inside the extracted release directory.

macOS / Linux:

```bash
claude mcp add -s user \
  -e ANTHROPIC_AUTH_TOKEN=your-token \
  -e ANTHROPIC_BASE_URL=https://your-compatible-endpoint \
  -e QWEN_MODEL=openai/qwen3.6-plus \
  -e ANTHROPIC_MODEL=claude-3-5-sonnet-latest \
  image-vision -- node /absolute/path/to/image-vision-mcp/dist/index.js
```

Windows PowerShell:

```powershell
claude mcp add -s user -e ANTHROPIC_AUTH_TOKEN=your-token -e ANTHROPIC_BASE_URL=https://your-compatible-endpoint -e QWEN_MODEL=openai/qwen3.6-plus -e ANTHROPIC_MODEL=claude-3-5-sonnet-latest image-vision -- node C:\absolute\path\to\image-vision-mcp\dist\index.js
```

On first startup, the server creates:

```text
~/.image-vision-mcp/config.json
```

It fills that file from the environment variables above. If the file already exists, it is not overwritten.

3. Verify.

```bash
claude mcp get image-vision
```

Start a new Claude Code session and use the `analyze_image` tool.

## Update Configuration

After installation, edit:

```text
~/.image-vision-mcp/config.json
```

You do not need to reinstall the MCP server after changing model, base URL, token, cache limits, image limits, or diagnostics settings. Restart Claude Code or start a new session for changes to take effect.

If you want to regenerate the config from environment variables, delete `~/.image-vision-mcp/config.json` and restart the MCP server.

You can still create the config manually by copying `config.example.json` to `~/.image-vision-mcp/config.json`.

## Remove

```bash
claude mcp remove image-vision
```
