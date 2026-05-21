# image-vision-mcp

[中文](./README.zh-CN.md)

An MCP server that exposes image analysis tools for general image understanding, OCR, UI analysis, error screenshots, technical diagrams, chart analysis, and UI diff checks. It supports first-pass analysis for one or more images, then follow-up questions through a cached `session_id`.

## Features

- Analyze local image files or remote image URLs.
- Analyze multiple images in one request.
- Use specialized tools for OCR, error screenshots, technical diagrams, data visualizations, UI-to-artifact conversion, and UI diff checks.
- Continue follow-up questions with `session_id`.
- Stores image blobs separately from conversation history to avoid rewriting large base64 payloads.
- Expires sessions after 24 hours.
- Cleans cache on startup, on expired session reads, and under cache pressure.
- Writes structured JSON logs to `stderr`, keeping MCP stdio clean.
- Writes detailed local call logs to JSONL files by default, with sensitive values masked.

## Requirements

- Node.js for release zip usage
- [Bun](https://bun.sh/) for source development and packaging
- Claude Code CLI for `claude mcp add` installation
- An Anthropic-compatible multimodal API endpoint
- `ANTHROPIC_AUTH_TOKEN`

## Install

### From GitHub Release

Download `image-vision-mcp-vX.Y.Z.zip` from GitHub Releases and extract it to a permanent folder. The release zip is self-contained and does not require `npm install` or `bun install`.

For a first install, extract the zip to the folder you want to keep using, such as `~/mcp/image-vision-mcp` or `C:\Users\you\mcp\image-vision-mcp`.

For an update, delete the old release install folder, then extract the new zip to the same path. `Expand-Archive -Force` and graphical "replace existing files" flows overwrite matching filenames but do not remove files that no longer exist in the new release, so a clean folder replacement is recommended. If deleting or replacing files fails because they are in use, close Claude Code sessions that may be using this MCP server and try again.

Treat the extracted release folder as replaceable. Keep persistent user configuration in `~/.image-vision-mcp/config.json`, not inside the release install folder.

Register the server with Claude Code:

```bash
claude mcp add -s user image-vision -- node /absolute/path/to/image-vision-mcp/dist/index.js
```

If you update in the same folder, you usually do not need to run `claude mcp add` again. Re-register only when the absolute path to `dist/index.js` changes.

The server reads non-empty `~/.image-vision-mcp/config.json` values first, then environment variables, then built-in defaults. If Claude Code can see `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `QWEN_MODEL`, or `ANTHROPIC_MODEL`, the tool uses them automatically. Otherwise, copy `config.example.json` to `~/.image-vision-mcp/config.json` and fill in the values.

Verify:

```bash
claude mcp get image-vision
```

See [SKILL.md](./SKILL.md) for detailed cross-platform installation steps.

### From Source

```bash
bun install
```

## Configuration

The default user config file is:

```text
~/.image-vision-mcp/config.json
```

This file is optional. Edit it to override environment variables or configure API token, base URL, model, cache limits, image limits, diagnostics, or log level. You do not need to reinstall the MCP server after editing it.

Example:

```json
{
  "api": {
    "authToken": "",
    "baseUrl": "",
    "model": "",
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
    "level": "info",
    "call": {
      "enabled": true,
      "dir": "~/.image-vision-mcp/call-logs",
      "includeText": true
    }
  },
  "diagnostics": {
    "enabled": true,
    "model": "",
    "maxTokens": 1000,
    "timeoutMs": 8000
  }
}
```

Configuration priority:

```text
non-empty config.json values > environment variables > built-in defaults
```

Set `IMAGE_VISION_CONFIG` to use a custom config path.

Supported environment variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ANTHROPIC_AUTH_TOKEN` | Yes | none | API token used by `@anthropic-ai/sdk`. |
| `ANTHROPIC_BASE_URL` | No | SDK default | Anthropic-compatible API base URL. |
| `ANTHROPIC_MODEL` | No | none | Text model used only for model-assisted error diagnosis through the configured Anthropic-compatible SDK endpoint. |
| `QWEN_MODEL` | No | `openai/qwen3.6-plus` | Model identifier used for image analysis. |
| `IMAGE_VISION_CONFIG` | No | `~/.image-vision-mcp/config.json` | Custom config file path. |
| `VISION_MAX_TOKENS` | No | `64000` | Maximum output tokens. |
| `VISION_DEFAULT_PROMPT` | No | `Please analyze the image content.` | Prompt used when `prompt` is omitted. |
| `IMAGE_VISION_CACHE_DIR` | No | `~/.image-vision-cache` | Cache directory. |
| `CACHE_TTL_HOURS` | No | `24` | Session expiration window. |
| `CACHE_MAX_MB` | No | `500` | Cache pressure cleanup threshold. |
| `CACHE_LOCK_TIMEOUT_MS` | No | `5000` | Session lock timeout. |
| `IMAGE_FETCH_TIMEOUT_MS` | No | `30000` | Remote image fetch timeout. |
| `IMAGE_MAX_BYTES` | No | `20971520` | Maximum image size in bytes. |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, or `error`. |
| `CALL_LOG_ENABLED` | No | `true` | Write detailed local tool and API call logs. |
| `CALL_LOG_DIR` | No | `~/.image-vision-mcp/call-logs` | Directory for daily JSONL call log files. |
| `CALL_LOG_INCLUDE_TEXT` | No | `true` | Store full prompt and model output text; set false to store length and SHA256 only. |
| `DIAGNOSTICS_ENABLED` | No | `true` | Enable local and optional model-assisted error diagnosis. |
| `DIAGNOSTICS_MAX_TOKENS` | No | `1000` | Maximum output tokens for model-assisted error diagnosis. |
| `DIAGNOSTICS_TIMEOUT_MS` | No | `8000` | Timeout for model-assisted error diagnosis. |

`QWEN_MODEL` is used for image analysis. `ANTHROPIC_MODEL` is separate and used only to explain failures before the MCP tool returns an error to Claude Code. Despite the environment variable name, this diagnostic model does not have to be a Claude model; it can be any compatible text model accepted by your configured endpoint.

Empty strings in `config.json` are treated as unset and do not override environment variables.

Detailed call logs are enabled by default and written to `~/.image-vision-mcp/call-logs/YYYY-MM-DD.jsonl`. They include `analyze_image` tool calls and upstream model API calls. Known sensitive fields such as tokens, API keys, passwords, secrets, authorization headers, image base64 payloads, and signed URL query parameters are retained as fields but written as `"********"`. To disable local call logging:

```json
{
  "log": {
    "call": {
      "enabled": false
    }
  }
}
```

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

Build a non-minified bundle for runtime debugging:

```bash
bun run build:bundle:debug
```

Create a release zip:

Update the root `package.json` `version` before each release. The release zip filename and bundled release `package.json` are generated from that version.

```bash
bun run package
```

Create a release zip from the non-minified debug bundle:

```bash
bun run package:debug
```

The default release commands use minification. Use the debug commands when investigating bundle or runtime issues.

The production entrypoint is:

```bash
node dist/index.js
```

## MCP Tool

The server keeps the original `analyze_image` tool and also exposes Z.AI-style specialized image tools. Video analysis is intentionally not supported yet.

### Shared Calling Rules

Claude Code should call these tools directly with the original image source from the user message. If the user provides an `@path` mention, repository path, Windows path, or HTTP image URL, pass that exact value as `source`. Do not first read the image with a host `Read` tool, and do not pass temporary upload/proxy URLs such as paths containing `/data-uri/null/`.

Parameters:

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `source` | `string \| string[]` | Required for first call | Local image path or image URL. Supports one or more images. |
| `session_id` | `string` | Required for follow-up calls | Existing session ID returned from a previous analysis. |
| `prompt` | `string` | No | Analysis prompt or follow-up question. |
| `output_type` | `"code" \| "prompt" \| "spec" \| "description"` | No | Only for `ui_to_artifact`; defaults to `description`. |

The visible text returned by each tool contains only the upstream model response. The active `session_id` is returned in `structuredContent.session_id` for follow-up calls.

### Tools

| Tool | Use |
| --- | --- |
| `analyze_image` | Original generic image analysis tool; kept for compatibility. |
| `image_analysis` | General image understanding when no specialized tool fits. |
| `extract_text_from_screenshot` | OCR screenshots, including code, terminals, documents, and UI text. |
| `diagnose_error_screenshot` | Explain error screenshots and suggest fixes. |
| `understand_technical_diagram` | Interpret architecture, flow, UML, ER, and system diagrams. |
| `analyze_data_visualization` | Read charts and dashboards for trends, values, outliers, and caveats. |
| `ui_to_artifact` | Convert UI screenshots into code, prompts, specs, or descriptions. |
| `ui_diff_check` | Compare exactly two UI screenshots for visual or implementation drift. |

First call example:

```json
{
  "source": "C:\\Users\\you\\Pictures\\example.png",
  "prompt": "Describe this image in detail."
}
```

Repository path example:

```json
{
  "source": "src\\views\\Chat\\ui稿.png",
  "prompt": "Analyze this UI mockup and describe the layout, visible text, controls, colors, and code changes needed."
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

OCR example:

```json
{
  "source": "C:\\Users\\you\\Pictures\\terminal-error.png",
  "prompt": "Keep terminal line breaks intact."
}
```

UI artifact example:

```json
{
  "source": "C:\\Users\\you\\Pictures\\mockup.png",
  "output_type": "spec"
}
```

UI diff example:

```json
{
  "source": [
    "C:\\Users\\you\\Pictures\\expected.png",
    "C:\\Users\\you\\Pictures\\actual.png"
  ],
  "prompt": "Focus on spacing, typography, and color differences."
}
```

Follow-up:

```json
{
  "session_id": "img_...",
  "prompt": "What text appears in the top-right corner?"
}
```

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

Release zip users should prefer the `node dist/index.js` command and the config file flow described in [SKILL.md](./SKILL.md).

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
- Detailed call logs are written locally as JSONL and mask known sensitive values with `********`.
- Session history stores image references, not full image base64 content.
- Missing or expired sessions return structured MCP tool errors.
