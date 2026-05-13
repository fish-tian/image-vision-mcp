# 配置文件与发布安装改造说明

这份文档记录 `image-vision-mcp` 最近一轮改造的设计思路和代码结构，方便后续阅读、维护和继续扩展。

## 改造目标

最初版本主要依赖 Claude Code MCP 配置里的环境变量，例如：

```bash
claude mcp add -s user -e ANTHROPIC_AUTH_TOKEN=... image-vision -- node dist/index.js
```

这种方式能运行，但安装后想修改模型、API 地址、token 或缓存参数时，用户往往需要删除并重新添加 MCP server，体验不够好。

这次改造的目标是：

- 安装时生成用户配置文件。
- 运行时自动读取配置文件。
- 安装后用户只改配置文件即可，不需要重新安装 MCP。
- 继续兼容环境变量，方便临时覆盖和自动化运行。
- release zip 内包含安装脚本、配置示例和打包后的 server。

## 最终用户体验

安装脚本会生成：

```text
~/.image-vision-mcp/config.json
```

Claude Code 只注册 server 启动命令：

```bash
claude mcp add -s user image-vision -- node /path/to/dist/index.js
```

之后用户修改配置时，只需要编辑：

```text
~/.image-vision-mcp/config.json
```

不需要重新执行 `claude mcp add`。

## 配置优先级

运行时配置优先级是：

```text
环境变量 > config.json > 内置默认值
```

这样设计有两个好处：

- 普通用户可以长期维护 `config.json`。
- 高级用户或 CI 可以用环境变量临时覆盖某个值。

例如，配置文件里模型是：

```json
{
  "api": {
    "model": "openai/qwen3.6-plus"
  }
}
```

如果启动进程时设置了：

```bash
QWEN_MODEL=another-model
```

运行时会优先使用环境变量里的 `another-model`。

## 配置文件结构

示例文件在：

```text
config.example.json
```

默认结构：

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

### api

- `authToken`: API token。也可以用 `ANTHROPIC_AUTH_TOKEN` 覆盖。
- `baseUrl`: Anthropic-compatible API 地址。也可以用 `ANTHROPIC_BASE_URL` 覆盖。
- `model`: 默认视觉模型。也可以用 `QWEN_MODEL` 覆盖。
- `maxTokens`: API 最大输出 token。也可以用 `VISION_MAX_TOKENS` 覆盖。
- `defaultPrompt`: 用户没有传 `prompt` 时使用的默认提示词。也可以用 `VISION_DEFAULT_PROMPT` 覆盖。

### cache

- `dir`: 缓存目录，默认 `~/.image-vision-cache`。也可以用 `IMAGE_VISION_CACHE_DIR` 覆盖。
- `ttlHours`: session 过期时间，默认 24 小时。也可以用 `CACHE_TTL_HOURS` 覆盖。
- `maxMb`: 缓存空间压力清理阈值，默认 500MB。也可以用 `CACHE_MAX_MB` 覆盖。
- `lockTimeoutMs`: 会话文件锁等待时间。也可以用 `CACHE_LOCK_TIMEOUT_MS` 覆盖。

### image

- `fetchTimeoutMs`: URL 图片下载超时。也可以用 `IMAGE_FETCH_TIMEOUT_MS` 覆盖。
- `maxBytes`: 单张图片最大字节数。也可以用 `IMAGE_MAX_BYTES` 覆盖。

### log

- `level`: 日志等级，支持 `debug`、`info`、`warn`、`error`。也可以用 `LOG_LEVEL` 覆盖。

## 关键代码入口

### `src/utils/config.ts`

这是配置系统的核心。

主要职责：

- 读取默认配置。
- 读取 `~/.image-vision-mcp/config.json`。
- 支持 `IMAGE_VISION_CONFIG` 指定自定义配置路径。
- 支持 `~` 路径展开。
- 合并默认值、配置文件和环境变量。
- 提供 `getConfig()` 给其他模块使用。

核心逻辑是：

```text
getConfig()
  -> 解析配置文件路径
  -> 读取 config.json
  -> merge 默认配置
  -> apply 环境变量覆盖
  -> 返回最终配置
```

