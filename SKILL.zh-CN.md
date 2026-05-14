# image-vision-mcp Claude Code 中文安装指南

[English](./SKILL.md)

这个文档用于帮助中文用户从 release zip 安装 `image-vision-mcp`。release 包是免安装依赖的纯文件包，不需要执行 `npm install`、`bun install`，也不需要运行 `.ps1` 或 `.sh` 脚本。

## Release 包里有什么

- `dist/index.js`：已经打包好的 MCP Server，运行依赖已被 Bun 打进单文件。
- `package.json`：极简 ESM 声明，包含 `"type": "module"`。
- `config.example.json`：配置示例。
- `README.md` / `README.zh-CN.md`：项目说明。
- `SKILL.md` / `SKILL.zh-CN.md`：安装说明。

## 前置要求

确认本机已有：

```bash
node --version
claude --version
```

还需要一个可用的 API token。这个 token 可以来自环境变量，也可以写进用户配置文件。

## 安装步骤

1. 解压 release zip 到固定目录。

推荐示例：

```text
~/mcp/image-vision-mcp
C:\Users\you\mcp\image-vision-mcp
```

首次安装时，把 zip 解压到这个目录，并持续使用这个路径。

更新安装时，先删除旧的 release 安装目录，然后把新版 zip 解压到同一路径。`Expand-Archive -Force` 和图形界面的“替换现有文件”通常只会覆盖同名文件，不会删除新版 release 中已经不存在的旧文件。如果删除或替换文件时提示被占用，再关闭正在使用这个 MCP Server 的 Claude Code 会话后重试。

请把解压后的 release 目录当作可替换产物。持久用户配置应保存在 `~/.image-vision-mcp/config.json`，不要放在 release 安装目录里。

2. 注册 MCP Server。

macOS / Linux：

```bash
claude mcp add -s user image-vision -- node /absolute/path/to/image-vision-mcp/dist/index.js
```

Windows PowerShell：

```powershell
claude mcp add -s user image-vision -- node C:\absolute\path\to\image-vision-mcp\dist\index.js
```

注意：这里必须使用 `dist/index.js` 的绝对路径。

如果更新时仍然解压到同一路径，通常不需要重新执行 `claude mcp add`。只有 `dist/index.js` 的绝对路径变化时才需要重新注册。

3. 验证是否注册成功。

```bash
claude mcp get image-vision
```

4. 重新打开 Claude Code 或开始一个新会话，然后调用 `analyze_image` 工具。成功时，工具返回的可见文本只包含上游模型结果原文；后续追问使用 `structuredContent.session_id`。

## 配置方式

配置优先级：

```text
非空 ~/.image-vision-mcp/config.json 配置 > 环境变量 > 内置默认值
```

默认情况下，如果 Claude Code 进程能读取到这些环境变量，工具会自动使用：

```text
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_BASE_URL
QWEN_MODEL
ANTHROPIC_MODEL
```

如果 Claude Code 读不到你的环境变量，或者你希望安装后通过文件管理配置，请创建：

```text
~/.image-vision-mcp/config.json
```

可以从 release 包里的 `config.example.json` 复制一份过去，然后填写需要的字段。

常用字段：

```json
{
  "api": {
    "authToken": "your-token",
    "baseUrl": "https://your-compatible-endpoint",
    "model": "openai/qwen3.6-plus"
  },
  "diagnostics": {
    "model": "your-diagnostic-text-model"
  }
}
```

说明：

- `api.authToken`：API token。
- `api.baseUrl`：Anthropic SDK 兼容接口地址。
- `api.model`：图片分析模型，对应环境变量 `QWEN_MODEL`。
- `diagnostics.model`：错误诊断模型，对应环境变量 `ANTHROPIC_MODEL`。
- 空字符串会被当作未设置，不会覆盖环境变量。
- 修改配置后不需要重新执行 `claude mcp add`，但建议重启 Claude Code 或开启新会话。

## 可选：注册时显式传入环境变量

如果你不想写配置文件，也可以注册 MCP 时把环境变量交给 Claude Code：

```bash
claude mcp add -s user \
  -e ANTHROPIC_AUTH_TOKEN=your-token \
  -e ANTHROPIC_BASE_URL=https://your-compatible-endpoint \
  -e QWEN_MODEL=openai/qwen3.6-plus \
  -e ANTHROPIC_MODEL=your-diagnostic-text-model \
  image-vision -- node /absolute/path/to/image-vision-mcp/dist/index.js
```

`ANTHROPIC_MODEL` 只用于错误诊断，不一定必须是 Claude 模型。只要你的兼容接口支持该文本模型即可。

## 卸载

```bash
claude mcp remove image-vision
```
