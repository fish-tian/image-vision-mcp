# Configuration And Packaging Design

This document explains the current configuration and release packaging design for `image-vision-mcp`.

## Goals

The release package should be usable without running `npm install` or `bun install`.

The current release strategy is:

- Bundle runtime dependencies into `dist/index.js` with Bun.
- Ship a minimal `package.json` containing `"type": "module"`.
- Ship `config.example.json` for user configuration.
- Ship `SKILL.md` as the installation guide.
- Avoid platform-specific installer scripts such as `.ps1` and `.sh`.

## Runtime Configuration

The default user config path is:

```text
~/.image-vision-mcp/config.json
```

Configuration priority is:

```text
non-empty config.json values > environment variables > built-in defaults
```

The config file shape is:

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
    "level": "info"
  },
  "diagnostics": {
    "enabled": true,
    "model": "",
    "maxTokens": 1000,
    "timeoutMs": 8000
  }
}
```

Important distinction:

- `QWEN_MODEL` / `api.model` is used for image analysis.
- `ANTHROPIC_MODEL` / `diagnostics.model` is used only for optional error diagnosis.

## Key Code Paths

- `src/utils/config.ts`: reads config file, applies defaults, and overlays environment variables.
- `src/utils/qwenApi.ts`: reads API token, base URL, image model, max tokens, and default prompt.
- `src/utils/cache.ts`: reads cache directory, TTL, max size, and lock timeout.
- `src/utils/imageReader.ts`: reads image fetch timeout and max image size.
- `src/utils/errorDiagnostics.ts`: builds local and optional Anthropic model-assisted error diagnostics.
- `src/index.ts`: catches MCP tool errors and returns the diagnostic response.

## Release Packaging

The release build command is:

```bash
bun run package
```

It runs:

```bash
bun run build:bundle
```

Then `scripts/package-release.ts` creates:

```text
release/image-vision-mcp-v1.0.0.zip
```

The zip contains:

```text
README.md
SKILL.md
config.example.json
dist/index.js
package.json
```

The release-specific `package.json` is generated during packaging and contains only:

```json
{
  "name": "image-vision-mcp",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js"
}
```

It intentionally has no dependencies. Users should not need package installation for the release zip.

## Install Flow For Users

Users extract the zip and register the MCP server with Claude Code:

```bash
claude mcp add -s user image-vision -- node /absolute/path/to/image-vision-mcp/dist/index.js
```

If Claude Code can see `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `QWEN_MODEL`, or `ANTHROPIC_MODEL`, the server uses those values automatically. If not, users can copy `config.example.json` to `~/.image-vision-mcp/config.json` and fill in non-empty values. Empty strings are treated as unset.

They can verify with:

```bash
claude mcp get image-vision
```

Detailed steps live in `SKILL.md`.

## Development Flow

The source repo still uses Bun for development:

```bash
bun install
bun run test
bun run typecheck
bun run build
bun run package
```

This development workflow is separate from release usage. Release users only need Node.js, Claude Code, the release zip, and a config file.
