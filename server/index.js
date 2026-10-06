// Noe Agent 本地服务：静态页面 + REST API + SSE 实时推送
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const store = require('./store');
const pty = require('./pty');
const { PRESETS, PROTOCOLS, testProvider, listModels } = require('./providers');
const { BUILTIN, CLAUDE_INTERACTIVE, fromCustom, installCmd, uninstallCmd, runAgent, resolveAuth, supports, authStatus, interactiveArgv, stripAnsi } = require('./agents');
const { baseEnv, which, setGlobalEnv } = require('./env');
const ext = require('./extensions');
const { CATALOG, GEMINI_EXTENSIONS, CLAUDE_MARKETPLACES } = require('./mcp-catalog');
const models = require('./models');
const snapshots = require('./snapshots');

const PUBLIC = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const db = store.load();
const uid = () => crypto.randomBytes(6).toString('hex');
setGlobalEnv(db.mcpEnv ||= {});

// ---------- SSE ----------
const clients = new Set();
function broadcast(type, payload) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}
pty.setEmitter(broadcast);

// ---------- agents ----------
function allAgents() { return [...BUILTIN, ...db.customAgents.map(fromCustom)]; }
function getAgent(id) { return allAgents().find((a) => a.id === id); }
function agentCfg(id) { return (db.agentConfig[id] ||= { mode: 'official', providerId: '', model: '', extraEnv: '' }); }
function getProvider(id) { return db.providers.find((p) => p.id === id); }
function activeProvider(agentId) {
  const cfg = agentCfg(agentId);
  return cfg.mode === 'provider' ? getProvider(cfg.providerId) : null;
}

const statusCache = {}; // id -> { installed, version, path }
const authCache = {};   // id -> { loggedIn, detail } | null
function checkStatus(agent) {
  return new Promise((resolve) => {
    const p = which(agent.bin);
    if (!p) { authCache[agent.id] = null; return resolve((statusCache[agent.id] = { installed: false })); }
    // 自定义 CLI 可能根本不认识 --version，会把它当成任务去执行，所以只检查是否存在
    if (agent.custom) { authCache[agent.id] = null; return resolve((statusCache[agent.id] = { installed: true, version: '', path: p })); }
    execFile(p, ['--version'], { env: baseEnv(), cwd: os.homedir(), timeout: 15000 }, async (err, out, errOut) => {
      const raw = stripAnsi(String(out || errOut || '')).trim().split('\n')[0] || '';
      const version = (raw.match(/\d+\.\d+[\w.\-]*/) || [''])[0];
      statusCache[agent.id] = { installed: true, version: version.slice(0, 40), path: p };
      authCache[agent.id] = await authStatus(agent);
      resolve(statusCache[agent.id]);
    });
  });
}
async function refreshAgent(id) { const a = getAgent(id); if (a) { await checkStatus(a); broadcast('agents.changed', {}); } }

function mask(v) { return !v ? '' : v.length <= 8 ? '••••' : v.slice(0, 4) + '••••' + v.slice(-4); }
function publicProvider(p) { return { ...p, apiKey: mask(p.apiKey), hasKey: !!p.apiKey }; }

function publicAgent(a) {
  const cfg = agentCfg(a.id);
  return {
    id: a.id, name: a.name, vendor: a.vendor, color: a.color, avatar: a.avatar, desc: a.desc, bin: a.bin,
    homepage: a.homepage, custom: !!a.custom, protocols: a.protocols || [], protocolNote: a.protocolNote,
    officialLabel: a.officialLabel, noModel: !!a.noModel,
    canLogin: !!a.loginCmd, canLogout: !!a.logoutCmd, installCmd: installCmd(a), resumable: !!a.resumable,
    slashMode: a.slash, slash: db.agentMeta[a.id]?.slash || [],
    config: { mode: cfg.mode, providerId: cfg.providerId || '', model: cfg.model || '', effort: cfg.effort || '', extraEnv: cfg.extraEnv || '' },
    status: statusCache[a.id] || null, auth: authCache[a.id] ?? null, installing: !!installs[a.id],
    customDef: a.custom ? db.customAgents.find((c) => c.id === a.id) : undefined,
  };
}
function authLabel(agent) {
  const cfg = agentCfg(agent.id);
  const p = activeProvider(agent.id);
  const src = p ? `厂商「${p.name}」` : agent.officialLabel || '官方登录';
  const model = cfg.model || (p ? p.models?.[0] : '') || '默认模型';
  const effort = cfg.effort ? ` · 思考强度 ${models.EFFORT_LABEL[cfg.effort] || cfg.effort}` : '';
  return `${src} · ${agent.noModel ? '' : model}${effort}`.replace(/ · $/, '');
}

// ---------- 安装 / 卸载 ----------
const installs = {};
function runShell(agentId, cmd, label) {
  if (installs[agentId]) return false;
  const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/zsh');
  const args = process.platform === 'win32' ? ['/c', cmd] : ['-lc', cmd];
  const proc = spawn(shell, args, { env: baseEnv(), cwd: os.homedir() });
  installs[agentId] = proc;
  broadcast('install.log', { agentId, line: `$ ${cmd}\n` });
  broadcast('agents.changed', {});
  const onData = (c) => broadcast('install.log', { agentId, line: stripAnsi(c.toString()) });
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  const finish = async (code, err) => {
    delete installs[agentId];
    await checkStatus(getAgent(agentId));
    broadcast('install.log', { agentId, line: err ? `\n✗ ${err.message}\n` : code === 0 ? `\n✓ ${label}完成\n` : `\n✗ ${label}失败（退出码 ${code}）\n` });
    broadcast('install.done', { agentId, ok: code === 0 && !err, label });
    broadcast('agents.changed', {});
  };
  proc.on('error', (e) => finish(1, e));
  proc.on('close', (code) => finish(code));
  return true;
}

// ---------- 内置终端 ----------
function openLogin(agent, chatId, logout = false) {
  const argv = logout ? agent.logoutCmd : agent.loginCmd;
  if (!argv) throw httpErr(400, `${agent.name} 不支持${logout ? '退出登录' : '账号登录'}`);
  if (!which(agent.bin)) throw httpErr(400, `${agent.name} 还没有安装`);
  // 登录走官方通道：用干净环境，避免第三方 Key 干扰
  const env = resolveAuth(agent, { mode: 'official', extraEnv: agentCfg(agent.id).extraEnv }).env;
  return pty.open({
    argv, env, cwd: os.homedir(), chatId, agentId: agent.id, kind: logout ? 'logout' : 'login',
    title: `${agent.name} · ${logout ? '退出登录' : '登录'}`,
    onExit: async () => {
      await refreshAgent(agent.id);
      const auth = authCache[agent.id];
      if (chatId) {
        const state = auth ? (auth.loggedIn ? `✅ ${agent.name} 已登录（${auth.detail}）` : `${agent.name} 当前未登录`) : `${agent.name} 的${logout ? '退出' : '登录'}流程已结束`;
        const hint = !logout && auth?.loggedIn && agentCfg(agent.id).mode === 'provider' ? `。当前仍在使用厂商 API，输入 /use official @${agent.id} 切换到官方登录` : '';
        addMessage(chatId, { sender: 'system', text: state + hint });
      }
    },
  });
}

