// AI 擂台：同一个任务同时交给多个 AI，每个 AI 在自己的项目副本（沙盒）里干活，互不干扰。
// 用户对比回答、文件改动、耗时和花费（默认盲评，看不到是谁写的），选出胜者后，
// 胜者的改动合并回真正的工作目录，并作为一条普通回复进入对话（带时光机卡片，可一键撤销）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runAgent } = require('./agents');
const snapshots = require('./snapshots');
const { t, join } = require('./i18n');

const ROOT = path.join(os.tmpdir(), 'noe-arena');
// 依赖和构建产物不复制：太大，而且 AI 需要时可以自己装
const SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', '.nuxt', 'dist', 'build', 'target', '.gradle', 'Pods', 'DerivedData', '.cache', '.DS_Store']);
const MAX_FILES = 20000;
const MAX_MB = 300;
const LABELS = 'ABCDEFGH';
const KEEP_DAYS = 3;

// 清理几天前的沙盒（改动已经存在快照里，查看差异和采用都不依赖沙盒本身）
try {
  for (const d of fs.readdirSync(ROOT)) {
    const full = path.join(ROOT, d);
    if (Date.now() - fs.statSync(full).mtimeMs > KEEP_DAYS * 864e5) fs.rmSync(full, { recursive: true, force: true });
  }
} catch { /* 目录不存在 */ }

async function copyProject(src, dest) {
  let files = 0, bytes = 0, over = false;
  await fs.promises.mkdir(dest, { recursive: true });
  await fs.promises.cp(src, dest, {
    recursive: true, force: true, errorOnExist: false, verbatimSymlinks: true,
    filter: async (s) => {
      if (over) return false;
      if (s !== src && SKIP.has(path.basename(s))) return false;
      const st = await fs.promises.lstat(s).catch(() => null);
      if (!st) return false;
      if (st.isFile()) {
        files++; bytes += st.size;
        if (files > MAX_FILES || bytes > MAX_MB * 1048576) { over = true; return false; }
      }
      return st.isFile() || st.isDirectory() || st.isSymbolicLink();
    },
  });
  if (over) throw new Error(t('工作目录太大（超过 {files} 个文件或 {mb} MB，不含 node_modules 等依赖目录），没法给每位选手复制一份', { files: MAX_FILES, mb: MAX_MB }));
}

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const summary = (files) => ({ files: files.slice(0, 500), total: files.length, add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) });

/**
 * ctx 由 index.js 注入：db、store、broadcast、addMessage、msgs、getAgent、agentCfg、activeProvider、chatCwd、running、chatBusy、senderName、clipText
 */