`getConfig()` 内部有缓存，避免每次调用都重复读文件。因为 MCP server 是长进程，用户改配置后通常需要重启 Claude Code 或重新启动 server 才会生效。

### `src/utils/qwenApi.ts`

API 层现在从配置读取：

- token
- base URL
- model
- max tokens
- default prompt

如果 token 不存在，会返回明确错误，并提示用户去配置文件或环境变量里设置：

```text
ANTHROPIC_AUTH_TOKEN is required. Set it in ~/.image-vision-mcp/config.json or as an environment variable.
```

### `src/utils/cache.ts`

缓存层现在从配置读取：

- cache root
- session TTL
- max cache size
- lock timeout

默认行为仍然保持原来设计：

```text
cache dir: ~/.image-vision-cache
ttl: 24 hours
max size: 500MB
lock timeout: 5000ms
```

### `src/utils/imageReader.ts`

图片读取层新增两个保护：

- URL 下载超时。
- 图片最大字节数限制。

这样可以避免超大图片或挂起的远程请求拖垮 MCP server。

### `src/utils/logger.ts`

日志系统支持 `LOG_LEVEL` 或配置文件里的 `log.level`。

日志仍然写入 `stderr`，不会污染 MCP stdio 协议。

## 安装脚本变化

### Windows

文件：

```text
install-claude-code.ps1
```

它会：

1. 检查 `node` 和 `claude` 命令。
2. 检查当前环境变量。
3. 如果发现 `ANTHROPIC_AUTH_TOKEN`，脱敏显示并询问是否使用。
4. 如果发现 `ANTHROPIC_BASE_URL` 或 `QWEN_MODEL`，询问是否使用。
5. 如果没有 token，交互式要求输入。
6. 写入 `~/.image-vision-mcp/config.json`。
7. 注册 Claude Code MCP server。
8. 执行 `claude mcp get image-vision` 验证。

### macOS / Linux

文件：

```text
install-claude-code.sh
```

行为与 PowerShell 脚本一致。

注意：脚本会把 token 写入用户主目录下的配置文件，不会写入项目目录或 release 目录。

## 打包发布链路

### 构建单文件 server

```bash
bun run build:bundle
```

输出：

```text
dist/index.js
```

这个文件会尽量把运行依赖打包进去，方便 release zip 用户直接用 Node 运行。

### 生成 release zip

```bash
bun run package
```

输出：

```text
release/image-vision-mcp-v1.0.0.zip
```

zip 内容由 `scripts/package-release.ts` 控制，目前包含：

```text
README.md
INSTALL_CLAUDE_CODE.md
CLAUDECODE_INSTALL_PROMPT.md
install-claude-code.ps1
install-claude-code.sh
.env.example
config.example.json
dist/index.js
```

`release/` 和 `dist/` 都被 `.gitignore` 忽略，不提交生成物。

## 为什么保留环境变量

虽然配置文件是主路径，但环境变量仍然有价值：

- 临时切换模型。
- 临时换 API token。
- 在 CI 或自动化环境中不落地配置文件。
- 兼容之前已经配置过 env 的用户。

所以运行时优先级设计为：

```text
环境变量 > config.json > 默认值
```

## 后续可以继续改进的方向

- 增加 `image-vision config path` 或 `image-vision doctor` 这样的辅助命令。
- 支持配置热重载，不过对 MCP server 来说重启通常更简单。
- 对配置文件做更严格的 schema 校验，并返回字段级错误。
- 增加安装脚本的 dry-run 模式。
- 自动检测已存在的 Claude Code MCP server，提示覆盖或跳过。
- 为 release zip 创建 GitHub Release 自动化流程。

## 学习要点

这次改造的核心思路是把“安装时写死配置”改为“运行时读取用户配置”。

更通用地说：

- 安装脚本只负责把程序放好、生成初始配置、注册启动命令。
- 程序本身负责读取配置和应用默认值。
- 用户后续修改行为应尽量发生在一个稳定、可解释的配置文件里。
- 环境变量适合作为覆盖层，而不是唯一配置入口。

这种模式比只依赖 `claude mcp add -e` 更适合面向普通用户发布。
