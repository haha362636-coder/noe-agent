// 解析用户登录 shell 的 PATH。
// 从 Finder / Dock 启动的 Electron 拿不到 nvm、Homebrew 等写在 .zshrc 里的 PATH，
// 所以启动时从登录 shell 取一次，保证能找到 npm、claude、codex 等命令。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let cachedPath = null;

function loginPath() {
  if (cachedPath) return cachedPath;
  const extra = process.platform === 'win32' ? winExtraPath() : [
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
    path.join(os.homedir(), '.local/bin'), path.join(os.homedir(), '.npm-global/bin'),
    path.join(os.homedir(), '.bun/bin'), path.join(os.homedir(), '.opencode/bin'),
  ];
  let shellPath = '';
  if (process.platform !== 'win32') {
    const shell = process.env.SHELL || '/bin/zsh';
    try {
      const out = execFileSync(shell, ['-ilc', 'echo "__NOE__$PATH"'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/__NOE__(.*)/);
      if (m) shellPath = m[1].trim();
    } catch { /* 忽略，使用兜底 PATH */ }
  }
  const parts = [...shellPath.split(path.delimiter), ...(process.env.PATH || '').split(path.delimiter), ...extra]
    .filter(Boolean);
  cachedPath = [...new Set(parts)].join(path.delimiter);
  return cachedPath;
}

// Windows 上 npm 全局命令、Git、Node 常见的安装位置（从开始菜单启动时 PATH 可能不全）
function winExtraPath() {
  const e = process.env;
  return [
    e.APPDATA && path.join(e.APPDATA, 'npm'),
    e.ProgramFiles && path.join(e.ProgramFiles, 'nodejs'),
    e.ProgramFiles && path.join(e.ProgramFiles, 'Git', 'cmd'),
    e.LOCALAPPDATA && path.join(e.LOCALAPPDATA, 'Programs', 'Git', 'cmd'),
    path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.bun', 'bin'),
    e.SystemRoot && path.join(e.SystemRoot, 'System32'),
    e.SystemRoot && path.join(e.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
  ];
}

function which(bin) {
  if (process.platform === 'win32') return whichWin(bin);
  if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : null;
  for (const dir of loginPath().split(path.delimiter)) {
    const p = path.join(dir, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* 继续 */ }
  }
  return null;
}

// Windows 的命令带扩展名（claude.cmd、git.exe），按 PATHEXT 逐个尝试
function whichWin(bin) {
  const exts = path.extname(bin) ? [''] : ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)];
  const tryFile = (p) => {
    for (const ext of exts) {
      if (!ext && !path.extname(p)) continue; // 没扩展名的同名文件通常是给 Git Bash 用的 sh 脚本，不能直接运行
      try { if (fs.statSync(p + ext).isFile()) return p + ext; } catch { /* 继续 */ }
    }
    return null;
  };
  if (path.isAbsolute(bin)) return tryFile(bin);
  for (const dir of loginPath().split(path.delimiter)) {
    const p = tryFile(path.join(dir, bin));
    if (p) return p;
  }
  return null;
}

/**
 * 把「命令 + 参数」变成可以直接 spawn 的形式，返回 [file, args, extraOpts]。
 * macOS / Linux 原样返回。Windows 上 npm 装的 CLI 是 .cmd 外壳，Node 不允许直接 spawn，
 * 而经 cmd.exe 转发时引号、换行、& | 等字符会被破坏（提示词里很常见），
 * 所以优先从 .cmd 里找出真正的 JS 入口，用 node 直接运行。
 */
function resolveCommand(bin, args = []) {
  const file = which(bin) || bin;
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return [file, args, {}];
  try {
    const src = fs.readFileSync(file, 'utf8');
    const m = src.match(/"%~?dp0%?\\?([^"]+)"\s+%\*/);
    if (m) {
      const target = path.join(path.dirname(file), m[1]);
      if (/\.(c|m)?js$/i.test(target)) {
        const localNode = path.join(path.dirname(file), 'node.exe');
        const node = fs.existsSync(localNode) ? localNode : which('node');
        if (node && fs.existsSync(target)) return [node, [target, ...args], {}];
      } else if (/\.exe$/i.test(target) && fs.existsSync(target)) return [target, args, {}];
    }
  } catch { /* 解析失败就走 cmd.exe */ }
  // 兜底：经 cmd.exe 转发，转义规则同 cross-spawn（.cmd 外壳会再解析一次 %*，所以参数要转义两遍）
  const meta = /([()\][%!^"`<>&|;, *?])/g;
  const arg = (a) => `"${String(a).replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1')}"`.replace(meta, '^$1').replace(meta, '^$1');
  const line = [file.replace(meta, '^$1'), ...args.map(arg)].join(' ');
  return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true }];
}

// Noe 统一注入的环境变量（例如 Codex 读取 MCP Token 的变量）
let globalEnv = {};
function setGlobalEnv(env) { globalEnv = env || {}; }

// 子进程的基础环境：带上登录 PATH，并去掉宿主 Claude Code 会话的标记，避免被识别为嵌套调用
function baseEnv(extra = {}) {
  const env = { ...process.env, PATH: loginPath(), FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'ELECTRON_RUN_AS_NODE') delete env[k];
  }
  return { ...env, ...globalEnv, ...extra };
}

module.exports = { loginPath, which, resolveCommand, baseEnv, setGlobalEnv };
