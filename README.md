<div align="center">

<img src="build/icon.png" width="112" alt="Noe Agent">

# Noe Agent

**把各种 AI 编程助手装进一个聊天软件：一键安装、多厂商 API 管理、私聊任意 AI，或把多个 AI 拖进群里，@ 谁就谁来干活。**

![版本](https://img.shields.io/badge/version-0.2.0--beta.1-orange)
![平台](https://img.shields.io/badge/platform-macOS%20(Apple%20%2F%20Intel)-lightgrey)
![协议](https://img.shields.io/badge/license-MIT-blue)

</div>

> [!WARNING]
> **这是 Beta 测试版，还会有一些问题。** 欢迎在 [Issues](https://github.com/haha362636-coder/noe-agent/issues) 反馈 Bug 和建议。

## 下载安装（macOS）

到 [Releases](https://github.com/haha362636-coder/noe-agent/releases) 下载对应芯片的安装包：

| 你的 Mac | 下载 |
|---|---|
| Apple 芯片（M1 / M2 / M3 / M4 …） | `Noe-Agent-<版本>-mac-arm64.dmg` |
| Intel 芯片 | `Noe-Agent-<版本>-mac-x64.dmg` |

> 不确定是哪种芯片：点屏幕左上角  →「关于本机」，「芯片」一栏写 Apple M… 就是 Apple 芯片，写 Intel 就是 Intel。

打开 dmg，把 **Noe Agent** 拖进「应用程序」。安装包没有经过 Apple 公证，第一次打开如果提示「已损坏」或「无法验证开发者」，在「终端」里执行一次：

```bash
xattr -cr "/Applications/Noe Agent.app"
```

然后正常双击打开即可。系统要求 macOS 12 及以上；内置终端需要系统自带的 `python3`（没有的话 macOS 会提示安装命令行工具）。

## 功能

- **AI 工具**：Claude Code、Codex、DeepSeek Harness、Gemini CLI、Qwen Code、OpenCode 一键安装 / 更新 / 卸载，显示官方账号登录状态；支持接入任意自定义 CLI。
- **模型厂商**：预设 Anthropic、OpenAI、DeepSeek、智谱 GLM、Kimi、阿里云百炼、MiniMax、OpenRouter、硅基流动、Gemini，也可添加任意兼容接口；支持连通性测试、拉取模型列表。
- **一键切换**：每个 AI 可以在「官方登录」和任意厂商 API 之间随时切换（工具卡片、聊天顶部、或 `/use`）。
- **模型选择**：内置最新模型目录（Claude Fable 5.1 / Opus 5.5 / Sonnet 5.5、Gemini 3.8 Flash 等，Codex 实时读取最新列表如 GPT-6.1 Sol / GPT-6 Astra），可搜索、可输入任意模型；Claude Code 与 Codex 可选思考强度。`/model opus 5.5`、`/model gpt-6` 模糊匹配。
- **聊天与群聊**：私聊任意 AI；把 AI 拖进群里用 @ 分派任务，AI 之间还能互相 @ 接力；Markdown 与代码高亮、执行过程时间线、耗时 / token / 费用统计。
- **工作目录**：新会话先选项目文件夹，AI 做出来的文件就在你知道的地方；回复里的文件链接一点就用默认程序打开。
- **/ 命令**：`/help /login /logout /use /model /effort /status /terminal /shell /new /clear /stop /cwd /invite /kick /rename`；需要交互界面的命令（如 Claude 的 `/config`、`/mcp`）自动在内置终端打开。
- **内置终端**：真实伪终端，用于官方账号登录、交互式命令和续接会话（⌘J）。
- **MCP 服务器**：20 个常用 MCP 预设（文件系统、Context7、GitHub、Playwright、Chrome DevTools、Tavily、高德地图、Notion 等），一键装进多个 AI 工具；已安装矩阵可同步或移除；支持自定义和粘贴 JSON 导入。
- **插件**：Claude Code 插件市场（300+ 插件）、Codex 插件、Gemini CLI 扩展，一键安装 / 启用 / 卸载。

## 从源码运行

需要 Node.js 18+。

```bash
git clone https://github.com/haha362636-coder/noe-agent.git
cd noe-agent
npm install      # 安装 Electron 等开发依赖
npm start        # 启动桌面 App
npm run web      # 或只启动本地服务，浏览器打开 http://127.0.0.1:17860
```

## 打包

```bash
npm run dist:mac         # 同时打 Apple 芯片和 Intel 两个 dmg，输出到 dist/
npm run dist:mac-arm64   # 只打 Apple 芯片
npm run dist:mac-x64     # 只打 Intel
```

发布到 GitHub 的完整步骤见 [docs/发布到GitHub教程.md](docs/发布到GitHub教程.md)。

## 项目结构

```
electron/main.js      桌面外壳
server/index.js       HTTP + SSE 服务、群聊调度、/ 命令、安装管理
server/agents.js      各 CLI 的安装、协议、登录、无头运行与输出解析
server/providers.js   模型厂商预设、连通性测试、模型列表
server/models.js      模型目录、思考强度、/model 模糊匹配
server/extensions.js  MCP 与插件：读写各 CLI 的配置、调用官方命令
server/mcp-catalog.js 推荐 MCP、Gemini 扩展、Claude 插件市场
server/pty.js         内置终端；pty_bridge.py 提供伪终端
server/store.js       数据保存在 ~/.noe-agent/data.json（仅本机，权限 600）
public/               界面（原生 HTML / CSS / JS）
public/vendor/        打包好的 marked、DOMPurify、highlight.js、xterm（npm run build:vendor 重新生成）
build/                应用图标
```

## 注意事项

- API Key 只保存在本机 `~/.noe-agent/data.json`，不会上传到任何地方。
- MCP 写入位置：Claude Code 用 `claude mcp add-json -s user`，Codex 用 `codex mcp add`，Gemini / Qwen / OpenCode 直接修改各自的配置文件（首次修改前会备份为 `*.noe-backup`）。
- Codex 使用第三方厂商时，厂商需要兼容 OpenAI Responses 接口（`/v1/responses`）。
- 设置里的「全自动模式」会跳过 CLI 的所有权限确认，请只在可信目录中使用。

## 致谢

感谢 [Claude Code](https://claude.com/claude-code) 与 [Electron](https://www.electronjs.org)。

## 支持项目

如果觉得项目不错，可以[支持一下作者](https://nuoyannotebook.xyz/support.html) ❤，也欢迎点个 ⭐ Star。

## 开源协议

[MIT](LICENSE)
