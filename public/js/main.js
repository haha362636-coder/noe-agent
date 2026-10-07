// 入口：加载状态、实时事件、视图切换、全局快捷键
import { $, $$, S, api, toast, on, emit, agentById, closeMenu, menu, t } from './core.js';
import { LANGS, setLang, detectLang, getLang, translateDom } from './i18n.js';
import {
  renderSidebar, openChat, closeChat, renderChatShell, renderChatHead, renderMessages, appendMessage, patchMessage, schedulePatch,
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
// .electron 给 macOS 红绿灯按钮留位置；Windows 用系统标题栏，不需要
const isWin = /Windows/i.test(navigator.userAgent);
if (new URLSearchParams(location.search).has('app') && !isWin) document.documentElement.classList.add('electron');
// Windows 上快捷键是 Ctrl，把界面里的 ⌘ 提示换掉
const swapKeys = (root) => {
  if (!isWin) return;
  for (const el of root.querySelectorAll('[title*="⌘"]')) el.title = el.title.replace(/⌘/g, 'Ctrl+');
  for (const el of root.querySelectorAll('kbd')) if (el.textContent.includes('⌘')) el.textContent = el.textContent.replace(/⌘/g, 'Ctrl+');
};
if (isWin) {
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) swapKeys(n.parentNode || n); })
    .observe(document.body, { childList: true, subtree: true });
}

// ---------- 语言 ----------
/** 切换界面语言：存到服务端（系统消息、发给 AI 的提示词也跟着变），然后整页刷新 */
async function switchLang(id) {
  if (id === getLang()) return;
  try { await api('PUT', '/api/settings', { lang: id }); } catch (e) { return toast(e.message, 'error'); }
  try { localStorage.setItem('noe.lang', id); } catch { /* 忽略 */ }
  location.reload();
}
function langMenu(anchor) {
  menu(anchor, [{ header: t('语言 / Language') }, ...LANGS.map((l) => ({ label: l.name, check: l.id === getLang(), onClick: () => switchLang(l.id) }))], { width: 200 });
}

// ---------- 状态 ----------
let loading = null;
let stale = false;
let modelsLoading = null;
async function loadState() {
  // 正在加载时又被要求刷新：这次请求可能发生在变化之前（比如刚新建的群还不在里面），
  // 所以等它结束后再拉一次，调用方拿到的一定是最新状态
  if (loading) { stale = true; return loading; }
  loading = (async () => {
    // 模型目录要调用 codex debug models，可能要好几秒：不等它，先把界面画出来，到了再刷新
    if (!S.models && !modelsLoading) {
      modelsLoading = api('GET', '/api/models').then((m) => { S.models = m; reload(); }).catch(() => { modelsLoading = null; });
    }
    do {
      stale = false;
      const st = await api('GET', '/api/state');
      const { chats, ...rest } = st;
      Object.assign(S, rest);
      S.chats = chats;
    } while (stale);
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
on('lang', switchLang);

// ---------- 实时事件 ----------
function notify(m) {
  if (m.status === 'streaming' || m.status === 'stopped') return;
  if (!S.settings.notify || document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const a = agentById(m.sender); if (!a) return;
  const n = new Notification(t('{name} 回复了', { name: a.name }), { body: (m.error ? '⚠ ' + m.error : m.text).slice(0, 120), silent: false });
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
      appendMessage(m);
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
    if (chatId === S.chatLoading) S.chatDirty = true;
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
  sub('install.done', ({ agentId, ok, label }) => toast(t(ok ? '{name} {label}成功' : '{name} {label}失败，请查看日志', { name: agentById(agentId)?.name || agentId, label: t(label) }), ok ? 'ok' : 'error'));
  sub('arena.stats', (stats) => { S.arenaStats = stats; });
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
      .then((r) => toast(t('已打开 {path}', { path: r.path.replace(S.home, '~') }), 'ok')).catch((er) => toast(er.message, 'error'));
    return;
  }
  // 兜底：任何指向 Noe 自己地址的普通链接都不要让窗口跳走
  const link = e.target.closest('a[href]');
  if (link && !link.dataset.goto && !link.dataset.cmd) {
    const href = link.getAttribute('href');
    if (href && href !== '#' && !/^(https?:|mailto:)/i.test(href)) { e.preventDefault(); api('POST', '/api/open', { path: href, chatId: S.chatId }).catch((er) => toast(er.message, 'error')); return; }
  }
  const term = e.target.closest('[data-term]');
  if (term) { const tm = S.terms.find((x) => x.id === term.dataset.term); return tm ? focusTerm(tm.id) : toast(t('这个终端已经关闭了')); }
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
  // 先用上次的语言把界面画出来，避免闪一下中文；服务端的设置随后为准
  let saved = null;
  try { saved = localStorage.getItem('noe.lang'); } catch { /* 忽略 */ }
  await setLang(saved || detectLang());
  translateDom();
  swapKeys(document);
  $('#rail-lang-code').textContent = LANGS.find((l) => l.id === getLang())?.short || '';
  $('#rail-lang').onclick = (e) => langMenu(e.currentTarget);
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
  // 第一次启动：把按系统语言选出的界面语言存到服务端，系统消息和发给 AI 的提示词用同一种语言
  if (!S.settings.lang) S.settings = await api('PUT', '/api/settings', { lang: getLang() }).catch(() => S.settings);
  else if (S.settings.lang !== getLang() && LANGS.some((l) => l.id === S.settings.lang)) { await setLang(S.settings.lang); return location.reload(); }
  initTerminals();
  let last = null;
  try { last = localStorage.getItem('noe.lastChat'); } catch { /* 忽略 */ }
  if (last && (last.startsWith('dm-') ? agentById(last.slice(3)) : S.chats.find((c) => c.id === last))) await openChat(last);
  else renderChatShell();
  booted = true;
  connectEvents();
}
boot().catch((e) => { console.error(e); toast(t('启动失败：') + e.message, 'error'); });
