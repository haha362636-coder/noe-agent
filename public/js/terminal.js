// 内置终端抽屉：xterm.js + 服务端伪终端
import { $, esc, S, api, icon, agentById, avatar, on, t } from './core.js';

const { Terminal, FitAddon } = window.Vendor;
const xterms = new Map(); // id -> { term, fit, el, pendingInput, timer }
let active = null;
let height = 320;
try { height = +localStorage.getItem('noe.termH') || 320; } catch { /* 忽略 */ }

const drawer = () => $('#term-drawer');

function theme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return dark
    ? { background: '#0d0e11', foreground: '#d7dae0', cursor: '#a5b4fc', selectionBackground: '#3b3f63' }
    : { background: '#14151a', foreground: '#e3e5ea', cursor: '#a5b4fc', selectionBackground: '#3b3f63' };
}

export function initTerminals() {
  const d = drawer();
  d.innerHTML = `<div class="term-resize" id="term-resize"></div>
    <div class="term-bar"><div class="term-tabs" id="term-tabs"></div>
      <div class="term-tools">
        <button class="icon-btn ghost xs" id="term-new" title="${t('新建系统终端')}">${icon('plus', 15)}</button>
        <button class="icon-btn ghost xs" id="term-hide" title="${t('收起 (⌘J)')}">${icon('chevron', 15)}</button>
      </div></div>
    <div class="term-body" id="term-body"><div class="term-empty">${t('没有打开的终端。输入 {a}、{b} 或 {c} 会在这里打开。', { a: '<code>/login</code>', b: '<code>/terminal</code>', c: '<code>/shell</code>' })}</div></div>`;
  d.style.height = height + 'px';
  $('#term-hide').onclick = () => toggle(false);
  $('#term-new').onclick = async () => {
    const r = S.chatId ? await api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/shell`) : null;
    if (r) focus(r.term);
  };
  $('#term-tabs').onclick = (e) => {
    const x = e.target.closest('[data-close]');
    if (x) { e.stopPropagation(); return api('DELETE', '/api/terms/' + x.dataset.close); }
    const t = e.target.closest('[data-tab]'); if (t) focus(t.dataset.tab);
  };
  // 拖动调整高度
  $('#term-resize').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY, startH = d.offsetHeight;
    const move = (ev) => { height = Math.max(160, Math.min(innerHeight - 160, startH + startY - ev.clientY)); d.style.height = height + 'px'; fitActive(); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); try { localStorage.setItem('noe.termH', height); } catch { /* 忽略 */ } };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
  addEventListener('resize', fitActive);
  for (const t of S.terms) ensure(t, true);
  renderTabs();
  on('term.focus', (id) => focus(id));
}

function ensure(t, replay = false) {
  if (xterms.has(t.id)) return xterms.get(t.id);
  const el = document.createElement('div');
  el.className = 'xterm-host hidden';
  $('#term-body').appendChild(el);
  const term = new Terminal({
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace', fontSize: 12.5, lineHeight: 1.25,
    cursorBlink: true, allowProposedApi: true, theme: theme(), scrollback: 5000, convertEol: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  const x = { term, fit, el, meta: t, input: '', timer: null };
  term.onData((data) => {
    x.input += data;
    clearTimeout(x.timer);
    x.timer = setTimeout(() => { const d = x.input; x.input = ''; api('POST', `/api/terms/${t.id}/input`, { data: d }).catch(() => {}); }, 8);
  });
  term.onResize(({ cols, rows }) => api('POST', `/api/terms/${t.id}/resize`, { cols, rows }).catch(() => {}));
  xterms.set(t.id, x);
  // 页面刷新后重新挂载已有终端时回放历史输出；新开的终端靠实时事件即可
  if (replay) api('GET', `/api/terms/${t.id}/buffer`).then(({ buffer }) => { if (buffer) term.write(buffer); }).catch(() => {});
  return x;
}

export function onTermOpen(t) {
  if (!S.terms.find((x) => x.id === t.id)) S.terms.push(t);
  ensure(t);
  focus(t.id);
}
export function onTermData({ id, data }) {
  const x = xterms.get(id);
  if (x) x.term.write(data);
}
export function onTermExit({ id, code }) {
  const t = S.terms.find((x) => x.id === id);
  if (t) { t.exited = true; t.code = code; }
  renderTabs();
}
export function onTermClosed({ id }) {
  S.terms = S.terms.filter((x) => x.id !== id);
  const x = xterms.get(id);
  if (x) { x.term.dispose(); x.el.remove(); xterms.delete(id); }
  if (active === id) { active = S.terms.at(-1)?.id || null; if (active) focus(active); }
  renderTabs();
  if (!S.terms.length) toggle(false);
}

export function focus(id) {
  const t = S.terms.find((x) => x.id === id);
  if (!t) return;
  ensure(t);
  active = id;
  for (const [k, x] of xterms) x.el.classList.toggle('hidden', k !== id);
  toggle(true);
  renderTabs();
  requestAnimationFrame(() => { fitActive(); xterms.get(id)?.term.focus(); });
}

function fitActive() {
  const x = active && xterms.get(active);
  if (!x || drawer().classList.contains('hidden')) return;
  try { x.fit.fit(); } catch { /* 尚未可见 */ }
}

export function toggle(show) {
  const d = drawer();
  const want = show ?? d.classList.contains('hidden');
  d.classList.toggle('hidden', !want);
  document.body.classList.toggle('term-open', want);
  if (want && !active && S.terms.length) return focus(S.terms.at(-1).id);
  if (want) requestAnimationFrame(fitActive);
  renderTabs();
}

function renderTabs() {
  const tabs = $('#term-tabs'); if (!tabs) return;
  tabs.innerHTML = S.terms.map((tm) => {
    const a = agentById(tm.agentId);
    return `<div class="term-tab ${tm.id === active ? 'active' : ''} ${tm.exited ? 'exited' : ''}" data-tab="${tm.id}" title="${esc(tm.title)}">
      ${a ? avatar(a, 16) : icon('terminal', 14)}<span>${esc(tm.title)}</span>${tm.exited ? `<i class="ex">${t('已结束')}</i>` : '<i class="live"></i>'}
      <button class="tab-x" data-close="${tm.id}">${icon('x', 12)}</button></div>`;
  }).join('');
  $('#term-empty-hint')?.remove();
  $('.term-empty')?.classList.toggle('hidden', S.terms.length > 0);
  const badge = $('#term-badge');
  if (badge) { const n = S.terms.filter((t) => !t.exited).length; badge.textContent = n || ''; badge.classList.toggle('hidden', !n); }
}

export function retheme() { for (const x of xterms.values()) x.term.options.theme = theme(); }