function openAgentTerminal(agent, chat, { initial, typeAfter } = {}) {
  if (!which(agent.bin)) throw httpErr(400, `${agent.name} 还没有安装`);
  const cfg = agentCfg(agent.id);
  const auth = resolveAuth(agent, cfg, activeProvider(agent.id));
  const argv = interactiveArgv(agent, { sessionId: chat?.sessions?.[agent.id], initial, preArgs: auth.preArgs, model: agent.noModel ? '' : auth.model, effort: cfg.effort });
  return pty.open({
    argv, env: auth.env, cwd: chat ? chatCwd(chat) : os.homedir(), chatId: chat?.id, agentId: agent.id, kind: 'cli',
    title: `${agent.name}${initial || typeAfter ? ' · ' + (initial || typeAfter) : ' · 交互终端'}`, typeAfter,
  });
}

function openShell(chat) {
  const shell = process.env.SHELL || '/bin/zsh';
  return pty.open({ argv: [shell, '-l'], env: baseEnv(), cwd: chat ? chatCwd(chat) : os.homedir(), chatId: chat?.id, kind: 'shell', title: `终端 · ${chat ? path.basename(chatCwd(chat)) : '~'}` });
}

// ---------- 聊天 ----------
function getChat(id) {
  let chat = db.chats.find((c) => c.id === id);
  if (!chat && id.startsWith('dm-')) {
    const agent = getAgent(id.slice(3));
    if (!agent) return null;
    chat = { id, type: 'dm', name: agent.name, members: [agent.id], cwd: '', sessions: {}, createdAt: Date.now() };
    db.chats.push(chat);
    store.save();
  }
  return chat;
}
function chatCwd(chat) {
  const dir = chat.cwd || path.join(db.settings.workspace, chat.type === 'dm' ? chat.members[0] : chat.id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function msgs(chatId) { return (db.messages[chatId] ||= []); }

function addMessage(chatId, m) {
  const msg = { id: uid(), chatId, ts: Date.now(), steps: [], status: 'done', ...m };
  msgs(chatId).push(msg);
  store.save();
  broadcast('message', msg);
  return msg;
}

// 解析 @：支持 @id、@名称（忽略大小写，名称中的空格可省略）、@all / @所有人
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function parseMentions(text, chat, exclude) {
  const members = chat.members.map(getAgent).filter(Boolean);
  const lower = text.toLowerCase();
  const hits = [];
  const all = /@(all|所有人|全体)(?![a-z0-9_-])/i.test(text);
  for (const a of members) {
    // 名称里的空格允许省略或保留：@claude code、@claudecode 都能匹配
    const aliases = [reEsc(a.id), reEsc(a.bin.toLowerCase()), a.name.toLowerCase().trim().split(/\s+/).map(reEsc).join('\\s*')];
    let pos = all ? 0 : Infinity;
    for (const al of aliases) {
      const m = new RegExp('@' + al + '(?![a-z0-9_-])').exec(lower);
      if (m) pos = Math.min(pos, m.index);
    }
    if (pos !== Infinity && a.id !== exclude) hits.push([pos, a.id]);
  }
  return hits.sort((x, y) => x[0] - y[0]).map((h) => h[1]);
}

function senderName(m) {
  if (m.sender === 'user') return '用户';
  return getAgent(m.sender)?.name || m.sender;
}

function buildPrompt(chat, agent, trigger) {
  if (chat.type === 'dm') {
    if (agent.resumable && chat.sessions?.[agent.id]) return trigger.text;
    const hist = msgs(chat.id).filter((m) => m.id !== trigger.id && m.status !== 'streaming' && m.text && m.sender !== 'system' && !m.command).slice(-8);
    if (!hist.length) return trigger.text;
    return `以下是我们之前的对话：\n${hist.map((m) => `[${senderName(m)}]: ${clipText(m.text, 1500)}`).join('\n')}\n\n---\n用户的新消息：\n${trigger.text}`;
  }
  const members = chat.members.map(getAgent).filter(Boolean);
  const limit = db.settings.historyLimit ?? 20;
  const hist = limit ? msgs(chat.id).filter((m) => m.id !== trigger.id && m.status !== 'streaming' && m.text && m.sender !== 'system' && !m.command).slice(-limit) : [];
  return [
    `你是 ${agent.name}（群内 ID：@${agent.id}），正在群聊「${chat.name}」中与用户以及其他 AI 助手协作完成任务。`,
    `群成员：用户、${members.map((a) => `@${a.id}（${a.name}）`).join('、')}。`,
    `所有成员共享同一个工作目录：${chatCwd(chat)}`,
    hist.length ? `\n最近的群聊记录：\n${hist.map((m) => `[${senderName(m)}]: ${clipText(m.text, 2000)}`).join('\n')}` : '',
    `\n---\n现在 ${senderName(trigger)} @了你：\n${trigger.text}`,
    `\n请直接完成交给你的部分，回复会发到群里。提到你创建或修改的文件时请写出完整的绝对路径，方便用户点击打开。如果需要其他成员接手或协助，在回复中 @对方ID 并写清楚具体任务；不需要时不要 @ 别人。`,
  ].join('\n');
}
function clipText(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

const running = new Map(); // msgId -> { proc, chatId }（排队中的任务 proc 为 null）
const lanes = new Map();   // `${chatId}:${agentId}` -> 该成员在该会话里最后一个任务的 Promise
const alive = (chatId, msg) => msgs(chatId).includes(msg) && db.chats.some((c) => c.id === chatId);
const chatBusy = (chatId) => [...running.values()].some((r) => r.chatId === chatId);

/**
 * 同一个会话里同一个 AI 的任务排队执行：同时续接同一个 CLI 会话会互相覆盖上下文，
 * 所以上一条还在跑时，新消息先显示“排队中”，轮到它再启动。
 */
async function dispatch(chat, agentId, trigger, depth, { raw } = {}) {
  const agent = getAgent(agentId);
  if (!agent) return;
  const key = `${chat.id}:${agent.id}`;
  const prev = lanes.get(key);
  const reply = addMessage(chat.id, { sender: agent.id, text: '', status: 'streaming', ...(prev ? { queued: true } : {}), replyTo: trigger.id, meta: { provider: activeProvider(agent.id)?.name || '官方登录' } });
  running.set(reply.id, { proc: null, chatId: chat.id });
  broadcast('chats.busy', { chatId: chat.id, busy: true });
  let release;
  const mine = new Promise((r) => (release = r));
  lanes.set(key, mine);
  try {
    if (prev) await prev;
    await runReply(chat, agent, reply, trigger, { raw });
  } finally {
    release();
    if (lanes.get(key) === mine) lanes.delete(key);
  }
  // 接力：AI 在回复里 @ 了其他成员（放在排队之外，避免 A→B→A 互相等待）
  if (chat.type === 'group' && reply.status === 'done' && reply.text && depth < (db.settings.maxChain ?? 3) && alive(chat.id, reply)) {
    const next = parseMentions(reply.text, chat, agent.id);
    await Promise.all(next.map((id) => dispatch(chat, id, reply, depth + 1)));
  }
}

async function runReply(chat, agent, reply, trigger, { raw } = {}) {
  const finish = () => {
    running.delete(reply.id);
    if (!alive(chat.id, reply)) return false; // 会话被删除 / 清空，或这条消息被删了
    store.save();
    broadcast('message.update', reply);
    broadcast('chats.busy', { chatId: chat.id, busy: chatBusy(chat.id) });
    return true;
  };
  // 排队期间被停止或删除
  if (!running.has(reply.id) || !alive(chat.id, reply)) {
    reply.status = 'stopped'; delete reply.queued;
    finish();
    return;
  }
  if (reply.queued) { delete reply.queued; broadcast('message.update', reply); }

  const sessions = (chat.sessions ||= {});
  const prompt = raw ? trigger.text : buildPrompt(chat, agent, trigger);
  // 时光机：开工前给工作目录拍快照，结束后再拍一次，记录这条回复改了哪些文件
  const cwd = chatCwd(chat);
  const base = db.settings.snapshots !== false ? await snapshots.take(cwd, `before ${agent.id} ${reply.id}`) : null;
  // 拍快照期间被停止了：不再启动 CLI
  if (!running.has(reply.id)) { reply.status = 'stopped'; finish(); return; }
  const exec = (sessionId) => runAgent(agent, {
    prompt, cwd: chatCwd(chat), sessionId, cfg: agentCfg(agent.id), provider: activeProvider(agent.id), settings: db.settings,
    onEvent: (ev) => {
      if (ev.type === 'text') { reply.text += ev.delta; broadcast('message.delta', { id: reply.id, chatId: chat.id, delta: ev.delta }); }
      else if (ev.type === 'step') { reply.steps.push(ev.step); broadcast('message.step', { id: reply.id, chatId: chat.id, step: ev.step }); }
      else if (ev.type === 'session') { sessions[agent.id] = ev.id; store.save(); }
      else if (ev.type === 'slash') { (db.agentMeta[agent.id] ||= {}).slash = ev.list; store.save(); }
    },
  });

  let { proc, done } = exec(agent.resumable ? sessions[agent.id] : null);
  running.set(reply.id, { proc, chatId: chat.id });
  let result = await done;
  // 会话失效时自动开新会话重试一次
  if (result.error && !reply.text && agent.resumable && sessions[agent.id] && running.has(reply.id) && !/not logged in|login|auth|认证/i.test(result.error)) {
    delete sessions[agent.id];
    reply.steps = [];
    ({ proc, done } = exec(null));
    running.set(reply.id, { proc, chatId: chat.id });
    result = await done;
  }
  const wasStopped = !running.has(reply.id) || result.stopped;

  reply.text = (result.text || reply.text || '').trim();
  reply.meta = result.meta;
  reply.status = wasStopped ? 'stopped' : result.error ? 'error' : 'done';
  if (result.error && !wasStopped && result.error.trim() !== reply.text) reply.error = result.error;
  if (base) {
    const head = await snapshots.take(cwd, `after ${agent.id} ${reply.id}`);
    if (head && head !== base) {
      try {
        const files = await snapshots.changes(cwd, base, head);
        if (files.length) reply.changes = { cwd, base, head, files: files.slice(0, 500), total: files.length, add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) };
      } catch (e) { console.error('[snapshot]', e.message); }
    }
  }
  if (!finish()) return;

  const errText = `${reply.error || ''}\n${reply.text}`;
  // 交互式命令在无头模式下不可用：自动转到内置终端
  if (raw && /isn't available in this environment|not available in this environment/i.test(errText)) {
    const t = openAgentTerminal(agent, chat, { initial: trigger.text });
    addMessage(chat.id, { sender: 'system', text: `${trigger.text} 需要交互界面，已在内置终端中打开`, term: t.id });
  } else if (/not logged in|please run \/login|invalid api key|authentication|认证失败|401/i.test(errText) && reply.status === 'error') {
    addMessage(chat.id, { sender: 'system', text: `${agent.name} 认证失败。输入 /login @${agent.id} 登录官方账号，或 /use <厂商名> @${agent.id} 改用 API 厂商。`, actions: [{ label: '立即登录', cmd: `/login @${agent.id}` }, { label: '配置厂商', goto: 'providers' }] });
  }
}

async function onUserMessage(chat, text) {
  const msg = addMessage(chat.id, { sender: 'user', text });
  let targets;
  if (chat.type === 'dm') targets = chat.members;
  else {
    targets = parseMentions(text, chat);
    if (!targets.length) {
      addMessage(chat.id, { sender: 'system', text: '在群里用 @成员 指派任务，例如 “@claude 写接口，@codex 写测试”，或 @所有人。' });
      return;
    }
  }
  await Promise.all(targets.map((id) => dispatch(chat, id, msg, 0)));
}

function stopChat(chatId) {
  for (const [id, r] of running) if (r.chatId === chatId) { running.delete(id); try { r.proc?.kill('SIGTERM'); } catch { /* 已退出 */ } }
}
function stopMessage(msgId) {
  const r = running.get(msgId); if (!r) return false;
  running.delete(msgId);
  try { r.proc?.kill('SIGTERM'); } catch { /* 已退出 */ }
  return true;
}

// ---------- / 命令 ----------
const COMMANDS = [
  { name: 'help', desc: '查看所有命令' },
  { name: 'login', args: '[@成员]', desc: '在内置终端登录官方账号' },
  { name: 'logout', args: '[@成员]', desc: '退出官方账号' },
  { name: 'use', args: '<厂商|official> [@成员]', desc: '切换 API 来源：官方登录或某个模型厂商' },
  { name: 'model', args: '<模型> [@成员]', desc: '切换模型，支持模糊输入：/model opus 5.5、/model gpt-6' },
  { name: 'effort', args: '<low|medium|high|xhigh|max> [@成员]', desc: '设置思考强度（default 恢复默认）' },
  { name: 'status', desc: '查看成员的安装、登录、API 来源和模型' },
  { name: 'terminal', args: '[@成员]', desc: '打开 AI 的交互式终端（续接当前会话）' },
  { name: 'shell', desc: '在工作目录打开系统终端' },
  { name: 'new', desc: '开启新会话：保留记录，重置 AI 上下文' },
  { name: 'clear', desc: '清空聊天记录并重置上下文' },
  { name: 'stop', desc: '停止正在运行的 AI' },
  { name: 'cwd', args: '[路径]', desc: '查看或修改工作目录' },
  { name: 'invite', args: '@成员 …', desc: '拉 AI 进群', group: true },
  { name: 'kick', args: '@成员 …', desc: '把 AI 移出群聊', group: true },
  { name: 'rename', args: '<群名>', desc: '修改群名称', group: true },
];

function sys(chat, text, extra) { addMessage(chat.id, { sender: 'system', text, ...extra }); }

function commandTargets(chat, args, { requireOne } = {}) {
  const pool = chat.type === 'dm' ? chat.members : chat.members;
  const mentioned = chat.type === 'dm' ? [] : parseMentions(args, chat);
  // 私聊里也允许 @ 其他 agent（比如在 Claude 私聊里 /login @codex）
  const any = [...args.matchAll(/@([\w-]+)/g)].map((m) => m[1].toLowerCase()).filter((id) => getAgent(id));
  let ids = mentioned.length ? mentioned : any.length ? any : pool.length === 1 ? pool : [];
  if (requireOne && ids.length > 1) ids = ids.slice(0, 1);
  return ids.map(getAgent).filter(Boolean);
}
const stripMentions = (s) => s.replace(/@[\w一-龥-]+/g, '').trim();

async function onCommand(chat, text) {
  const m = text.match(/^\/([\w:-]+)\s*([\s\S]*)$/);
  if (!m) return onUserMessage(chat, text);
  const name = m[1].toLowerCase();
  const args = m[2].trim();
  const known = COMMANDS.find((c) => c.name === name);
  if (known) addMessage(chat.id, { sender: 'user', text, command: true });

  const needTarget = (verb) => {
    const ts = commandTargets(chat, args);
    if (!ts.length) { sys(chat, `请指定成员，例如 /${verb} @${chat.members[0] || 'claude'}`); return null; }
    return ts;
  };

  switch (name) {
    case 'help': {
      const lines = COMMANDS.filter((c) => !c.group || chat.type === 'group').map((c) => `\`/${c.name}${c.args ? ' ' + c.args : ''}\` — ${c.desc}`);
      sys(chat, `**可用命令**\n${lines.map((l) => '- ' + l).join('\n')}\n\n其他以 / 开头的命令会交给 AI 自己的 CLI 执行（如 Claude Code 的 /init、/review，或需要交互界面的 /config、/mcp 会自动在内置终端打开）。`, { markdown: true });
      return;
    }
    case 'login': case 'logout': {
      const ts = needTarget(name); if (!ts) return;
      for (const a of ts) {
        try {
          const t = openLogin(a, chat.id, name === 'logout');
          sys(chat, `已在内置终端打开 ${a.name} 的${name === 'login' ? '登录' : '退出登录'}流程${name === 'login' ? '，按终端提示操作（通常会打开浏览器授权）' : ''}`, { term: t.id });
        } catch (e) { sys(chat, `⚠ ${e.message}`); }
      }
      return;
    }
    case 'use': {
      const ts = needTarget('use 厂商名'); if (!ts) return;
      const q = stripMentions(args).toLowerCase();
      if (!q) {
        const list = db.providers.map((p) => `「${p.name}」`).join('、') || '（还没有添加厂商）';
        sys(chat, `用法：/use official 或 /use <厂商名>。已添加的厂商：${list}`);
        return;
      }
      for (const a of ts) {
        const cfg = agentCfg(a.id);
        if (['official', '官方', '官方登录', 'default'].includes(q)) {
          cfg.mode = 'official';
          sys(chat, `${a.name} 已切换到 ${a.officialLabel || '官方登录'}`);
          continue;
        }
        const p = db.providers.find((x) => x.id === q || x.name.toLowerCase() === q) || db.providers.find((x) => x.name.toLowerCase().includes(q) || (x.preset || '').includes(q));
        if (!p) { sys(chat, `没有找到厂商「${q}」，先到「模型厂商」页面添加`, { actions: [{ label: '去添加', goto: 'providers' }] }); return; }
        if (!supports(a, p)) { sys(chat, `${a.name} 需要 ${a.protocols.map((x) => PROTOCOLS[x]).join('/')} 地址，厂商「${p.name}」没有配置`); continue; }
        cfg.mode = 'provider'; cfg.providerId = p.id;
        if (cfg.model && p.models?.length && !p.models.includes(cfg.model)) cfg.model = '';
        sys(chat, `${a.name} 已切换到厂商「${p.name}」· 模型 ${cfg.model || p.models?.[0] || '默认'}`);
      }
      store.save(); broadcast('agents.changed', {});
      return;
    }
    case 'model': {
      const query = stripMentions(args);
      let ts = commandTargets(chat, args);
      // 群聊没 @ 人时，按模型名找能用它的成员（如 gpt → Codex，opus → Claude）
      if (!ts.length && query && chat.type === 'group') {
        const cat = await models.catalog();
        for (const id of chat.members) {
          const a = getAgent(id);
          if (a && !a.noModel && models.resolveModel(query, modelCandidates(a, cat)).match) { ts = [a]; break; }
        }
      }
      if (!ts.length) { sys(chat, `请指定成员，例如 /model ${query || 'opus'} @${chat.members[0] || 'claude'}`); return; }
      const cat = await models.catalog();
      for (const a of ts) {
        if (a.noModel) { sys(chat, `${a.name} 不支持在 Noe 里切换模型`); continue; }
        const cands = modelCandidates(a, cat);
        if (!query) {
          sys(chat, `**${a.name}** 当前：${authLabel(a)}\n\n可选：${cands.slice(0, 12).map((m) => `\`${m.id}\``).join('、') || '（自定义输入）'}`, { markdown: true });
          continue;
        }
        if (['default', '默认'].includes(query.toLowerCase())) { agentCfg(a.id).model = ''; sys(chat, `${a.name} 已恢复默认模型`); continue; }
        const { match, others } = models.resolveModel(query, cands);
        const id = match ? match.id : query.replace(/\s+/g, '-');
        agentCfg(a.id).model = id;
        const more = others.length ? `（其他相近的：${others.map((m) => m.id).join('、')}）` : '';
        sys(chat, match ? `${a.name} 已切换到 ${match.name || match.id}（${match.id}）${more}` : `${a.name} 的目录里没有「${query}」，已按原样使用模型 ${id}`);
      }
      store.save(); broadcast('agents.changed', {});
      return;
    }
    case 'effort': {
      const ts = needTarget('effort high'); if (!ts) return;
      const v = stripMentions(args).toLowerCase();
      const map = { 低: 'low', 中: 'medium', 高: 'high', 超高: 'xhigh', 最大: 'max', 默认: '' };
      const level = map[v] ?? v;
      for (const a of ts) {
        if (!['claude', 'codex'].includes(a.id)) { sys(chat, `${a.name} 不支持设置思考强度`); continue; }
        if (!v) { sys(chat, `${a.name} 当前思考强度：${models.EFFORT_LABEL[agentCfg(a.id).effort] || '默认'}`); continue; }
        if (level && level !== 'default' && !models.EFFORT_LABEL[level]) { sys(chat, '可选：low / medium / high / xhigh / max / default'); return; }
        agentCfg(a.id).effort = level === 'default' ? '' : level;
        sys(chat, `${a.name} 的思考强度已设为 ${models.EFFORT_LABEL[agentCfg(a.id).effort] || '默认'}`);
      }
      store.save(); broadcast('agents.changed', {});
      return;
    }
    case 'status': {
      const ts = chat.members.map(getAgent).filter(Boolean);
      await Promise.all(ts.map(checkStatus));
      const rows = ts.map((a) => {
        const st = statusCache[a.id]; const au = authCache[a.id];
        const inst = st?.installed ? `v${st.version || '?'}` : '未安装';
        const login = au ? (au.loggedIn ? `已登录（${au.detail}）` : '未登录') : '—';
        return `| ${a.name} | ${inst} | ${login} | ${authLabel(a)} |`;
      });
      sys(chat, `| 成员 | 版本 | 官方账号 | 当前使用 |\n|---|---|---|---|\n${rows.join('\n')}\n\n工作目录：\`${chatCwd(chat)}\``, { markdown: true });
      broadcast('agents.changed', {});
      return;
    }
    case 'terminal': {
      const ts = commandTargets(chat, args, { requireOne: true });
      if (!ts.length) { sys(chat, `请指定成员，例如 /terminal @${chat.members[0] || 'claude'}`); return; }
      try { const t = openAgentTerminal(ts[0], chat); sys(chat, `已打开 ${ts[0].name} 的交互式终端${chat.sessions?.[ts[0].id] ? '（续接当前会话）' : ''}`, { term: t.id }); }
      catch (e) { sys(chat, `⚠ ${e.message}`); }
      return;
    }
    case 'shell': { const t = openShell(chat); sys(chat, '已在工作目录打开终端', { term: t.id }); return; }
    case 'new': { stopChat(chat.id); chat.sessions = {}; store.save(); sys(chat, '已开启新会话，AI 不会再记得之前的上下文'); return; }
    case 'clear': { stopChat(chat.id); db.messages[chat.id] = []; chat.sessions = {}; store.save(); broadcast('chats.changed', {}); return; }
    case 'stop': { stopChat(chat.id); return; }
    case 'cwd': {
      if (args) {
        const dir = args.replace(/^~(?=$|\/)/, os.homedir());
        chat.cwd = path.resolve(dir); chat.cwdChosen = true; chat.sessions = {}; fs.mkdirSync(chat.cwd, { recursive: true }); rememberDir(chat.cwd); store.save(); broadcast('chats.changed', {});
        sys(chat, `工作目录已改为 \`${chatCwd(chat)}\`（AI 会话已重置）`, { markdown: true });
      } else sys(chat, `工作目录：\`${chatCwd(chat)}\``, { markdown: true });
      return;
    }
    case 'invite': case 'kick': {
      if (chat.type !== 'group') { sys(chat, '这个命令只能在群聊中使用'); return; }
      const ids = [...args.matchAll(/@([\w-]+)/g)].map((x) => x[1].toLowerCase()).filter((id) => getAgent(id));
      if (!ids.length) { sys(chat, `用法：/${name} @成员`); return; }
      setMembers(chat, name === 'invite' ? [...chat.members, ...ids] : chat.members.filter((x) => !ids.includes(x)));
      return;
    }
    case 'rename': {
      if (chat.type !== 'group' || !args) { sys(chat, '用法：/rename 新群名（仅群聊）'); return; }
      chat.name = args; store.save(); broadcast('chats.changed', {});
      sys(chat, `群名称已改为「${args}」`);
      return;
    }
  }

  // 不是 Noe 的命令：交给 AI 自己的 CLI
  addMessage(chat.id, { sender: 'user', text, command: true });
  const ts = commandTargets(chat, args, { requireOne: true });
  if (!ts.length) { sys(chat, `不认识的命令 /${name}。在群里请指定交给谁执行，例如 /${name} @claude；输入 /help 查看 Noe 的命令。`); return; }
  const agent = ts[0];
  const cliText = `/${name}${stripMentions(args) ? ' ' + stripMentions(args) : ''}`;
  if (agent.slash === 'claude' && !CLAUDE_INTERACTIVE.has(name)) {
    const trigger = { id: uid(), text: cliText, sender: 'user' };
    await dispatch(chat, agent.id, trigger, 0, { raw: true });
    return;
  }
  try {
    const t = agent.slash === 'claude' ? openAgentTerminal(agent, chat, { initial: cliText }) : openAgentTerminal(agent, chat, { typeAfter: cliText });
    sys(chat, `${cliText} 需要 ${agent.name} 的交互界面，已在内置终端中打开`, { term: t.id });
  } catch (e) { sys(chat, `⚠ ${e.message}`); }
}

/** 某个 agent 当前 API 来源下可选的模型（厂商模式用厂商的模型列表） */
function modelCandidates(a, cat) {
  const p = activeProvider(a.id);
  if (p) return p.models.map((id) => ({ id, ...(models.KNOWN[id] || { name: id }) }));
  return cat.agents[a.id]?.models || [];
}

function setMembers(chat, members) {
  const added = members.filter((m) => !chat.members.includes(m) && getAgent(m));
  const removed = chat.members.filter((m) => !members.includes(m));
  chat.members = [...new Set(members)].filter(getAgent);
  if (added.length) addMessage(chat.id, { sender: 'system', text: `${added.map((m) => getAgent(m).name).join('、')} 加入了群聊` });
  if (removed.length) addMessage(chat.id, { sender: 'system', text: `${removed.map((m) => getAgent(m)?.name || m).join('、')} 被移出群聊` });
  store.save(); broadcast('chats.changed', {});
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      s += c;
      if (s.length > 10e6) { reject(httpErr(413, '请求内容过大')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
function httpErr(code, message) { return Object.assign(new Error(message), { code }); }

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

// 会话列表只需要最后一条消息的预览，不带执行步骤，减小 /api/state 的体积
function brief(m) {
  if (!m) return null;
  const { steps, changes, ...rest } = m;
  return { ...rest, text: clipText(m.text || '', 300) };
}

route('GET', '/api/state', async () => ({
  agents: allAgents().map(publicAgent), settings: db.settings,
  providers: db.providers.map(publicProvider), presets: PRESETS, protocols: PROTOCOLS, commands: COMMANDS,
  terms: pty.list(), home: os.homedir(), version: VERSION,
  chats: db.chats.map((c) => ({ ...c, last: brief(msgs(c.id).at(-1)), count: msgs(c.id).length, busy: chatBusy(c.id) })),
}));

// agents
route('POST', '/api/agents/refresh', async () => { await Promise.all(allAgents().map(checkStatus)); broadcast('agents.changed', {}); return { ok: true }; });
route('POST', '/api/agents/:id/install', async ({ id }) => {
  const a = getAgent(id); const cmd = a && installCmd(a);
  if (!cmd) throw httpErr(400, '该工具没有安装命令');
  return { ok: runShell(id, cmd, statusCache[id]?.installed ? '更新' : '安装') };
});
route('POST', '/api/agents/:id/uninstall', async ({ id }) => {
  const a = getAgent(id); const cmd = a && uninstallCmd(a);
  if (!cmd) throw httpErr(400, '该工具没有卸载命令');
  return { ok: runShell(id, cmd, '卸载') };
});
route('POST', '/api/agents/:id/login', async ({ id }, b) => {
  const a = getAgent(id); if (!a) throw httpErr(404, 'agent 不存在');
  return { term: openLogin(a, b.chatId || null, !!b.logout).id };
});
route('POST', '/api/agents/:id/terminal', async ({ id }, b) => {
  const a = getAgent(id); if (!a) throw httpErr(404, 'agent 不存在');
  return { term: openAgentTerminal(a, b.chatId ? getChat(b.chatId) : null).id };
});
route('PUT', '/api/agents/:id/config', async ({ id }, b) => {
  const a = getAgent(id); if (!a) throw httpErr(404, 'agent 不存在');
  const cfg = agentCfg(id);
  if (b.mode === 'official' || b.mode === 'provider') cfg.mode = b.mode;
  if (b.providerId !== undefined) {
    const p = getProvider(b.providerId);
    if (b.providerId && !p) throw httpErr(400, '厂商不存在');
    if (p && !supports(a, p)) throw httpErr(400, `${a.name} 需要 ${a.protocols.map((x) => PROTOCOLS[x]).join('/')} 地址，该厂商没有配置`);
    cfg.providerId = b.providerId;
  }
  if (cfg.mode === 'provider' && !getProvider(cfg.providerId)) throw httpErr(400, '请选择一个厂商');
  if (b.model !== undefined) cfg.model = String(b.model).trim();
  if (b.effort !== undefined) cfg.effort = models.EFFORT_LABEL[b.effort] ? b.effort : '';
  if (b.extraEnv !== undefined) cfg.extraEnv = b.extraEnv;
  store.save();
  broadcast('agents.changed', {});
  return publicAgent(a);
});
route('POST', '/api/agents/custom', async (_, b) => {
  if (!b.name || !b.bin) throw httpErr(400, '名称和命令必填');
  const id = (b.id || b.name).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'agent' + uid().slice(0, 4);
  if (getAgent(id) && !db.customAgents.some((c) => c.id === id)) throw httpErr(400, `ID ${id} 已被占用`);
  db.customAgents = db.customAgents.filter((c) => c.id !== id);
  db.customAgents.push({ id, name: b.name, bin: b.bin, argsTemplate: b.argsTemplate || '{prompt}', installCmd: b.installCmd || '', color: b.color });
  store.save();
  await checkStatus(getAgent(id));
  broadcast('agents.changed', {});
  return { id };
});
route('DELETE', '/api/agents/custom/:id', async ({ id }) => {
  db.customAgents = db.customAgents.filter((c) => c.id !== id);
  store.save(); broadcast('agents.changed', {});
  return { ok: true };
});

// providers
function normalizeProvider(b, old = {}) {
  const urls = {};
  for (const k of Object.keys(PROTOCOLS)) { const v = (b.urls?.[k] ?? old.urls?.[k] ?? '').trim(); if (v) urls[k] = v; }
  const models = (Array.isArray(b.models) ? b.models : String(b.models ?? '').split(/[\n,，]/)).map((s) => String(s).trim()).filter(Boolean);
  const key = b.apiKey === undefined || String(b.apiKey).includes('••••') ? old.apiKey || '' : String(b.apiKey).trim();
  return {
    id: old.id || 'p-' + uid(), preset: b.preset ?? old.preset ?? 'custom', name: String(b.name ?? old.name ?? '').trim() || '未命名厂商',
    color: b.color || old.color || '#64748b', apiKey: key, urls, models: [...new Set(models)], smallModel: String(b.smallModel ?? old.smallModel ?? '').trim(),
    note: String(b.note ?? old.note ?? ''), createdAt: old.createdAt || Date.now(),
  };
}
route('POST', '/api/providers', async (_, b) => {
  const p = normalizeProvider(b);
  db.providers.push(p); store.save(); broadcast('agents.changed', {});
  return publicProvider(p);
});
route('PUT', '/api/providers/:id', async ({ id }, b) => {
  const i = db.providers.findIndex((p) => p.id === id); if (i < 0) throw httpErr(404, '厂商不存在');
  db.providers[i] = normalizeProvider(b, db.providers[i]); store.save(); broadcast('agents.changed', {});
  return publicProvider(db.providers[i]);
});
route('DELETE', '/api/providers/:id', async ({ id }) => {
  db.providers = db.providers.filter((p) => p.id !== id);
  for (const cfg of Object.values(db.agentConfig)) if (cfg.providerId === id) { cfg.providerId = ''; cfg.mode = 'official'; }
  store.save(); broadcast('agents.changed', {});
  return { ok: true };
});
route('POST', '/api/providers/:id/sync-preset', async ({ id }) => {
  const p = getProvider(id); if (!p) throw httpErr(404, '厂商不存在');
  const pr = PRESETS.find((x) => x.preset === p.preset);
  if (!pr || !pr.models.length) throw httpErr(400, '这个厂商没有预设模型');
  const added = pr.models.filter((m) => !p.models.includes(m));
  p.models = [...pr.models, ...p.models.filter((m) => !pr.models.includes(m))];
  store.save(); broadcast('agents.changed', {});
  return { added, provider: publicProvider(p) };
});
route('GET', '/api/models', async () => models.catalog());
route('POST', '/api/providers/:id/test', async ({ id }, b) => {
  const p = getProvider(id); if (!p) throw httpErr(404, '厂商不存在');
  return { results: await testProvider(p, b.model) };
});
route('POST', '/api/providers/:id/models', async ({ id }) => {
  const p = getProvider(id); if (!p) throw httpErr(404, '厂商不存在');
  try { return { models: await listModels(p) }; } catch (e) { throw httpErr(400, e.message); }
});

// settings
route('PUT', '/api/settings', async (_, b) => {
  const num = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
  if (b.workspace !== undefined) {
    // 空值或相对路径会让工作目录落到 App 自己的目录里，统一转成绝对路径
    const ws = expandHome(b.workspace);
    db.settings.workspace = ws ? path.resolve(os.homedir(), ws) : store.defaults().settings.workspace;
  }
  if (b.maxChain !== undefined) db.settings.maxChain = num(b.maxChain, 0, 10, 3);
  if (b.historyLimit !== undefined) db.settings.historyLimit = num(b.historyLimit, 0, 100, 20);
  for (const k of ['autoApprove', 'notify', 'askCwd', 'snapshots']) if (b[k] !== undefined) db.settings[k] = !!b[k];
  store.save(); return db.settings;
});

// chats
route('POST', '/api/chats', async (_, b) => {
  const cwd = b.cwd ? path.resolve(expandHome(b.cwd)) : '';
  if (cwd) { fs.mkdirSync(cwd, { recursive: true }); rememberDir(cwd); }
  const chat = { id: 'g-' + uid(), type: 'group', name: b.name || '新群聊', members: [...new Set(b.members || [])].filter(getAgent), cwd, cwdChosen: !!cwd, sessions: {}, createdAt: Date.now() };
  db.chats.push(chat); store.save(); broadcast('chats.changed', {});
  addMessage(chat.id, { sender: 'system', text: `群聊已创建。成员：${chat.members.map((id) => '@' + id).join(' ') || '暂无，把左侧的 AI 拖进来吧'}` });
  return chat;
});
route('GET', '/api/chats/:id', async ({ id }) => {
  const chat = getChat(id); if (!chat) throw httpErr(404, '会话不存在');
  return { chat: { ...chat, cwdResolved: chatCwd(chat) }, messages: msgs(id) };
});
route('PATCH', '/api/chats/:id', async ({ id }, b) => {
  const chat = getChat(id); if (!chat) throw httpErr(404, '会话不存在');
  if (b.name !== undefined && chat.type === 'group') chat.name = b.name;
  if (b.pinned !== undefined) chat.pinned = !!b.pinned;
  if (b.cwd !== undefined) {
    const dir = b.cwd ? path.resolve(expandHome(b.cwd)) : '';
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (dir !== chat.cwd) { chat.cwd = dir; chat.sessions = {}; }
    chat.cwdChosen = true;
    if (dir) rememberDir(dir);
  }
  if (Array.isArray(b.members) && chat.type === 'group') return setMembers(chat, b.members), chat;
  store.save(); broadcast('chats.changed', {});
  return chat;
});
route('DELETE', '/api/chats/:id', async ({ id }) => {
  stopChat(id);
  db.chats = db.chats.filter((c) => c.id !== id); delete db.messages[id];
  store.save(); broadcast('chats.changed', {});
  return { ok: true };
});
route('POST', '/api/chats/:id/messages', async ({ id }, b) => {
  const chat = getChat(id); if (!chat) throw httpErr(404, '会话不存在');
  const text = String(b.text || '').trim(); if (!text) throw httpErr(400, '消息为空');
  (text.startsWith('/') ? onCommand(chat, text) : onUserMessage(chat, text)).catch((e) => { console.error(e); sys(chat, '⚠ ' + e.message); });
  return { ok: true };
});
route('POST', '/api/chats/:id/retry', async ({ id }, b) => {
  const chat = getChat(id); if (!chat) throw httpErr(404, '会话不存在');
  const m = msgs(id).find((x) => x.id === b.messageId);
  const trigger = m && msgs(id).find((x) => x.id === m.replyTo);
  if (!m || !trigger) throw httpErr(400, '找不到要重试的消息');
  dispatch(chat, m.sender, trigger, 0).catch((e) => console.error(e));
  return { ok: true };
});
route('DELETE', '/api/chats/:id/messages/:mid', async ({ id, mid }) => {
  db.messages[id] = msgs(id).filter((m) => m.id !== mid); store.save();
  broadcast('message.deleted', { chatId: id, id: mid });
  return { ok: true };
});
route('POST', '/api/chats/:id/stop', async ({ id }, b) => {
  if (b.messageId) return { ok: stopMessage(b.messageId) };
  stopChat(id); return { ok: true };
});
// ---------- 时光机：查看 / 撤销某条回复的文件改动 ----------
function changedMsg(chatId, mid) {
  const m = msgs(chatId).find((x) => x.id === mid);
  if (!m?.changes) throw httpErr(404, '这条消息没有记录文件改动');
  return m;
}
route('GET', '/api/chats/:id/messages/:mid/diff', async ({ id, mid }, _b, url) => {
  const { changes: c } = changedMsg(id, mid);
  try { return { diff: await snapshots.diff(c.cwd, c.base, c.head, url.searchParams.get('path') || '') }; }
  catch (e) { throw httpErr(410, '快照已不存在（可能被清理了）：' + e.message); }
});
route('POST', '/api/chats/:id/messages/:mid/revert', async ({ id, mid }, b) => {
  const m = changedMsg(id, mid);
  const c = m.changes;
  const undo = !b.redo;
  if (undo === !!c.reverted) return { ok: true };
  const paths = c.files.map((f) => f.path);
  let r;
  try { r = await snapshots.restore(c.cwd, { target: undo ? c.base : c.head, expect: undo ? c.head : c.base, paths, force: !!b.force }); }
  catch (e) { throw httpErr(410, '恢复失败：' + e.message); }
  if (r.conflicts) return { conflicts: r.conflicts };
  c.reverted = undo;
  store.save();
  broadcast('message.update', m);
  return { ok: true };
});
route('POST', '/api/snapshots/clear', async () => {
  snapshots.clearAll();
  for (const list of Object.values(db.messages)) for (const m of list) if (m.changes) m.changes.expired = true;
  store.save(); broadcast('chats.changed', {});
  return { ok: true };
});

// 导出聊天记录为 Markdown
route('GET', '/api/chats/:id/export', async ({ id }) => {
  const chat = getChat(id); if (!chat) throw httpErr(404, '会话不存在');
  const ts = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });
  const lines = [`# ${chat.type === 'group' ? chat.name : getAgent(chat.members[0])?.name || chat.name}`, '',
    `- 导出时间：${ts(Date.now())}`, `- 工作目录：\`${chatCwd(chat)}\``,
    ...(chat.type === 'group' ? [`- 成员：${chat.members.map((m) => getAgent(m)?.name || m).join('、')}`] : []), ''];
  for (const m of msgs(id)) {
    if (m.status === 'streaming') continue;
    if (m.sender === 'system') { lines.push(`> ${String(m.text || '').replace(/\n/g, '\n> ')}`, ''); continue; }
    const meta = m.meta?.model ? ` · ${m.meta.model}` : '';
    lines.push(`## ${senderName(m)}${m.sender === 'user' ? '' : meta} · ${ts(m.ts)}`, '');
    if (m.text) lines.push(m.text, '');
    if (m.error) lines.push('```text', m.error, '```', '');
    if (m.changes) lines.push(`_改动了 ${m.changes.total} 个文件（+${m.changes.add} −${m.changes.del}）${m.changes.reverted ? '，已撤销' : ''}：${m.changes.files.slice(0, 20).map((f) => '`' + f.path + '`').join('、')}_`, '');
    if (m.status === 'stopped') lines.push('_（已停止）_', '');
  }
  return { name: `${(chat.type === 'group' ? chat.name : chat.members[0]).replace(/[\\/:*?"<>|]/g, '_')}-${new Date().toLocaleDateString('sv')}.md`, markdown: lines.join('\n') };
});
// 搜索所有会话里的消息
route('GET', '/api/search', async (_p, _b, url) => {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (!q) return { results: [] };
  const results = [];
  for (const chat of db.chats) {
    const list = msgs(chat.id);
    for (let i = list.length - 1; i >= 0 && results.length < 50; i--) {
      const m = list[i];
      const text = String(m.text || '');
      const at = text.toLowerCase().indexOf(q);
      if (at < 0 || m.sender === 'system') continue;
      const from = Math.max(0, at - 30);
      results.push({ chatId: chat.id, id: m.id, sender: m.sender, ts: m.ts, snippet: (from ? '…' : '') + text.slice(from, at + q.length + 60).replace(/\s+/g, ' ') });
    }
  }
  return { results: results.sort((a, b) => b.ts - a.ts).slice(0, 50) };
});
route('POST', '/api/chats/:id/open-folder', async ({ id }) => {
  const chat = getChat(id); if (!chat) throw httpErr(404, '会话不存在');
  spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [chatCwd(chat)]);
  return { ok: true };
});
// ---------- 目录选择与打开文件 ----------
function rememberDir(dir) {
  const list = (db.settings.recentDirs || []).filter((d) => d !== dir);
  db.settings.recentDirs = [dir, ...list].slice(0, 8);
  store.save();
}
const expandHome = (p) => String(p || '').trim().replace(/^~(?=$|\/)/, os.homedir());

route('POST', '/api/pick-folder', async (_, b) => {
  if (process.platform !== 'darwin') throw httpErr(400, '当前系统不支持原生选择框，请直接输入路径');
  const esc = (x) => String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const def = expandHome(b.defaultPath || '');
  const loc = def && fs.existsSync(def) ? ` default location (POSIX file "${esc(def)}")` : '';
  // 在当前最前面的应用里弹出，避免选择框藏在窗口后面
  const script = `tell application (path to frontmost application as text) to POSIX path of (choose folder with prompt "${esc(b.prompt || '选择工作目录')}"${loc})`;
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 10 * 60e3 }, (err, out) => {
      if (err) return resolve({ cancelled: true });
      const dir = out.trim().replace(/\/$/, '') || '/';
      rememberDir(dir);
      resolve({ path: dir });
    });
  });
});