function createArena(ctx) {
  const { db, store, broadcast, addMessage, msgs, getAgent, agentCfg, activeProvider, chatCwd, running, chatBusy } = ctx;
  const alive = (chatId, m) => msgs(chatId).includes(m);

  // 流式输出时合并推送，避免每个字都把整张卡片发一遍
  const timers = new Map();
  function push(m, now) {
    if (!alive(m.chatId, m)) return;
    if (now) { clearTimeout(timers.get(m.id)); timers.delete(m.id); store.save(); return broadcast('message.update', m); }
    if (timers.has(m.id)) return;
    timers.set(m.id, setTimeout(() => { timers.delete(m.id); if (alive(m.chatId, m)) broadcast('message.update', m); }, 300));
  }

  function prompt(chat, task) {
    const hist = msgs(chat.id).filter((m) => m.status !== 'streaming' && m.text && m.sender !== 'system' && !m.command).slice(-8);
    return [
      t('你正在参加一场「AI 擂台」：几个 AI 助手在各自独立的项目副本里同时完成同一个任务，用户会比较所有方案，选出最好的一个合并到真正的项目里。'),
      t('当前目录就是你专属的项目副本，可以放心直接修改文件、运行命令。node_modules 等依赖目录没有复制，需要的话请自行安装。'),
      hist.length ? '\n' + t('最近的对话（供参考）：') + '\n' + hist.map((m) => `[${ctx.senderName(m)}]: ${ctx.clipText(m.text, 1500)}`).join('\n') : '',
      '\n---\n' + t('任务：') + '\n' + task,
      '\n' + t('请拿出你最好的方案。完成后用简洁的几句话总结你做了什么、为什么这样做；提到文件时使用相对路径。'),
    ].join('\n');
  }

  async function runEntry(chat, m, e, src) {
    const key = `${m.id}:${e.agent}`;
    const agent = getAgent(e.agent);
    const stopped = () => !running.has(key);
    const end = (status, error) => { running.delete(key); e.status = status; if (error) e.error = error; push(m); };
    if (!agent) return end('error', t('这个 AI 已经不存在了'));
    const dir = path.join(ROOT, m.id, e.agent);
    try { await copyProject(src, dir); } catch (err) { return end('error', err.message); }
    e.dir = dir;
    if (stopped()) return end('stopped');
    const base = await snapshots.take(dir, `arena base ${e.agent}`);
    if (stopped()) return end('stopped');
    e.status = 'running'; e.startedAt = Date.now(); push(m);

    const { proc, done } = runAgent(agent, {
      prompt: prompt(chat, m.arena.task), cwd: dir, sessionId: null, cfg: agentCfg(agent.id), provider: activeProvider(agent.id), settings: db.settings,
      onEvent: (ev) => {
        if (ev.type === 'text') { e.text += ev.delta; push(m); }
        else if (ev.type === 'step') { e.steps++; e.lastStep = ev.step.title; push(m); }
      },
    });
    running.set(key, { proc, chatId: chat.id, arena: m.id });
    const r = await done;
    const wasStopped = stopped() || r.stopped;
    running.delete(key);
    e.text = (r.text || e.text || '').trim();
    e.meta = r.meta;
    e.status = wasStopped ? 'stopped' : r.error ? 'error' : 'done';
    if (r.error && !wasStopped && r.error.trim() !== e.text) e.error = r.error;
    if (base) {
      const head = await snapshots.take(dir, `arena head ${e.agent}`);
      if (head && head !== base) {
        try {
          const files = await snapshots.changes(dir, base, head);
          if (files.length) e.changes = { cwd: dir, base, head, ...summary(files) };
        } catch (err) { console.error('[arena]', err.message); }
      }
    }
    push(m);
  }

  /** 开一场擂台。agents：参赛的 agent 对象（至少 2 个） */
  async function start(chat, agents, task, { blind = true } = {}) {
    const order = shuffle(agents);
    const m = addMessage(chat.id, {
      sender: 'system', kind: 'arena', status: 'streaming',
      text: `⚔ ${t('AI 擂台')}：${task}`,
      arena: {
        task, blind, revealed: !blind, winner: null, git: snapshots.available(),
        entries: order.map((a, i) => ({ agent: a.id, label: LABELS[i], status: 'preparing', text: '', steps: 0, lastStep: '', meta: null, changes: null, error: '' })),
      },
    });
    for (const e of m.arena.entries) running.set(`${m.id}:${e.agent}`, { proc: null, chatId: chat.id, arena: m.id });
    broadcast('chats.busy', { chatId: chat.id, busy: true });
    const src = chatCwd(chat);
    await Promise.all(m.arena.entries.map((e) => runEntry(chat, m, e, src).catch((err) => { running.delete(`${m.id}:${e.agent}`); e.status = 'error'; e.error = err.message; })));
    m.status = 'done';
    push(m, true);
    broadcast('chats.busy', { chatId: chat.id, busy: chatBusy(chat.id) });
    return m;
  }

  function find(chatId, mid) {
    const m = msgs(chatId).find((x) => x.id === mid && x.kind === 'arena');
    if (!m) throw Object.assign(new Error(t('找不到这场擂台')), { code: 404 });
    return m;
  }
  function entry(m, agentId) {
    const e = m.arena.entries.find((x) => x.agent === agentId);
    if (!e) throw Object.assign(new Error(t('这位选手不在擂台上')), { code: 404 });
    return e;
  }

  function reveal(chatId, mid) {
    const m = find(chatId, mid);
    m.arena.revealed = true;
    push(m, true);
    return m;
  }

  /** 选出胜者：把它的改动合并回工作目录，回答作为一条正常回复进入对话 */
  async function adopt(chat, mid, agentId) {
    const m = find(chat.id, mid);
    const e = entry(m, agentId);
    if (m.arena.winner) throw Object.assign(new Error(t('这场擂台已经选出胜者了')), { code: 400 });
    if (['preparing', 'running'].includes(e.status)) throw Object.assign(new Error(t('这位选手还没完成')), { code: 400 });
    const cwd = chatCwd(chat);
    let changes = null;
    if (e.changes) {
      // 时光机：合并前后各拍一次快照，采用之后也能一键撤销
      const useSnap = db.settings.snapshots !== false;
      const before = useSnap ? await snapshots.take(cwd, `before arena ${m.id}`) : null;
      const files = await snapshots.changes(e.changes.cwd, e.changes.base, e.changes.head);
      await snapshots.exportFiles(e.changes.cwd, e.changes.head, files, cwd);
      const after = before ? await snapshots.take(cwd, `after arena ${m.id}`) : null;
      if (before && after && after !== before) {
        const real = await snapshots.changes(cwd, before, after);
        if (real.length) changes = { cwd, base: before, head: after, ...summary(real) };
      }
    }
    m.arena.winner = agentId;
    m.arena.revealed = true;
    const stats = (db.arenaStats ||= {});
    for (const x of m.arena.entries) {
      const s = (stats[x.agent] ||= { wins: 0, played: 0 });
      s.played++;
      if (x.agent === agentId) s.wins++;
    }
    push(m, true);
    addMessage(chat.id, { sender: agentId, text: e.text, meta: e.meta || {}, arenaWin: m.id, ...(changes ? { changes } : {}) });
    broadcast('arena.stats', stats);
    return { ok: true, files: changes?.total || 0 };
  }

  async function diff(chatId, mid, agentId, file) {
    const e = entry(find(chatId, mid), agentId);
    if (!e.changes) throw Object.assign(new Error(t('这位选手没有改动文件')), { code: 404 });
    return snapshots.diff(e.changes.cwd, e.changes.base, e.changes.head, file);
  }

  function dir(chatId, mid, agentId) {
    const e = entry(find(chatId, mid), agentId);
    if (!e.dir || !fs.existsSync(e.dir)) throw Object.assign(new Error(t('项目副本已被清理（只保留 {n} 天）', { n: KEEP_DAYS })), { code: 410 });
    return e.dir;
  }

  /** /arena 不带任务时显示的排行榜 */
  function leaderboard() {
    const rows = Object.entries(db.arenaStats || {})
      .map(([id, s]) => ({ id, name: getAgent(id)?.name || id, ...s, rate: s.played ? s.wins / s.played : 0 }))
      .sort((a, b) => b.wins - a.wins || b.rate - a.rate);
    if (!rows.length) return '';
    const medal = ['🥇', '🥈', '🥉'];
    return `| | ${t('选手')} | ${t('胜')} | ${t('场')} | ${t('胜率')} |\n|---|---|---|---|---|\n`
      + rows.map((r, i) => `| ${medal[i] || i + 1} | ${r.name} | ${r.wins} | ${r.played} | ${Math.round(r.rate * 100)}% |`).join('\n');
  }

  return { start, reveal, adopt, diff, dir, leaderboard, names: (list) => join(list.map((a) => a.name)) };
}

module.exports = { createArena };
