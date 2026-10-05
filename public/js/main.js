// 入口：加载状态、实时事件、视图切换、全局快捷键
import { $, $$, S, api, toast, on, emit, agentById, closeMenu } from './core.js';
import {
  renderSidebar, openChat, closeChat, renderChatShell, renderChatHead, renderMessages, patchMessage, schedulePatch,
  sendText, sourceMenu, openNewGroup, createTemplateGroup, setupDnD, quickSwitch,
} from './chat.js';
import { renderTools, renderProviders, renderSettings, bindPages } from './pages.js';
import { renderExtensions, bindExtensions, onExtChanged, invalidateExt } from './extensions.js';
import { initTerminals, onTermOpen, onTermData, onTermExit, onTermClosed, focus as focusTerm, toggle as toggleTerm, retheme } from './terminal.js';

// ---------- 主题 ----------
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  let t = 'system';
  try { t = localStorage.getItem('noe.theme') || 'system'; } catch { /* 忽略 */ }
  document.documentElement.dataset.theme = t === 'system' ? (mq.matches ? 'dark' : 'light') : t;
  retheme?.();
}
mq.addEventListener('change', applyTheme);
applyTheme();
if (new URLSearchParams(location.search).has('app')) document.documentElement.classList.add('electron');

// ---------- 状态 ----------
let loading = null;
async function loadState() {
  if (loading) return loading;
  loading = (async () => {
    const [st] = await Promise.all([api('GET', '/api/state'), S.models ? null : api('GET', '/api/models').then((m) => { S.models = m; }).catch(() => {})]);
    const { chats, ...rest } = st;
    Object.assign(S, rest);
    S.chats = chats;
    renderSidebar();
    if (S.view === 'tools') renderTools();
    if (S.view === 'providers') renderProviders({ soft: true });
    if (S.chat) renderChatHead(); else if (S.view === 'chat') renderChatShell();
  })().finally(() => { loading = null; });
  return loading;
}
let reloadTimer = null;
const reload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadState, 60); };

