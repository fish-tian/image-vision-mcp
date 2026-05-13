# Claude Code One-Prompt Installer

Copy this prompt into Claude Code after downloading the release zip.

```text
请帮我把 image-vision-mcp 安装成 Claude Code MCP server。

压缩包路径是：<把 image-vision-mcp-vX.Y.Z.zip 的完整路径填在这里>
安装目录是：<可选，例如 C:\Users\me\mcp\image-vision-mcp 或 ~/mcp/image-vision-mcp>

请执行以下步骤：
1. 解压压缩包到安装目录。如果安装目录没填，就使用用户主目录下的 mcp/image-vision-mcp。
2. 检查 node 和 claude 命令是否可用。
3. 检查当前环境变量里是否已有 ANTHROPIC_AUTH_TOKEN、ANTHROPIC_BASE_URL、QWEN_MODEL。
4. 如果环境变量存在，询问我是否写入 ~/.image-vision-mcp/config.json，默认使用；显示 token 时必须脱敏。
5. 如果 token 不存在或我不想用环境变量里的 token，就询问我新的 ANTHROPIC_AUTH_TOKEN。
6. 根据系统选择运行 install-claude-code.ps1 或 install-claude-code.sh。
7. 安装脚本应生成 ~/.image-vision-mcp/config.json，并执行 claude mcp add -s user image-vision -- node <安装目录>/dist/index.js。
8. 安装完成后运行 claude mcp get image-vision 验证。

不要把 token 写入项目目录或仓库文件；只写入用户主目录下的 ~/.image-vision-mcp/config.json。
后续如果我要改模型、base URL、token 或缓存设置，提醒我直接编辑 ~/.image-vision-mcp/config.json，不需要重新安装 MCP。
```
