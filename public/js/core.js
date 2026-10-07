// 公共工具：状态、请求、图标、头像、弹层、提示
import { t, getLang } from './i18n.js';
export { t };
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const S = {
  agents: [], chats: [], providers: [], presets: [], protocols: {}, commands: [], settings: {}, terms: [], home: '',
  view: 'chat', chatId: null, chat: null, messages: [],
  logs: {}, filter: '', providerSel: null,
};

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, (e) => fn(e.detail));

export async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function toast(text, kind = '') {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = `${icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info', 16)}<span>${esc(text)}</span>`;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2800);
}

export const agentById = (id) => S.agents.find((a) => a.id === id);
export const providerById = (id) => S.providers.find((p) => p.id === id);

export function avatar(a, size = 36) {
  if (!a) return `<div class="avatar" style="--s:${size}px;background:#94a3b8">?</div>`;
  const busy = S.chats.some((c) => c.busy && c.members.includes(a.id));
  return `<div class="avatar" style="--s:${size}px;--c:${a.color}">${esc(a.avatar)}${busy ? '<i class="pulse"></i>' : ''}</div>`;
}
export function groupAvatar(chat, size = 36) {
  const ms = chat.members.map(agentById).filter(Boolean).slice(0, 4);
  if (!ms.length) return `<div class="avatar" style="--s:${size}px;--c:#94a3b8">${icon('users', size * 0.5)}</div>`;
  return `<div class="avatar-grid n${ms.length}" style="--s:${size}px">${ms.map((a) => `<span style="--c:${a.color}">${esc(a.avatar)}</span>`).join('')}</div>`;
}

export function fmtTime(ts) {
  const d = new Date(ts), now = new Date();
  const hm = d.toTimeString().slice(0, 5);
  if (d.toDateString() === now.toDateString()) return hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t('昨天') + ' ' + hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
export function fmtDay(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return t('今天');
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t('昨天');
  if (getLang() !== 'zh') return d.toLocaleDateString(getLang(), { month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
  return `${d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '年'}${d.getMonth() + 1}月${d.getDate()}日`;
}
export const fmtNum = (n) => (n == null ? '' : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));
export const fmtMs = (ms) => (ms == null ? '' : ms < 1000 ? ms + 'ms' : ms < 60000 ? (ms / 1000).toFixed(1) + 's' : Math.floor(ms / 60000) + 'm' + Math.round((ms % 60000) / 1000) + 's');

/** 模型 ID → 友好名称（目录或厂商已知模型里查找） */
export function modelInfo(agentId, id) {
  if (!id) return null;
  const list = S.models?.agents?.[agentId]?.models || [];
  return list.find((m) => m.id === id) || (S.models?.known?.[id] ? { id, ...S.models.known[id] } : null);
}
export const modelName = (agentId, id) => t(modelInfo(agentId, id)?.name || id);
export const effortName = (e) => t(S.models?.effortLabel?.[e] || e);

/** agent 当前的 API 来源描述 */
export function authInfo(a) {
  if (!a) return { label: '', model: '' };
  const p = a.config.mode === 'provider' ? providerById(a.config.providerId) : null;
  const modelId = a.noModel ? '' : a.config.model || (p ? p.models?.[0] : '') || '';
  const model = a.noModel ? '' : modelId ? modelName(a.id, modelId) : t('默认模型');
  return { provider: p, label: p ? p.name : t('官方登录'), model, modelId, effort: a.config.effort || '', color: p ? p.color : a.color };
}
/** 厂商是否适配某个 agent */
export const fits = (a, p) => (a.protocols || []).some((k) => p.urls?.[k]);

// ---------- 弹出菜单 ----------
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
/**
 * items: [{ label, sub, icon, check, danger, disabled, onClick, html, header, divider }]
 */
export function menu(anchor, items, { align = 'left', width } = {}) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  if (width) el.style.width = width + 'px';
  el.innerHTML = items.map((it, i) => {
    if (it.divider) return '<div class="menu-div"></div>';
    if (it.header) return `<div class="menu-head">${esc(it.header)}</div>`;
    if (it.html) return `<div class="menu-html">${it.html}</div>`;
    return `<button class="menu-item ${it.danger ? 'danger' : ''} ${it.check ? 'checked' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
      <span class="mi-icon">${it.check ? icon('check', 15) : it.icon ? (it.icon.startsWith('<') ? it.icon : icon(it.icon, 15)) : ''}</span>
      <span class="mi-text"><span>${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>
      ${it.right ? `<span class="mi-right">${esc(it.right)}</span>` : ''}</button>`;
  }).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let left = align === 'right' ? r.right - mw : r.left;
  let top = r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  Object.assign(el.style, { left: left + 'px', top: top + 'px' });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const it = items[+b.dataset.i];
    if (!it.keepOpen) closeMenu();
    it.onClick?.(e);
  });
  openMenu = el;
  setTimeout(() => el.classList.add("show"), 10);
  return el;
}
document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target) && !e.target.closest('[data-menu-anchor]')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// ---------- 对话框 ----------
export function modal({ title, body, actions = [], width = 460, onMount }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="modal-card" style="width:${width}px">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn ghost" data-close>${icon('x', 18)}</button></div>
    <div class="modal-body">${body}</div>
    ${actions.length ? `<div class="modal-actions">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
  </div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 180); };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-close]').onclick = close;
  wrap.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = actions[+b.dataset.a];
    if (a.onClick) {
      b.disabled = true;
      try { if ((await a.onClick(wrap)) !== false) close(); } catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; }
    } else close();
  });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  setTimeout(() => wrap.classList.add('show'), 10);
  onMount?.(wrap, close);
  // 让对话框拿到焦点，Esc 才能关闭（里面没有输入框时焦点还留在页面上）
  wrap.tabIndex = -1;
  if (!wrap.contains(document.activeElement)) wrap.focus({ preventScroll: true });
  return { el: wrap, close };
}

export function confirmBox(text, { danger, ok = t('确定') } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: t('请确认'), body: `<p class="confirm-text">${esc(text)}</p>`, width: 400,
      actions: [{ label: t('取消'), onClick: () => { done = true; resolve(false); } }, { label: ok, primary: !danger, danger, onClick: () => { done = true; resolve(true); } }],
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast(t('已复制'), 'ok');
}

// ---------- 图标（线性风格） ----------
const P = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .7 3.5 2.7 3.5 5.5"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  slash: '<path d="m16 3-8 18"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  grip: '<path d="M8 9h8M8 15h8"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<path d="M4 14v6h6M20 10V4h-6M14 10l6-6M4 20l6-6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 3-4 3.5-9.5 5"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  puzzle: '<path d="M10 3h4v2a2 2 0 1 0 4 0V3h3v7h-2a2 2 0 1 0 0 4h2v7h-7v-2a2 2 0 1 0-4 0v2H3v-7h2a2 2 0 1 0 0-4H3V3z"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01"/>',
  swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
};
export function icon(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
}
