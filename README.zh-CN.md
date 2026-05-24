# image-vision-mcp

[English](./README.md)

`image-vision-mcp` 是一个 MCP Server，通过一组图片理解工具为不支持多模态的模型补充图片分析能力。它支持本地图片、远程图片 URL、多图分析，以及基于 `session_id` 的多轮追问。`analyze_image` 保留为兼容入口；实际使用时应优先选择更具体的专用工具。

## 功能

- 分析本地图片文件或远程图片 URL。
- 单次请求支持一张或多张图片。
- 返回 `session_id`，后续可以基于同一会话继续追问。
- 图片数据和对话历史分离存储，避免追问时反复写入大体积 base64。
- 会话默认 24 小时过期。
- 启动、读取过期会话、缓存超限时会自动清理。
- 日志写入 `stderr`，不会污染 MCP stdio 协议。
- 默认写入本地详细调用日志，已知敏感值会用星号遮蔽。

## 安装要求

- Node.js：用于运行 release zip 里的 `dist/index.js`
- Claude Code CLI：用于执行 `claude mcp add`
- 一个 Anthropic SDK 兼容的多模态 API 服务
- API token：可通过环境变量或配置文件提供
- Bun：仅源码开发和打包时需要，普通 release 用户不需要

## 从 GitHub Release 安装

下载 `image-vision-mcp-vX.Y.Z.zip`，解压到一个固定目录。release zip 已经内置运行依赖，不需要执行 `npm install` 或 `bun install`。

首次安装时，把 zip 解压到之后会长期使用的目录，例如 `~/mcp/image-vision-mcp` 或 `C:\Users\you\mcp\image-vision-mcp`。

更新安装时，先删除旧的 release 安装目录，然后把新版 zip 解压到同一路径。`Expand-Archive -Force` 和图形界面的“替换现有文件”通常只会覆盖同名文件，不会删除新版 release 中已经不存在的旧文件，所以推荐先清空旧目录再解压。如果删除或替换文件时提示被占用，再关闭正在使用这个 MCP Server 的 Claude Code 会话后重试。

请把解压后的 release 目录当作可替换产物。持久用户配置应保存在 `~/.image-vision-mcp/config.json`，不要放在 release 安装目录里。

注册到 Claude Code：

```bash
claude mcp add -s user image-vision -- node /absolute/path/to/image-vision-mcp/dist/index.js
```

Windows PowerShell 示例：

```powershell
claude mcp add -s user image-vision -- node C:\absolute\path\to\image-vision-mcp\dist\index.js
```

如果更新时仍然解压到同一路径，通常不需要重新执行 `claude mcp add`。只有 `dist/index.js` 的绝对路径变化时才需要重新注册。

验证：

```bash
claude mcp get image-vision
```

更详细的中文安装步骤见 [SKILL.zh-CN.md](./SKILL.zh-CN.md)。

## 配置

默认配置文件路径：

```text
~/.image-vision-mcp/config.json
```

配置文件是可选的。运行时读取优先级为：

```text
非空 config.json 配置 > 环境变量 > 内置默认值
```

也就是说：

- 如果 Claude Code 进程能看到 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`QWEN_MODEL`、`ANTHROPIC_MODEL`，工具会自动使用这些环境变量。
- 如果你创建了 `~/.image-vision-mcp/config.json`，其中非空字段会优先于环境变量。
- `config.json` 里的空字符串会被视为“未设置”，不会覆盖环境变量。

配置示例：

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

如果要使用自定义配置文件路径，可以设置：

```bash
IMAGE_VISION_CONFIG=/path/to/config.json
```

## 关键环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `ANTHROPIC_AUTH_TOKEN` | 是 | 无 | API token。也可以写入 `api.authToken`。 |
| `ANTHROPIC_BASE_URL` | 否 | SDK 默认值 | Anthropic SDK 兼容接口地址。 |
| `QWEN_MODEL` | 否 | `openai/qwen3.6-plus` | 图片分析模型。也可以写入 `api.model`。 |
| `ANTHROPIC_MODEL` | 否 | 无 | 仅用于错误诊断的文本模型。也可以写入 `diagnostics.model`。 |
| `IMAGE_VISION_CONFIG` | 否 | `~/.image-vision-mcp/config.json` | 自定义配置文件路径。 |
| `CALL_LOG_ENABLED` | 否 | `true` | 是否写入本地详细调用日志。 |
| `CALL_LOG_DIR` | 否 | `~/.image-vision-mcp/call-logs` | 每日 JSONL 调用日志目录。 |
| `CALL_LOG_INCLUDE_TEXT` | 否 | `true` | 是否保存完整 prompt 和模型输出；设为 false 时只保存长度和 SHA256。 |