function switchView(v) {
  S.view = v;
  closeMenu();
  $$('.rail-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach((x) => x.classList.toggle('hidden', x.id !== 'view-' + v));
  if (v === 'tools') renderTools();
  if (v === 'providers') renderProviders();
  if (v === 'settings') renderSettings();
  if (v === 'ext') renderExtensions({ soft: true });
  if (v === 'chat') $('#input')?.focus();
}

on('goto', switchView);
on('reload', reload);
on('open-chat', (id) => openChat(id));
on('theme', applyTheme);

// ---------- 实时事件 ----------
function notify(m) {
  if (!S.settings.notify || document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const a = agentById(m.sender); if (!a) return;
  const n = new Notification(`${a.name} 回复了`, { body: (m.error ? '⚠ ' + m.error : m.text).slice(0, 120), silent: false });
  n.onclick = () => { window.focus(); switchView('chat'); openChat(m.chatId); };
}

function connectEvents() {
  const es = new EventSource('/api/events');
  const sub = (t, fn) => es.addEventListener(t, (e) => fn(JSON.parse(e.data)));
  const touch = (m) => {
    if (m.chatId === S.chatLoading) S.chatDirty = true;
    const c = S.chats.find((x) => x.id === m.chatId);
    if (c) c.last = m; else reload();
  };
  sub('message', (m) => {
    touch(m);
    if (m.chatId === S.chatId) {
      S.messages.push(m);
      renderMessages(m.sender === 'user');
      renderChatHead();
    }
    renderSidebar();
  });
  sub('message.delta', ({ id, chatId, delta }) => {
    if (chatId === S.chatLoading) S.chatDirty = true;
    if (chatId !== S.chatId) return;
    const m = S.messages.find((x) => x.id === id); if (!m) return;
    m.text += delta; schedulePatch(id);
  });
  sub('message.step', ({ id, chatId, step }) => {
    if (chatId !== S.chatId) return;
    const m = S.messages.find((x) => x.id === id); if (!m) return;
    m.steps.push(step); schedulePatch(id);
  });
  sub('message.update', (m) => {
    touch(m);
    if (m.chatId === S.chatId) {
      const i = S.messages.findIndex((x) => x.id === m.id);
      if (i >= 0) S.messages[i] = m; else S.messages.push(m);
      patchMessage(m); renderChatHead();
    }
    notify(m);
    renderSidebar();
  });
  sub('message.deleted', ({ chatId, id }) => {
    if (chatId !== S.chatId) return;
    S.messages = S.messages.filter((x) => x.id !== id); renderMessages();
  });
  sub('chats.busy', ({ chatId, busy }) => {
    const c = S.chats.find((x) => x.id === chatId);
    if (c) { c.busy = busy; renderSidebar(); }
  });
  sub('agents.changed', () => { invalidateExt(); reload(); });
  sub('ext.changed', onExtChanged);
  sub('chats.changed', async () => {
    await loadState();
    if (S.chatId && !S.chats.find((c) => c.id === S.chatId)) closeChat();
    else if (S.chatId) {
      const { chat, messages } = await api('GET', '/api/chats/' + encodeURIComponent(S.chatId));
      Object.assign(S.chat, chat); S.messages = messages; renderChatHead(); renderMessages();
    }
  });
  sub('install.log', ({ agentId, line }) => {
    S.logs[agentId] = ((S.logs[agentId] || '') + line).slice(-30000);
    const el = document.querySelector(`[data-log="${agentId}"]`);
    if (el) { el.textContent = S.logs[agentId]; el.scrollTop = el.scrollHeight; }
  });
  sub('install.done', ({ agentId, ok, label }) => toast(`${agentById(agentId)?.name || agentId} ${label}${ok ? '成功' : '失败，请查看日志'}`, ok ? 'ok' : 'error'));
  sub('term.open', onTermOpen);
  sub('term.data', onTermData);
  sub('term.exit', onTermExit);
  sub('term.closed', onTermClosed);
  es.onopen = () => { $('#offline')?.classList.add('hidden'); if (booted) loadState().then(() => S.chatId && openChat(S.chatId)); };
  es.onerror = () => $('#offline')?.classList.remove('hidden');
}

// ---------- 全局点击 ----------
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) { e.preventDefault(); return switchView(go.dataset.goto); }
  const cmd = e.target.closest('[data-cmd]');
  if (cmd) { e.preventDefault(); return sendText(cmd.dataset.cmd); }
  // AI 回复里的文件链接 / 路径：按会话工作目录用默认程序打开（⌥ 点击在访达中显示）
  const fp = e.target.closest('[data-open-path]');
  if (fp) {
    e.preventDefault();
    api('POST', '/api/open', { path: fp.dataset.openPath, chatId: S.chatId, reveal: e.altKey })
      .then((r) => toast(`已打开 ${r.path.replace(S.home, '~')}`, 'ok')).catch((er) => toast(er.message, 'error'));
    return;
  }
  // 兜底：任何指向 Noe 自己地址的普通链接都不要让窗口跳走
  const link = e.target.closest('a[href]');
  if (link && !link.dataset.goto && !link.dataset.cmd) {
    const href = link.getAttribute('href');
    if (href && href !== '#' && !/^(https?:|mailto:)/i.test(href)) { e.preventDefault(); api('POST', '/api/open', { path: href, chatId: S.chatId }).catch((er) => toast(er.message, 'error')); return; }
  }
  const term = e.target.closest('[data-term]');
  if (term) { const t = S.terms.find((x) => x.id === term.dataset.term); return t ? focusTerm(t.id) : toast('这个终端已经关闭了'); }
  const src = e.target.closest('[data-source]');
  if (src) { const a = agentById(src.dataset.source); if (a) return sourceMenu(src, a); }
  if (e.target.closest('[data-new-group]')) return openNewGroup();
  const tpl = e.target.closest('[data-tpl]');
  if (tpl) return createTemplateGroup(tpl.dataset.tpl, tpl.dataset.ids.split(',')).catch((er) => toast(er.message, 'error'));
});

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); quickSwitch(); }
  if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); toggleTerm(); }
  if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); openNewGroup(); }
  if (mod && /^[1-5]$/.test(e.key)) { e.preventDefault(); switchView(['chat', 'tools', 'providers', 'ext', 'settings'][+e.key - 1]); }
});

// ---------- 启动 ----------
let booted = false;
async function boot() {
  $$('.rail-btn[data-view]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('#rail-term').onclick = () => toggleTerm();
  $('#rail-theme').onclick = () => {
    const cur = document.documentElement.dataset.theme;
    try { localStorage.setItem('noe.theme', cur === 'dark' ? 'light' : 'dark'); } catch { /* 忽略 */ }
    applyTheme(); if (S.view === 'settings') renderSettings();
  };
  $('#search').addEventListener('input', (e) => { S.filter = e.target.value; renderSidebar(); });
  $('.side-scroll').addEventListener('click', (e) => { const it = e.target.closest('[data-chat]'); if (it) openChat(it.dataset.chat); });
  $('#btn-new-group').onclick = () => openNewGroup();
  bindPages();
  bindExtensions();
  setupDnD();
  await loadState();
  initTerminals();
  let last = null;
  try { last = localStorage.getItem('noe.lastChat'); } catch { /* 忽略 */ }
  if (last && (last.startsWith('dm-') ? agentById(last.slice(3)) : S.chats.find((c) => c.id === last))) await openChat(last);
  else renderChatShell();
  booted = true;
  connectEvents();
}
boot().catch((e) => { console.error(e); toast('启动失败：' + e.message, 'error'); });
