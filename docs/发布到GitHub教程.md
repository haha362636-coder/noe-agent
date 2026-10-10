# 把 Noe Agent 发布到 GitHub

这份教程带你把代码推到 GitHub，并发布一个带安装包的 Beta 版本。全程大约 10 分钟。

## 0. 已经准备好的东西

| 内容 | 位置 | 说明 |
|---|---|---|
| 源代码（已初始化 Git，并完成第一次提交） | 项目根目录 | 直接推送即可 |
| MIT 开源协议 | `LICENSE` | |
| 项目介绍 | `README.md` | 含 Beta 提示、安装说明、致谢、支持链接 |
| 更新日志 | `CHANGELOG.md` | |
| Apple 芯片安装包 | `release/Noe-Agent-0.2.0-beta.2-mac-arm64.dmg` | 上传到 Release |
| Intel 芯片安装包 | `release/Noe-Agent-0.2.0-beta.2-mac-x64.dmg` | 上传到 Release |
| 校验文件 | `release/SHA256SUMS.txt` | 上传到 Release（打包后生成） |
| 发布说明 | `docs/release-notes/0.2.0-beta.2.md` | 复制到 Release 的描述里 |

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

> 如果仓库名不是 `noe-agent`，记得把 `README.md`、`package.json`、`docs/release-notes/0.2.0-beta.2.md` 和设置页里的 GitHub 地址一起改掉。

---

## 3. 发布 Beta 版本（Release）

### 方式 A：网页操作

1. 打开仓库页面，右侧点 **Releases** → **Draft a new release**（或直接打开 `https://github.com/haha362636-coder/noe-agent/releases/new`）
2. **Choose a tag**：输入 `v0.2.0-beta.2`，点 **Create new tag**
3. **Release title**：`Noe Agent 0.2.0-beta.2（Beta 测试版）`
4. **描述**：打开 `docs/release-notes/0.2.0-beta.2.md`，全选复制，粘贴进去
5. **附件**：把 `release` 文件夹里的三个文件拖进上传区：
   - `Noe-Agent-0.2.0-beta.2-mac-arm64.dmg`
   - `Noe-Agent-0.2.0-beta.2-mac-x64.dmg`
   - `SHA256SUMS.txt`
6. 勾选 **Set as a pre-release**（标记为预发布，表示这是 Beta）
7. 等附件上传完成（两个文件各 100 MB 左右），点 **Publish release**

### 方式 B：一条命令

```bash
cd "/Users/even/Desktop/Noe Agent"
```

