// 内置终端：通过 pty_bridge.py 获得真实伪终端，用于登录、交互式 / 命令等场景
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const path = require('path');
const crypto = require('crypto');
const { baseEnv, which } = require('./env');

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
  const proc = spawn(process.env.NOE_PYTHON || 'python3', [BRIDGE, String(cols), String(rows), ...argv], {
    cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  const t = {
    id, proc, title: opts.title || argv.join(' '), chatId: opts.chatId || null, agentId: opts.agentId || null,
    kind: opts.kind || 'cli', buffer: '', exited: false, code: null, createdAt: Date.now(),
  };
  terms.set(id, t);
  const dec = new StringDecoder('utf8');
  let typed = !opts.typeAfter, quietTimer = null;
  const push = (data) => {
    t.buffer = (t.buffer + data).slice(-200000);
    emit('term.data', { id, data });
    if (!typed) {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => { typed = true; write(id, opts.typeAfter + '\r'); }, 1200);
    }
  };
  proc.stdout.on('data', (c) => push(dec.write(c)));
  proc.stderr.on('data', (c) => push(c.toString()));
  proc.on('error', (e) => push(`\r\n\x1b[31m无法启动终端：${e.message}\x1b[0m\r\n`));
  proc.on('close', (code) => {
    t.exited = true; t.code = code;
    clearTimeout(quietTimer);
    push(`\r\n\x1b[2m[进程已结束，退出码 ${code}]\x1b[0m\r\n`);
    emit('term.exit', { id, code });
    opts.onExit?.(code, t);
  });
  emit('term.open', summary(t));
  return t;
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
