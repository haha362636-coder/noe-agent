# 更新日志

## 0.2.0-beta.1（2026-10-05）

首个公开 Beta 测试版。还会有一些问题，欢迎到 Issues 反馈。

### 功能
- 一键安装 / 更新 / 卸载 Claude Code、Codex、DeepSeek Harness、Gemini CLI、Qwen Code、OpenCode，支持自定义 CLI
- 模型厂商管理：10 个预设厂商 + 自定义接口，连通性测试、拉取模型列表；官方登录与厂商 API 一键切换
- 模型选择器：最新模型目录、搜索、自定义模型、思考强度；`/model`、`/effort` 模糊匹配
- 私聊与群聊：拖拽拉群、@ 分派任务、AI 之间 @ 接力
- 工作目录：新会话先选项目文件夹，回复里的文件链接用默认程序打开
- `/` 命令与内置终端（登录、交互式命令、续接会话）
- MCP：20 个常用服务器一键安装到多个工具，已安装矩阵同步 / 移除，自定义与 JSON 导入
- 插件：Claude Code 插件市场、Codex 插件、Gemini CLI 扩展

### 已知问题
- 安装包未经 Apple 公证，首次打开需要执行 `xattr -cr "/Applications/Noe Agent.app"`
- 仅支持 macOS（Apple 芯片 / Intel）
- 第三方 CLI 更新频繁，个别命令参数变化后可能需要更新 Noe Agent
