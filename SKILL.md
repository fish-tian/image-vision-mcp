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

2. Create the config directory.

macOS / Linux:

```bash
mkdir -p ~/.image-vision-mcp
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\.image-vision-mcp"
```

3. Copy `config.example.json` to the user config path.

macOS / Linux:

```bash
cp config.example.json ~/.image-vision-mcp/config.json
```

Windows PowerShell:

```powershell
Copy-Item .\config.example.json "$HOME\.image-vision-mcp\config.json" -Force
```

4. Edit `~/.image-vision-mcp/config.json`.

Set at least:

```json
{
  "api": {
    "authToken": "your-token",
    "baseUrl": "https://your-compatible-endpoint",
    "model": "openai/qwen3.6-plus"
  },
  "diagnostics": {
    "model": "claude-3-5-sonnet-latest"
  }
}
```

Notes:

- `api.model` is the image analysis model.
- `diagnostics.model` is the Anthropic text model used only for optional error diagnosis.
- `QWEN_MODEL` and `ANTHROPIC_MODEL` can override these values at runtime.

5. Register the MCP server with Claude Code.

Use the absolute path to `dist/index.js` inside the extracted release directory.

macOS / Linux:

```bash
claude mcp add -s user image-vision -- node /absolute/path/to/image-vision-mcp/dist/index.js
```

Windows PowerShell:

```powershell
claude mcp add -s user image-vision -- node C:\absolute\path\to\image-vision-mcp\dist\index.js
```

6. Verify.

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

## Remove

```bash
claude mcp remove image-vision
```