`QWEN_MODEL` 只用于图片分析。`ANTHROPIC_MODEL` 只用于请求失败时的错误诊断。虽然变量名叫 `ANTHROPIC_MODEL`，但它不一定必须是 Claude 模型，只要你的兼容接口支持该文本模型即可。

详细调用日志默认写入 `~/.image-vision-mcp/call-logs/YYYY-MM-DD.jsonl`，覆盖 `analyze_image` 工具调用和上游模型 API 调用。已知敏感字段，例如 token、API key、password、secret、authorization、图片 base64 内容和带签名 URL query 参数，会保留字段名但值写为 `"********"`。如果要关闭：

```json
{
  "log": {
    "call": {
      "enabled": false
    }
  }
}
```

## 使用方式

MCP 工具会直接读取用户提供的原始图片路径或图片 URL。不要先用宿主 `Read` 工具读取图片，也不要传入临时上传链接、代理链接或包含 `/data-uri/null/` 的 URL。

优先使用最具体的工具：

| 工具 | 适用场景 |
| --- | --- |
| `ui_to_artifact` | UI 截图、UI 稿、界面稿、网页/应用页面、后台界面、仪表盘 UI；用户说“识别这个 UI 稿”“分析这个页面截图”时默认使用，未要求代码时用 `output_type: "description"`。 |
| `extract_text_from_screenshot` | OCR、识别文字、提取文字、代码/终端/文档/界面文字截图。 |
| `diagnose_error_screenshot` | 错误截图、报错弹窗、异常堆栈截图。 |
| `understand_technical_diagram` | 架构图、流程图、UML、ER 图、系统图。 |
| `analyze_data_visualization` | 图表、数据看板、趋势图、柱状图、折线图。 |
| `ui_diff_check` | 对比两张 UI 截图的视觉差异。 |
| `image_analysis` / `analyze_image` | 没有专用工具适配时的通用图片分析。 |

可用工具名包括：

```text
image_analysis
extract_text_from_screenshot
diagnose_error_screenshot
understand_technical_diagram
analyze_data_visualization
ui_to_artifact
ui_diff_check
analyze_image
```

首次分析必须提供 `source`：

```json
{
  "source": "C:\\Users\\you\\Pictures\\example.png",
  "prompt": "请详细描述这张图片。"
}
```

UI 稿识别：

```json
{
  "source": "C:\\Users\\you\\Pictures\\dashboard-ui.png",
  "output_type": "description",
  "prompt": "识别这个 UI 稿。"
}
```

多图分析：

```json
{
  "source": [
    "C:\\Users\\you\\Pictures\\front.png",
    "C:\\Users\\you\\Pictures\\back.png"
  ],
  "prompt": "请比较这两张图片。"
}
```

追问：

```json
{
  "session_id": "img_...",
  "prompt": "右上角有什么文字？"
}
```

工具返回的可见文本只包含上游模型分析结果原文。当前可继续使用的 `session_id` 会放在 `structuredContent.session_id` 中，用于后续追问。

## 开发命令

源码开发需要先安装依赖：

```bash
bun install
```

常用命令：

```bash
bun run test
bun run typecheck
bun run build
bun run build:bundle
bun run build:bundle:debug
bun run package
bun run package:debug
```

默认 `build:bundle` / `package` 会生成压缩后的 release。排查 bundle 或运行时问题时，可以使用 `build:bundle:debug` / `package:debug` 生成不压缩的版本。

release 用户不需要这些命令，只需要运行：

```bash
node dist/index.js
```

## 缓存位置

默认缓存目录：

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

元数据和历史是小 JSON 文件，图片 blob 按 SHA256 存储，可被多个会话复用。
