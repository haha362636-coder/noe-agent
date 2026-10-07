// 内置终端：通过 pty_bridge.py 获得真实伪终端，用于登录、交互式 / 命令等场景
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const path = require('path');
const crypto = require('crypto');
const { baseEnv, which, resolveCommand } = require('./env');
const { t } = require('./i18n');

const BRIDGE = path.join(__dirname, 'pty_bridge.py').replace('app.asar', 'app.asar.unpacked');
const terms = new Map();
let emit = () => {};

function setEmitter(fn) { emit = fn; }

/**
 * 打开一个终端。opts: { argv, cwd, env, title, chatId, agentId, kind, typeAfter, onExit }
 * typeAfter：启动后等输出安静下来再自动输入的文本（用于把 / 命令送进交互界面）
 */
function open(opts) {
  const id = crypto.randomBytes(5).toString('hex');
  const cols = opts.cols || 100, rows = opts.rows || 28;
  const argv = [...opts.argv];
  const resolved = which(argv[0]);
  if (resolved) argv[0] = resolved;
  const env = { ...(opts.env || baseEnv()), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  delete env.NO_COLOR; delete env.FORCE_COLOR;
  // Windows 没有 Python pty，改用 ConPTY（node-pty），对外暴露同样的 proc 接口
  const proc = process.platform === 'win32' ? winPty(argv, { cols, rows, cwd: opts.cwd, env }) : spawn(process.env.NOE_PYTHON || 'python3', [BRIDGE, String(cols), String(rows), ...argv], {
    cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  const term = {
    id, proc, title: opts.title || argv.join(' '), chatId: opts.chatId || null, agentId: opts.agentId || null,
    kind: opts.kind || 'cli', buffer: '', exited: false, code: null, createdAt: Date.now(),
  };
  terms.set(id, term);
  const dec = new StringDecoder('utf8');
  let typed = !opts.typeAfter, quietTimer = null;
  const push = (data) => {
    // 输出很密集时（如 npm 安装日志）每次拼接 20 万字符的字符串很浪费，攒到两倍上限再裁剪
    term.buffer += data;
    if (term.buffer.length > 400000) term.buffer = term.buffer.slice(-200000);
    emit('term.data', { id, data });
    if (!typed) {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => { typed = true; write(id, opts.typeAfter + '\r'); }, 1200);
    }
  };
  proc.stdout.on('data', (c) => push(dec.write(c)));
  proc.stderr.on('data', (c) => push(c.toString()));
  proc.on('error', (e) => push(`\r\n\x1b[31m${t('无法启动终端：')}${e.message}\x1b[0m\r\n`));
  proc.on('close', (code) => {
    term.exited = true; term.code = code;
    clearTimeout(quietTimer);
    push(`\r\n\x1b[2m[${t('进程已结束，退出码 {code}', { code })}]\x1b[0m\r\n`);
    emit('term.exit', { id, code });
    opts.onExit?.(code, term);
  });
  emit('term.open', summary(term));
  return term;
}

// 把 node-pty 包装成和 pty_bridge 子进程一样的形状：stdout/stderr 事件、stdin.write、stdio[3] 调整尺寸、kill、close
function winPty(argv, { cols, rows, cwd, env }) {
  const { EventEmitter } = require('events');
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  let p;
  try {
    const [file, args] = resolveCommand(argv[0], argv.slice(1));
    p = require('@lydell/node-pty').spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env, useConpty: true });
  } catch (e) {
    setImmediate(() => { proc.emit('error', e); proc.emit('close', 1); });
    proc.stdin = { write() {} };
    proc.stdio = [null, null, null, { write() {} }];
    proc.kill = () => {};
    return proc;
  }
  p.onData((d) => proc.stdout.emit('data', Buffer.from(d, 'utf8')));
  p.onExit(({ exitCode }) => proc.emit('close', exitCode));
  proc.stdin = { write: (d) => { try { p.write(d); } catch { /* 已退出 */ } } };
  proc.stdio = [null, null, null, { write: (line) => { const [c, r] = String(line).trim().split(/\s+/).map(Number); try { p.resize(c, r); } catch { /* 已退出 */ } } }];
  proc.kill = () => { try { p.kill(); } catch { /* 已退出 */ } };
  return proc;
}

function write(id, data) {
  const t = terms.get(id);
  if (t && !t.exited) t.proc.stdin.write(data);
}
function resize(id, cols, rows) {
  const t = terms.get(id);
  if (t && !t.exited && cols > 0 && rows > 0) t.proc.stdio[3].write(`${cols | 0} ${rows | 0}\n`);
}
function close(id) {
  const t = terms.get(id);
  if (!t) return;
  if (!t.exited) try { t.proc.kill('SIGHUP'); setTimeout(() => !t.exited && t.proc.kill('SIGKILL'), 1500); } catch { /* 已退出 */ }
  terms.delete(id);
  emit('term.closed', { id });
}
function summary(t) { return { id: t.id, title: t.title, chatId: t.chatId, agentId: t.agentId, kind: t.kind, exited: t.exited, code: t.code, createdAt: t.createdAt }; }
function list() { return [...terms.values()].map(summary); }
function get(id) { return terms.get(id); }
function closeAll() { for (const id of [...terms.keys()]) close(id); }

module.exports = { setEmitter, open, write, resize, close, list, get, closeAll };