// 打开 AI 回复里提到的文件 / 目录：相对路径按会话的工作目录解析，用系统默认程序打开
route('POST', '/api/open', async (_, b) => {
  let target = String(b.path || '').trim();
  if (/^https?:\/\//i.test(target)) { spawn('open', [target]); return { ok: true, path: target }; }
  target = decodeURIComponent(target.replace(/^file:\/\//i, '')).replace(/[#?].*$/, '');
  const chat = b.chatId ? getChat(b.chatId) : null;
  const base = chat ? chatCwd(chat) : os.homedir();
  const full = path.resolve(base, expandHome(target));
  if (!fs.existsSync(full)) throw httpErr(404, `找不到文件：${full.replace(os.homedir(), '~')}`);
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(opener, b.reveal && process.platform === 'darwin' ? ['-R', full] : [full], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true, path: full };
});

route('POST', '/api/chats/:id/shell', async ({ id }) => {
  const chat = getChat(id); if (!chat) throw httpErr(404, '会话不存在');
  return { term: openShell(chat).id };
});

// terminals
route('GET', '/api/terms/:id/buffer', async ({ id }) => {
  const t = pty.get(id); if (!t) throw httpErr(404, '终端不存在');
  return { buffer: t.buffer.slice(-200000), exited: t.exited };
});
route('POST', '/api/terms/:id/input', async ({ id }, b) => { pty.write(id, String(b.data || '')); return { ok: true }; });
route('POST', '/api/terms/:id/resize', async ({ id }, b) => { pty.resize(id, b.cols, b.rows); return { ok: true }; });
route('DELETE', '/api/terms/:id', async ({ id }) => { pty.close(id); return { ok: true }; });

// ---------- MCP 与插件 ----------
const installed = (id) => !!statusCache[id]?.installed;
const extCtx = () => ({
  workspace: db.settings.workspace,
  setEnv: (k, v) => { db.mcpEnv[k] = v; setGlobalEnv(db.mcpEnv); store.save(); },
});
function oauthHint(server, targets) {
  return server.auth === 'oauth' ? targets.filter((t) => ext.ADAPTERS[t]?.loginArgv) : [];
}
async function installMcp(server, targets) {
  const results = [];
  for (const id of targets) {
    const ad = ext.ADAPTERS[id];
    if (!ad) { results.push({ agent: id, ok: false, error: '该工具暂不支持 MCP' }); continue; }
    if (!installed(id)) { results.push({ agent: id, ok: false, error: '工具未安装' }); continue; }
    try { const notes = await ad.add(server.name, server, extCtx()); results.push({ agent: id, ok: true, notes: notes || [] }); }
    catch (e) { results.push({ agent: id, ok: false, error: e.message }); }
  }
  broadcast('ext.changed', { kind: 'mcp' });
  return results;
}

route('GET', '/api/ext/mcp', async () => ({
  catalog: CATALOG,
  agents: ext.mcpAgents().map((id) => ({ id, label: ext.ADAPTERS[id].label, configPath: ext.ADAPTERS[id].configPath, installed: installed(id), canLogin: !!ext.ADAPTERS[id].loginArgv })),
  configs: await ext.listAll(installed),
  tools: { node: !!which('npx'), uv: !!which('uvx') },
}));
route('POST', '/api/ext/mcp/install', async (_, b) => {
  const targets = (b.targets || []).filter((t) => ext.ADAPTERS[t]);
  if (!targets.length) throw httpErr(400, '请至少选择一个工具');
  let server, entry = null;
  if (b.catalogId) {
    entry = CATALOG.find((c) => c.id === b.catalogId);
    if (!entry) throw httpErr(404, '目录中没有这个 MCP');
    try { server = { name: (b.name || entry.id).trim(), ...ext.fillTemplate(entry, b.values || {}, extCtx()), auth: entry.auth }; }
    catch (e) { throw httpErr(400, e.message); }
  } else {
    try { server = ext.normalize(b.server || {}); } catch (e) { throw httpErr(400, e.message); }
  }
  const results = await installMcp(server, targets);
  return { results, oauth: entry ? oauthHint(entry, results.filter((r) => r.ok).map((r) => r.agent)) : [] };
});
route('POST', '/api/ext/mcp/import', async (_, b) => {
  try { return { servers: ext.parseImport(b.text) }; } catch (e) { throw httpErr(400, e.message); }
});
route('POST', '/api/ext/mcp/remove', async (_, b) => {
  const results = [];
  for (const id of b.agents || []) {
    try { await ext.ADAPTERS[id].remove(b.name); results.push({ agent: id, ok: true }); }
    catch (e) { results.push({ agent: id, ok: false, error: e.message }); }
  }
  broadcast('ext.changed', { kind: 'mcp' });
  return { results };
});
route('POST', '/api/ext/mcp/login', async (_, b) => {
  const ad = ext.ADAPTERS[b.agent];
  if (!ad?.loginArgv) throw httpErr(400, '该工具不支持命令行授权，请在它的交互界面里用 /mcp 授权');
  const t = pty.open({ argv: ad.loginArgv(b.name), env: baseEnv(), cwd: os.homedir(), agentId: b.agent, kind: 'login', title: `${ad.label} · 授权 ${b.name}` });
  return { term: t.id };
});

// 插件列表获取较慢，做 30 秒缓存
const pluginCache = {};
async function cached(key, fn, fresh) {
  const c = pluginCache[key];
  if (!fresh && c && Date.now() - c.t < 30000) return c.v;
  const v = await fn();
  pluginCache[key] = { t: Date.now(), v };
  return v;
}
route('GET', '/api/ext/plugins', async () => ({
  agents: { claude: installed('claude'), codex: installed('codex'), gemini: installed('gemini') },
  claudeMarkets: CLAUDE_MARKETPLACES, geminiRecommended: GEMINI_EXTENSIONS,
}));
route('GET', '/api/ext/plugins/:agent', async ({ agent }, _b, url) => {
  const fresh = url.searchParams.has('fresh');
  if (!installed(agent)) throw httpErr(400, '工具未安装');
  if (agent === 'claude') return cached('claude', ext.claudePlugins, fresh);
  if (agent === 'codex') return cached('codex', ext.codexPlugins, fresh);
  if (agent === 'gemini') return { installed: ext.geminiExtensions() };
  throw httpErr(400, '该工具暂不支持插件');
});
route('POST', '/api/ext/plugins/:agent', async ({ agent }, b) => {
  const A = {
    claude: {
      install: (x) => ['claude', 'plugin', 'install', x, '-s', 'user'],
      uninstall: (x) => ['claude', 'plugin', 'uninstall', x],
      enable: (x) => ['claude', 'plugin', 'enable', x],
      disable: (x) => ['claude', 'plugin', 'disable', x],
      update: (x) => ['claude', 'plugin', 'update', x],
      'market-add': (x) => ['claude', 'plugin', 'marketplace', 'add', x],
      'market-remove': (x) => ['claude', 'plugin', 'marketplace', 'remove', x],
      'market-update': () => ['claude', 'plugin', 'marketplace', 'update'],
    },
    codex: {
      install: (x) => ['codex', 'plugin', 'add', x],
      uninstall: (x) => ['codex', 'plugin', 'remove', x],
    },
    gemini: {
      install: (x) => ['gemini', 'extensions', 'install', x, '--consent', '--skip-settings'],
      uninstall: (x) => ['gemini', 'extensions', 'uninstall', x],
      update: (x) => ['gemini', 'extensions', 'update', x],
      enable: (x) => ['gemini', 'extensions', 'enable', x],
      disable: (x) => ['gemini', 'extensions', 'disable', x],
    },
  }[agent];
  const make = A?.[b.action];
  if (!make) throw httpErr(400, '不支持的操作');
  if (!installed(agent)) throw httpErr(400, '工具未安装');
  const target = String(b.target || '').trim();
  if (!target && !b.action.endsWith('update')) throw httpErr(400, '缺少目标');
  const r = await ext.run(make(target), { timeout: 300000 });
  delete pluginCache[agent];
  broadcast('ext.changed', { kind: 'plugins', agent });
  if (r.code !== 0) throw httpErr(400, r.out.split('\n').slice(-8).join('\n') || `退出码 ${r.code}`);
  return { ok: true, out: r.out.split('\n').slice(-6).join('\n') };
});
route('POST', '/api/ext/plugins/:agent/configure', async ({ agent }, b) => {
  if (agent !== 'gemini') throw httpErr(400, '不支持');
  const t = pty.open({ argv: ['gemini', 'extensions', 'config', String(b.target)], env: baseEnv(), cwd: os.homedir(), agentId: agent, kind: 'cli', title: `Gemini · 配置扩展 ${b.target}` });
  return { term: t.id };
});

// 只接受来自本机页面的请求：
// - Host 必须是 127.0.0.1 / localhost（防 DNS 重绑定）
// - 带 Origin 的请求必须同源；写操作必须是 application/json（浏览器跨站发不出这种“简单请求”，会被预检拦下）
// 否则任意网页都能悄悄调用本地接口，让 AI 执行命令或安装自定义 CLI。
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
function trusted(req) {
  const host = req.headers.host || '';
  if (!LOCAL_HOST.test(host)) return false;
  const origin = req.headers.origin;
  if (origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//i, ''))) return false;
  if (!['GET', 'HEAD'].includes(req.method) && !/^application\/json/i.test(req.headers['content-type'] || '')) return false;
  return true;
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  if (url.pathname.startsWith('/api/') && !trusted(req)) return send(res, 403, { error: 'forbidden' });
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': hi\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    for (const r of routes) {
      const m = r.method === req.method && url.pathname.match(r.re);
      if (!m) continue;
      try {
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        return send(res, 200, await r.fn(Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)])), body, url));
      } catch (e) {
        return send(res, typeof e.code === 'number' ? e.code : 500, { error: e.message });
      }
    }
    return send(res, 404, { error: 'not found' });
  }
  if (!LOCAL_HOST.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
  let rel;
  try { rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

function start(port = Number(process.env.PORT) || 17860) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      console.log(`Noe Agent 已启动：http://127.0.0.1:${actual}`);
      Promise.all(allAgents().map(checkStatus)).then(() => broadcast('agents.changed', {}));
      resolve(actual);
    });
  });
}

function shutdown() {
  for (const r of running.values()) try { r.proc?.kill('SIGTERM'); } catch { /* 已退出 */ }
  pty.closeAll();
  store.flush();
}
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

module.exports = { start, shutdown };
if (require.main === module) start();
