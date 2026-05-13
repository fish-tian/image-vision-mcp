# Claude Code One-Prompt Installer

Copy this prompt into Claude Code after downloading the release zip.

```text
请帮我把 image-vision-mcp 安装成 Claude Code MCP server。

压缩包路径是：<把 image-vision-mcp-vX.Y.Z.zip 的完整路径填在这里>
安装目录是：<可选，例如 C:\Users\me\mcp\image-vision-mcp 或 ~/mcp/image-vision-mcp>

请执行以下步骤：
1. 解压压缩包到安装目录。如果安装目录没填，就使用用户主目录下的 mcp/image-vision-mcp。
2. 检查 node 和 claude 命令是否可用。
3. 询问我 ANTHROPIC_AUTH_TOKEN；如果我提供了 ANTHROPIC_BASE_URL 或 QWEN_MODEL，也一起使用。
4. 根据系统选择运行 install-claude-code.ps1 或 install-claude-code.sh。
5. 安装完成后运行 claude mcp get image-vision 验证。

不要把 token 写入项目文件；只通过 claude mcp add -e 写入 Claude Code MCP 配置。
```
