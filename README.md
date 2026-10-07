<div align="center">

<img src="build/icon.png" width="112" alt="Noe Agent">

# Noe Agent

**把各种 AI 编程助手装进一个聊天软件：一键安装、多厂商 API 管理、私聊任意 AI，或把多个 AI 拖进群里，@ 谁就谁来干活。**

简体中文 | [English](README.en.md)

![版本](https://img.shields.io/badge/version-0.2.0--beta.4-orange)
![平台](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
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

## 下载安装（Windows）

> [!NOTE]
> Windows 版是刚推出的测试版，比 Mac 版更早期，遇到问题欢迎到 [Issues](https://github.com/haha362636-coder/noe-agent/issues) 反馈（附上截图和 Windows 版本）。

到 [Releases](https://github.com/haha362636-coder/noe-agent/releases) 下载：

| 文件 | 说明 |
|---|---|
| `Noe-Agent-<版本>-win-x64-setup.exe` | 安装版（推荐），会创建桌面和开始菜单快捷方式 |
| `Noe-Agent-<版本>-win-x64.zip` | 免安装版，解压后双击 `Noe Agent.exe` |

**1. 先装好两个依赖**（Noe Agent 用 npm 安装各个 AI 工具）：

- [Node.js](https://nodejs.org)（选 LTS 版，一路「下一步」）
- [Git for Windows](https://git-scm.com/download/win)（Claude Code 在 Windows 上需要它自带的 Git Bash）

**2. 安装 Noe Agent**：双击 `setup.exe`。安装包没有代码签名，如果弹出「Windows 已保护你的电脑」，点 **更多信息** → **仍要运行**（只有第一次需要）。

**3. 打开使用**：从桌面或开始菜单打开 Noe Agent，到「AI 工具」页一键安装 Claude Code 等。

系统要求 Windows 10（1809 及以上）或 Windows 11，64 位；ARM 版 Windows 也可以通过系统自带的转译运行。和 Mac 版的区别：快捷键用 `Ctrl`（如 `Ctrl+K`、`Ctrl+J`），内置终端默认 PowerShell，数据保存在 `C:\Users\你的用户名\.noe-agent`。

## 功能

- **AI 擂台（新）**：同一个任务同时交给几个 AI，每个 AI 在自己的项目副本里干活、互不干扰。默认盲评（只显示「选手 A / B / C」），实时对比回答、改了哪些文件、耗时和花费，还会标出最快、最省的选手；你选出胜者后才揭晓身份，只有胜者的改动会合并进工作目录，并且可以用时光机一键撤销。累计战绩做成排行榜。群聊里点输入框下的「擂台」或输入 `/arena 任务`，私聊里 `/arena 任务 @codex` 拉别的 AI 一起比。
- **多语言（新）**：界面支持简体中文和 English，左下角地球按钮或「设置 → 语言」一键切换；系统消息、命令回复、发给 AI 的提示词也跟着切换，AI 会用对应语言回复。第一次打开时按系统语言自动选择。
- **AI 工具**：Claude Code、Codex、DeepSeek Harness、Gemini CLI、Qwen Code、OpenCode 一键安装 / 更新 / 卸载，显示官方账号登录状态；支持接入任意自定义 CLI。
- **模型厂商**：预设 Anthropic、OpenAI、DeepSeek、智谱 GLM、Kimi、阿里云百炼、MiniMax、OpenRouter、硅基流动、Gemini，也可添加任意兼容接口；支持连通性测试、拉取模型列表。
- **一键切换**：每个 AI 可以在「官方登录」和任意厂商 API 之间随时切换（工具卡片、聊天顶部、或 `/use`）。
- **模型选择**：内置最新模型目录（Claude Fable 5.1 / Opus 5.5 / Sonnet 5.5、Gemini 3.8 Flash 等，Codex 实时读取最新列表如 GPT-6.1 Sol / GPT-6 Astra），可搜索、可输入任意模型；Claude Code 与 Codex 可选思考强度。`/model opus 5.5`、`/model gpt-6` 模糊匹配。
- **聊天与群聊**：私聊任意 AI；把 AI 拖进群里用 @ 分派任务，AI 之间还能互相 @ 接力；Markdown 与代码高亮、执行过程时间线、耗时 / token / 费用统计。
- **时光机**：每条 AI 回复都会记录改了哪些文件，可以看差异、一键撤销 / 恢复，对所有 AI 通用（快照独立保存，不影响项目自己的 Git）。
- **工作目录**：新会话先选项目文件夹，AI 做出来的文件就在你知道的地方；回复里的文件链接一点就用默认程序打开。
- **/ 命令**：`/help /arena /login /logout /use /model /effort /status /terminal /shell /new /clear /stop /cwd /invite /kick /rename`；需要交互界面的命令（如 Claude 的 `/config`、`/mcp`）自动在内置终端打开。
- **内置终端**：真实伪终端，用于官方账号登录、交互式命令和续接会话（Mac ⌘J / Windows Ctrl+J）。
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
npm run dist:win         # 在 Mac 上打 Windows 版（安装版 .exe + 免安装 .zip），输出到 release-win/
```

Windows 版和 Mac 版用同一份代码，打包输出放在不同文件夹，互不影响。

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
server/pty.js         内置终端；Mac 用 pty_bridge.py，Windows 用 ConPTY（node-pty）
server/snapshots.js   时光机：用独立的影子 Git 仓库给工作目录拍快照、对比、撤销
server/arena.js       AI 擂台：为每位选手复制项目副本、并行运行、对比改动、合并胜者
server/i18n.js        服务端多语言（系统消息、错误提示、发给 AI 的提示词）
server/store.js       数据保存在 ~/.noe-agent/data.json（仅本机，权限 600）
public/               界面（原生 HTML / CSS / JS）
public/js/i18n.js     界面多语言：以中文为键查表，查不到就显示中文
public/locales/       语言包（en.json），前后端共用；新增语言放一份同结构的 JSON 并在 i18n.js 登记
public/vendor/        打包好的 marked、DOMPurify、highlight.js、xterm（npm run build:vendor 重新生成）
build/                应用图标
```

## 注意事项

- API Key 只保存在本机 `~/.noe-agent/data.json`（Windows 为 `C:\Users\你的用户名\.noe-agent\data.json`），不会上传到任何地方。
- MCP 写入位置：Claude Code 用 `claude mcp add-json -s user`，Codex 用 `codex mcp add`，Gemini / Qwen / OpenCode 直接修改各自的配置文件（首次修改前会备份为 `*.noe-backup`）。
- Codex 使用第三方厂商时，厂商需要兼容 OpenAI Responses 接口（`/v1/responses`）。
- 设置里的「全自动模式」会跳过 CLI 的所有权限确认，请只在可信目录中使用。
- AI 擂台会把工作目录复制到系统临时目录（不含 `node_modules`、`.git`、`dist` 等依赖和构建目录，上限 2 万个文件 / 300 MB），副本保留 3 天后自动清理；对比和合并改动需要本机装有 git。

## 致谢

感谢 [Claude Code](https://claude.com/claude-code) 与 [Electron](https://www.electronjs.org)。

## 支持项目

如果觉得项目不错，可以[支持一下作者](https://nuoyannotebook.xyz/support.html) ❤，也欢迎点个 ⭐ Star。

## 开源协议

[MIT](LICENSE)
