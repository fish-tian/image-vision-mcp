# image-vision-mcp

An MCP server that exposes image analysis through a single `analyze_image` tool. It supports first-pass analysis for one or more images, then follow-up questions through a cached `session_id`.

## Features

- Analyze local image files or remote image URLs.
- Analyze multiple images in one request.
- Continue follow-up questions with `session_id`.
- Stores image blobs separately from conversation history to avoid rewriting large base64 payloads.
- Expires sessions after 24 hours.
- Cleans cache on startup, on expired session reads, and under cache pressure.
- Writes structured JSON logs to `stderr`, keeping MCP stdio clean.

## Requirements

- Node.js for release zip usage
- [Bun](https://bun.sh/) for source development and packaging
- Claude Code CLI for `claude mcp add` installation
- An Anthropic-compatible multimodal API endpoint
- `ANTHROPIC_AUTH_TOKEN`

## Install

### From GitHub Release

Download `image-vision-mcp-vX.Y.Z.zip` from GitHub Releases, extract it to a permanent folder, then run the installer for your system.

Windows PowerShell:

```powershell
Expand-Archive .\image-vision-mcp-v1.0.0.zip -DestinationPath "$HOME\mcp\image-vision-mcp"
cd "$HOME\mcp\image-vision-mcp"
.\install-claude-code.ps1 -AnthropicAuthToken "your-token"
```

macOS / Linux:

```bash
mkdir -p "$HOME/mcp/image-vision-mcp"
unzip image-vision-mcp-v1.0.0.zip -d "$HOME/mcp/image-vision-mcp"
cd "$HOME/mcp/image-vision-mcp"
chmod +x ./install-claude-code.sh
ANTHROPIC_AUTH_TOKEN="your-token" ./install-claude-code.sh
```

The installer registers the server with Claude Code:

```bash
claude mcp add -s user -e ANTHROPIC_AUTH_TOKEN=your-token image-vision -- node /path/to/dist/index.js
```

See [INSTALL_CLAUDE_CODE.md](./INSTALL_CLAUDE_CODE.md) for detailed steps. If you want Claude Code to install it for you, copy the prompt in [CLAUDECODE_INSTALL_PROMPT.md](./CLAUDECODE_INSTALL_PROMPT.md).

### From Source

```bash
bun install
```

## Configuration

Environment variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ANTHROPIC_AUTH_TOKEN` | Yes | none | API token used by `@anthropic-ai/sdk`. |
| `ANTHROPIC_BASE_URL` | No | SDK default | Anthropic-compatible API base URL. |
| `QWEN_MODEL` | No | `openai/qwen3.6-plus` | Model identifier used for image analysis. |

PowerShell example:

```powershell
$env:ANTHROPIC_AUTH_TOKEN="your-token"
$env:ANTHROPIC_BASE_URL="https://your-compatible-endpoint"
$env:QWEN_MODEL="openai/qwen3.6-plus"
```

## Usage

Run the server in development mode:

```bash
bun run dev
```

Build the server:

```bash
bun run build
```

Build the single-file release bundle:

```bash
bun run build:bundle
```

Create a release zip:

```bash
bun run package
```

The production entrypoint is:

```bash
node dist/index.js
```

## MCP Tool

### `analyze_image`

Parameters:

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `source` | `string \| string[]` | Required for first call | Local image path or image URL. Supports one or more images. |
| `session_id` | `string` | Required for follow-up calls | Existing session ID returned from a previous analysis. |
| `prompt` | `string` | No | Analysis prompt or follow-up question. |

First call example:

```json
{
  "source": "C:\\Users\\you\\Pictures\\example.png",
  "prompt": "Describe this image in detail."
}
```

Multiple images:

```json
{
  "source": [
    "C:\\Users\\you\\Pictures\\front.png",
    "C:\\Users\\you\\Pictures\\back.png"
  ],
  "prompt": "Compare these two images."
}
```

Follow-up:

```json
{
  "session_id": "img_...",
  "prompt": "What text appears in the top-right corner?"
}
```

The tool returns the model response and the active `session_id`.

## Claude Code Configuration

Example MCP server configuration:

```json
{
  "mcpServers": {
    "image-vision": {
      "command": "bun",
      "args": ["run", "C:\\Users\\you\\path\\to\\image-vision-mcp\\src\\index.ts"],
      "env": {
        "ANTHROPIC_AUTH_TOKEN": "your-token",
        "ANTHROPIC_BASE_URL": "https://your-compatible-endpoint",
        "QWEN_MODEL": "openai/qwen3.6-plus"
      }
    }
  }
}
```

For a built version:

```json
{
  "mcpServers": {
    "image-vision": {
      "command": "node",
      "args": ["C:\\Users\\you\\path\\to\\image-vision-mcp\\dist\\index.js"],
      "env": {
        "ANTHROPIC_AUTH_TOKEN": "your-token"
      }
    }
  }
}
```

## Cache Layout

Cache data is stored under `~/.image-vision-cache/`:

```text
~/.image-vision-cache/
+-- sessions/
|   +-- img_xxx.meta.json
|   +-- img_xxx.history.json
+-- images/
|   +-- {sha256_hash}.bin
+-- locks/
    +-- img_xxx.lock
```

The metadata and history files are small JSON files. Image blobs are stored once by SHA256 hash and can be shared by multiple sessions.

## Development

Type-check:

```bash
bun run typecheck
```

Build:

```bash
bun run build
```

Start:

```bash
bun run dev
```

## Notes

- Logs are written to `stderr` as JSON lines so they do not interfere with MCP protocol traffic on stdio.
- Session history stores image references, not full image base64 content.
- Missing or expired sessions return structured MCP tool errors.
