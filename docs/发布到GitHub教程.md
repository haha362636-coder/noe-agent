# 把 Noe Agent 发布到 GitHub

这份教程带你把代码推到 GitHub，并发布一个带安装包的 Beta 版本。全程大约 10 分钟。

## 0. 已经准备好的东西

| 内容 | 位置 | 说明 |
|---|---|---|
| 源代码（已初始化 Git，并完成第一次提交） | 项目根目录 | 直接推送即可 |
| MIT 开源协议 | `LICENSE` | |
| 项目介绍 | `README.md` | 含 Beta 提示、安装说明、致谢、支持链接 |
| 更新日志 | `CHANGELOG.md` | |
| Apple 芯片安装包 | `release/Noe-Agent-0.2.0-beta.1-mac-arm64.dmg` | 上传到 Release |
| Intel 芯片安装包 | `release/Noe-Agent-0.2.0-beta.1-mac-x64.dmg` | 上传到 Release |
| 校验文件 | `release/SHA256SUMS.txt` | 上传到 Release |
| 发布说明 | `release/RELEASE_NOTES.md` | 复制到 Release 的描述里 |

`release/`、`dist/`、`node_modules/` 已写进 `.gitignore`，不会被提交进仓库。安装包超过 100 MB，只能作为 Release 附件上传，不能放进代码仓库。

下面每一步都给了两种做法：**网页操作**（适合第一次用）和 **gh 命令**（你的电脑上已经装好并登录了 GitHub CLI，账号 `haha362636-coder`）。任选一种即可。

---

## 1. 创建 GitHub 仓库

### 方式 A：网页操作

1. 打开 <https://github.com/new>
2. **Repository name** 填 `noe-agent`
3. **Description** 填：`把各种 AI 编程助手装进一个聊天软件：一键安装、多厂商 API、私聊、拉群、@ 干活（Beta）`
4. 选 **Public**（公开）
5. 下面三个选项 **都不要勾**：不要勾 Add a README、不要选 .gitignore、不要选 license。这些文件项目里已经有了，勾上会和本地冲突。
6. 点 **Create repository**

### 方式 B：一条命令（会同时完成第 2 步的推送）

在终端进入项目目录后执行：

```bash
cd "/Users/even/Desktop/Noe Agent"
```

```bash
gh repo create noe-agent --public --source=. --remote=origin --push --description "把各种 AI 编程助手装进一个聊天软件：一键安装、多厂商 API、私聊、拉群、@ 干活（Beta）"
```

用了方式 B 可以直接跳到第 3 步。

---

## 2. 推送代码

用网页创建仓库后，在终端执行：

```bash
cd "/Users/even/Desktop/Noe Agent"
```

```bash
git remote add origin https://github.com/haha362636-coder/noe-agent.git
```

```bash
git push -u origin main
```

刷新仓库页面，能看到 README 和应用图标就成功了。

> 如果仓库名不是 `noe-agent`，记得把 `README.md`、`package.json`、`release/RELEASE_NOTES.md` 和设置页里的 GitHub 地址一起改掉。

---

## 3. 发布 Beta 版本（Release）

### 方式 A：网页操作

1. 打开仓库页面，右侧点 **Releases** → **Draft a new release**（或直接打开 `https://github.com/haha362636-coder/noe-agent/releases/new`）
2. **Choose a tag**：输入 `v0.2.0-beta.1`，点 **Create new tag**
3. **Release title**：`Noe Agent 0.2.0-beta.1（Beta 测试版）`
4. **描述**：打开 `release/RELEASE_NOTES.md`，全选复制，粘贴进去
5. **附件**：把 `release` 文件夹里的三个文件拖进上传区：
   - `Noe-Agent-0.2.0-beta.1-mac-arm64.dmg`
   - `Noe-Agent-0.2.0-beta.1-mac-x64.dmg`
   - `SHA256SUMS.txt`
6. 勾选 **Set as a pre-release**（标记为预发布，表示这是 Beta）
7. 等附件上传完成（两个文件各 100 MB 左右），点 **Publish release**

### 方式 B：一条命令

```bash
cd "/Users/even/Desktop/Noe Agent"
```

```bash
gh release create v0.2.0-beta.1 release/*.dmg release/SHA256SUMS.txt --title "Noe Agent 0.2.0-beta.1（Beta 测试版）" --notes-file release/RELEASE_NOTES.md --prerelease
```

发布后，下载页面地址是：<https://github.com/haha362636-coder/noe-agent/releases>

---

## 4. 完善仓库首页（可选，但推荐）

1. 仓库首页右侧 **About** 旁边的齿轮：
   - **Website** 填支持页面 `https://nuoyannotebook.xyz/support.html`，或者留空
   - **Topics** 加上：`ai`、`claude-code`、`codex`、`gemini-cli`、`mcp`、`electron`、`macos`、`ai-agent`
2. **加截图**：在 App 里截几张图（聊天、群聊、模型选择、MCP 页），放进 `docs/screenshots/`，然后在 README 的「功能」上面加：
   ```markdown
   ![聊天](docs/screenshots/chat.png)
   ```
   再提交推送：
   ```bash
   git add docs/screenshots README.md
   ```
   ```bash
   git commit -m "docs: 添加截图"
   ```
   ```bash
   git push
   ```
3. **赞助按钮**：在仓库里新建 `.github/FUNDING.yml`，内容写一行：
   ```yaml
   custom: ["https://nuoyannotebook.xyz/support.html"]
   ```
   推送后仓库首页会出现 ❤ Sponsor 按钮。

---

## 5. 以后发布新版本

1. 改 `package.json` 里的 `version`，例如 `0.2.0-beta.2`；正式版就用 `1.0.0`
2. 在 `CHANGELOG.md` 最上面写这次更新了什么
3. 打包：
   ```bash
   npm run dist:mac
   ```
4. 整理发布文件：
   ```bash
   rm -rf release && mkdir release && cp dist/*.dmg release/ && (cd release && shasum -a 256 *.dmg > SHA256SUMS.txt)
   ```
5. 提交并推送代码：
   ```bash
   git add -A
   ```
   ```bash
   git commit -m "release: 0.2.0-beta.2"
   ```
   ```bash
   git push
   ```
6. 按第 3 步发布，把 tag 换成新版本号（例如 `v0.2.0-beta.2`），写一份新的发布说明。

---

## 6. 常见问题

**推送时要求输入密码 / 提示认证失败**
GitHub 已经不支持用账号密码推送。先执行一次下面的命令，之后 `git push` 就会走 GitHub CLI 的登录：
```bash
gh auth setup-git
```

**别人下载后打不开，提示「已损坏」**
这是因为安装包没有经过 Apple 公证，不是文件坏了。让对方执行 README 里的命令：
```bash
xattr -cr "/Applications/Noe Agent.app"
```
想彻底去掉这个提示，需要付费的 Apple Developer 账号（每年 99 美元），用 Developer ID 证书签名并公证。

**提示文件超过 100 MB，推送被拒绝**
说明不小心把安装包提交进了仓库。检查 `.gitignore` 里有没有 `dist/` 和 `release/`；如果已经提交了，执行下面两条命令，把它从仓库移除（本地文件会保留）：
```bash
git rm -r --cached dist release
```
```bash
git commit -m "chore: 移除安装包"
```

**Release 上传很慢或失败**
两个安装包各 100 MB 左右，网络不稳时可以用第 3 步的 gh 命令上传，失败后重新执行即可（已上传的附件会提示已存在，可以先在网页上删掉再传）。
