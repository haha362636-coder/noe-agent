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
  const extra = [
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

function which(bin) {
  if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : null;
  for (const dir of loginPath().split(path.delimiter)) {
    const p = path.join(dir, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* 继续 */ }
  }
  return null;
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

module.exports = { loginPath, which, baseEnv, setGlobalEnv };
