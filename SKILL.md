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

For a first install, extract the zip to that directory and keep using that path.

For an update, delete the old release install directory, then extract the new zip to the same path. `Expand-Archive -Force` and graphical "replace existing files" flows overwrite matching filenames but do not remove files that no longer exist in the new release. If deleting or replacing files fails because they are in use, close Claude Code sessions that may be using this MCP server and try again.

Treat the extracted release directory as replaceable. Keep persistent user configuration in `~/.image-vision-mcp/config.json`, not inside the release install directory.

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

If you update in the same directory, you usually do not need to run `claude mcp add` again. Re-register only when the absolute path to `dist/index.js` changes.

The server reads configuration in this order:

```text
non-empty ~/.image-vision-mcp/config.json values > environment variables > built-in defaults
```

If the Claude Code process can see `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `QWEN_MODEL`, or `ANTHROPIC_MODEL`, the server will use them automatically. If not, create or edit `~/.image-vision-mcp/config.json`.

3. Verify.

```bash
claude mcp get image-vision
```

Start a new Claude Code session and use one of the image vision tools. The original `analyze_image` tool remains available, and specialized tools include `image_analysis`, `extract_text_from_screenshot`, `diagnose_error_screenshot`, `understand_technical_diagram`, `analyze_data_visualization`, `ui_to_artifact`, and `ui_diff_check`. Video analysis is not supported yet. On success, the visible tool text contains only the upstream model response; use `structuredContent.session_id` for follow-up calls.

## Calling Rule For Claude Code

When the user provides an image path or URL, call the most specific image vision tool directly with that original value as `source`.

Use:

- `extract_text_from_screenshot` for OCR.
- `diagnose_error_screenshot` for error screenshots.
- `understand_technical_diagram` for architecture, flow, UML, ER, and system diagrams.
- `analyze_data_visualization` for charts and dashboards.
- `ui_to_artifact` for converting UI screenshots to `code`, `prompt`, `spec`, or `description` artifacts.
- `ui_diff_check` for exactly two UI screenshots.
- `image_analysis` or `analyze_image` for general image analysis.

For OCR requests such as "recognize text", "extract text", "OCR", "识别文字", or "提取文字", call `extract_text_from_screenshot` and make the final assistant response exactly the visible tool text. Do not summarize, translate, rewrite, normalize bullet formatting, add headings, or explain the document unless the user explicitly asks for analysis after OCR.

Correct:

```json
{
  "source": "src\\views\\Chat\\ui稿.png",
  "prompt": "Analyze this UI mockup in detail."
}
```

UI artifact example:

```json
{
  "source": "src\\views\\Chat\\mockup.png",
  "output_type": "spec"
}
```

UI diff example:

```json
{
  "source": [
    "src\\views\\Chat\\expected.png",
    "src\\views\\Chat\\actual.png"
  ]
}
```

Do not first read the image with a host `Read` tool. Do not pass temporary upload/proxy URLs, generated `data-uri/null` URLs, or guessed URLs as `source`; those are not the user-provided image source.

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