```bash
gh release create v0.2.0-beta.2 release/*.dmg release/SHA256SUMS.txt --title "Noe Agent 0.2.0-beta.2（Beta 测试版）" --notes-file docs/release-notes/0.2.0-beta.2.md --prerelease
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

## 5. 以后发布新版本（以 0.2.0-beta.5 为例，Mac + Windows 一起发）

整个流程分两段：**准备**（改代码、改版本号、写更新说明、打包）和**发布**（提交推送代码、上传安装包）。

### 准备（0.2.0-beta.5 已经全部做好）

| 要做的事 | 位置 | 0.2.0-beta.5 |
|---|---|---|
| 改版本号 | `package.json`、`package-lock.json`、两个 README 里的版本徽章 | ✅ 已改 |
| 写更新日志 | `CHANGELOG.md` 最上面 | ✅ 已写 |
| 写发布说明（Release 页面显示的内容） | `docs/release-notes/<版本号>.md` | ✅ `docs/release-notes/0.2.0-beta.5.md` |
| 打 Mac 包（Apple 芯片 + Intel） | `npm run dist:mac` → `dist/` | ✅ 已打 |
| 打 Windows 包（安装版 + 免安装版） | `npm run dist:win` → `release-win/` | ✅ 已打 |
| 整理要上传的文件 | `release/` | ✅ 6 个文件已放好 |

> 发布说明放在 `docs/release-notes/` 里，会跟着代码一起提交。不要放进 `release/`：那个文件夹不进 Git，而且每次打包都会清空。

下一个版本改版本号可以用这条命令，它会同时改 `package.json` 和 `package-lock.json`（README 徽章里的版本号要手动改）：

```bash
npm version 0.2.0-beta.6 --no-git-tag-version
```

自己重新打包时按这个顺序（每条单独执行）：

```bash
npm run dist:mac
```

```bash
npm run dist:win
```

然后把 Mac 和 Windows 的安装包一起放进 `release/`，并生成两份校验文件（只拷当前版本号的文件，`dist/` 里的旧版本不会混进来）：

```bash
V=$(node -p "require('./package.json').version") && rm -rf release && mkdir release && cp dist/Noe-Agent-$V-*.dmg release/ && (cd release && shasum -a 256 *.dmg > SHA256SUMS.txt) && cp release-win/Noe-Agent-$V-* release/ && cp release-win/SHA256SUMS.txt release/SHA256SUMS-windows.txt
```

### 发布

**第 1 步：进入项目目录**

```bash
cd "/Users/even/Desktop/Noe Agent"
```

**第 2 步：检查要上传的文件**（应该有 6 个，文件名里的版本号是 `0.2.0-beta.5`）

```bash
ls -lh release
```

| 文件 | 是什么 |
|---|---|
| `Noe-Agent-0.2.0-beta.5-mac-arm64.dmg` | Mac · Apple 芯片 |
| `Noe-Agent-0.2.0-beta.5-mac-x64.dmg` | Mac · Intel |
| `Noe-Agent-0.2.0-beta.5-win-x64-setup.exe` | Windows 安装版 |
| `Noe-Agent-0.2.0-beta.5-win-x64.zip` | Windows 免安装版 |
| `SHA256SUMS.txt` | Mac 安装包校验 |
| `SHA256SUMS-windows.txt` | Windows 安装包校验 |

**第 3 步：装上自己先试一下**（推荐）

双击 `release` 里对应你芯片的 dmg，把 App 拖进「应用程序」覆盖旧版，打开用一下。没问题再发布。

**第 4 步：提交代码**

先看看有哪些改动：

```bash
git status
```

把要发布的文件加进来。`promo/`（宣传视频工程）没有列在这里，要不要提交你自己决定：

```bash
git add CHANGELOG.md README.md README.en.md package.json package-lock.json build docs electron public server
```

```bash
git commit -m "release: 0.2.0-beta.5（灰白新界面、官方品牌图标、新应用图标）"
```

**第 5 步：推送到 GitHub**

```bash
git push
```

**第 6 步：创建 Release 并上传 6 个文件**（会同时在 GitHub 上打 `v0.2.0-beta.5` 这个 tag）

```bash
gh release create v0.2.0-beta.5 release/* --title "Noe Agent 0.2.0-beta.5（Beta 测试版）" --notes-file docs/release-notes/0.2.0-beta.5.md --prerelease
```

上传四个安装包需要一点时间，命令结束后会打印 Release 页面的网址。

也可以用网页操作：打开 <https://github.com/haha362636-coder/noe-agent/releases/new>，tag 填 `v0.2.0-beta.5` 并点 **Create new tag**，标题填 `Noe Agent 0.2.0-beta.5（Beta 测试版）`，描述粘贴 `docs/release-notes/0.2.0-beta.5.md` 的全部内容，把 `release` 文件夹里的 6 个文件拖进上传区，勾选 **Set as a pre-release**，等上传完成后点 **Publish release**。

**第 7 步：检查**

```bash
gh release view v0.2.0-beta.5 --web
```

浏览器里打开 Release 页面，确认 6 个附件都在、标着 Pre-release，README 里的截图和新图标也能正常显示。

### 发错了怎么办

- **Release 内容写错**：在 Release 页面点 ✏️ 编辑即可，不用重新发布。
- **安装包传错了，要重新传**（`--clobber` 表示覆盖同名文件）：

  ```bash
  gh release upload v0.2.0-beta.5 release/* --clobber
  ```

- **整个 Release 不要了**（连同 tag 一起删除，然后可以从第 6 步重来）：

  ```bash
  gh release delete v0.2.0-beta.5 --cleanup-tag
  ```

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
