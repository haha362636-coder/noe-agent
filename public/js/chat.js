// 聊天：会话列表、消息流、输入框（@ 与 / 补全）、拖拽拉群、API 来源切换
import {
  $, $$, esc, S, api, toast, icon, avatar, groupAvatar, agentById, providerById, fmtTime, fmtDay, fmtNum, fmtMs,
  authInfo, fits, menu, modal, confirmBox, copyText, emit, modelInfo, effortName, t,
} from './core.js';
import { md, renderMentions } from './markdown.js';
import { agentLogo, providerLogo, modelLogo, logoTile } from './brands.js';

const READ_KEY = 'noe.read';
let readMap = {};
try { readMap = JSON.parse(localStorage.getItem(READ_KEY) || '{}'); } catch { /* 忽略 */ }
function markRead(id) { readMap[id] = Date.now(); try { localStorage.setItem(READ_KEY, JSON.stringify(readMap)); } catch { /* 忽略 */ } }
const isUnread = (c) => c.id !== S.chatId && c.last && c.last.sender !== 'user' && c.last.status !== 'streaming' && c.last.ts > (readMap[c.id] || 0);

// ================= 会话列表 =================
export function renderSidebar() {
  const f = S.filter.trim().toLowerCase();
  const dm = (id) => S.chats.find((c) => c.id === 'dm-' + id);
  const agents = S.agents.filter((a) => !f || a.name.toLowerCase().includes(f) || a.id.includes(f));
  $('#agent-list').innerHTML = agents.map((a) => {
    const c = dm(a.id);
    const on = a.status?.installed;
    const info = authInfo(a);
    const preview = c?.busy ? `<span class="typing-dots"><i></i><i></i><i></i></span> ${t('正在输入')}` : esc(c?.last ? previewText(c.last) : on ? `${info.label}${info.model ? ' · ' + info.model : ''}` : a.installing ? t('安装中…') : t('未安装'));
    return `<div class="item ${S.chatId === 'dm-' + a.id ? 'active' : ''} ${on ? '' : 'dim'}" draggable="true" data-agent="${a.id}" data-chat="dm-${a.id}">
      ${avatar(a, 38)}
      <div class="meta">
        <div class="row1"><span class="title">${esc(a.name)}</span>${c?.last ? `<span class="time">${fmtTime(c.last.ts)}</span>` : on ? '' : `<span class="badge-soft">${t('未安装')}</span>`}</div>
        <div class="row2"><span class="preview">${preview}</span>${c && isUnread(c) ? '<span class="unread"></span>' : ''}</div>
      </div></div>`;
  }).join('');

  const groups = S.chats.filter((c) => c.type === 'group' && (!f || c.name.toLowerCase().includes(f)))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.last?.ts || b.createdAt) - (a.last?.ts || a.createdAt));
  $('#group-list').innerHTML = groups.map((c) => `
    <div class="item ${S.chatId === c.id ? 'active' : ''}" data-chat="${c.id}" data-group="${c.id}">
      ${groupAvatar(c, 38)}
      <div class="meta">
        <div class="row1"><span class="title">${c.pinned ? icon('pin', 12) : ''}${esc(c.name)}</span><span class="time">${c.last ? fmtTime(c.last.ts) : ''}</span></div>
        <div class="row2"><span class="preview">${c.busy ? `<span class="typing-dots"><i></i><i></i><i></i></span> ${t('有成员在干活')}` : esc(c.last ? previewText(c.last) : t('{n} 位成员', { n: c.members.length }))}</span>${isUnread(c) ? '<span class="unread"></span>' : ''}</div>
      </div></div>`).join('')
    || `<div class="side-empty">${t('还没有群聊')}<br><small>${t('把上面的 AI 拖到下方虚线框里试试')}</small></div>`;
  $('#group-count').textContent = groups.length || '';
}
function previewText(m) {
  const who = m.sender === 'user' ? t('我') : m.sender === 'system' ? '' : agentById(m.sender)?.name || m.sender;
  if (m.kind === 'arena') return `⚔ ${t('AI 擂台')}：${m.arena.task}`;
  const text = m.status === 'streaming' ? t('正在输入…') : (m.text || (m.error ? t('出错了') : '')).replace(/[#*`>|_-]+/g, '').replace(/\s+/g, ' ');
  return (who ? who + t('：') : '') + text;
}

// ================= 打开会话 =================
// 每个会话各自的输入草稿，切换会话不丢
const drafts = new Map();
function saveDraft() { const t = $('#input'); if (S.chatId && t) drafts.set(S.chatId, t.value); }

/** opts.focus：打开后滚动到并高亮某条消息（来自搜索） */
export async function openChat(id, { focus } = {}) {
  saveDraft(); // 同一会话重绘（如切换工作目录后）也要保留输入框内容
  S.chatId = id;
  // 加载期间到达的实时事件会被丢弃，所以加载完若有新事件就再取一次
  S.chatLoading = id; S.chatDirty = false;
  let res = await api('GET', '/api/chats/' + encodeURIComponent(id));
  if (S.chatDirty && S.chatId === id) res = await api('GET', '/api/chats/' + encodeURIComponent(id));
  S.chatLoading = null;
  const { chat, messages } = res;
  if (S.chatId !== id) return;
  const switched = S.chat?.id !== id;
  S.chat = chat; S.messages = messages;
  if (switched) shown = PAGE;
  if (!S.chats.find((c) => c.id === id)) S.chats.push({ ...chat, last: messages.at(-1) || null });
  markRead(id);
  try { localStorage.setItem('noe.lastChat', id); } catch { /* 忽略 */ }
  if (focus) { const i = messages.findIndex((m) => m.id === focus); if (i >= 0) shown = Math.max(shown, messages.length - i + 10); }
  renderChatShell();
  renderSidebar();
  const input = $('#input');
  if (input && drafts.has(id)) { input.value = drafts.get(id); autosize(); }
  if (focus) {
    const el = document.getElementById('m-' + focus);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); }
  } else input?.focus();
}

export function closeChat() {
  saveDraft();
  S.chatId = null; S.chat = null; S.messages = [];
  renderChatShell(); renderSidebar();
}

export function renderChatShell() {
  const box = $('#chat');
  if (!S.chat) { box.innerHTML = welcomeHtml(); return; }
  const c = S.chat;
  const membersOpen = c.type === 'group' && localStorage.getItem('noe.members') !== '0';
  box.innerHTML = `
    <header class="chat-head">
      <div class="chat-title" id="chat-title"></div>
      <div class="chat-actions">
        <span id="source-slot"></span>
        <button class="icon-btn ghost" id="btn-folder" title="${t('打开工作目录')}">${icon('folder')}</button>
        <button class="icon-btn ghost" id="btn-term" title="${t('打开终端（/terminal）')}">${icon('terminal')}</button>
        ${c.type === 'group' ? `<button class="icon-btn ghost ${membersOpen ? 'on' : ''}" id="btn-members" title="${t('群成员')}">${icon('users')}</button>` : ''}
        <button class="icon-btn ghost" id="btn-more" data-menu-anchor title="${t('更多')}">${icon('more')}</button>
      </div>
    </header>
    <div class="chat-body">
      <div class="messages-wrap" data-drop-label="${t('松开即可拉进群聊')}">
        <div class="messages" id="messages"></div>
        <button class="jump hidden" id="jump">${icon('chevron', 16)} ${t('回到最新')}</button>
      </div>
      <aside class="members ${membersOpen ? '' : 'hidden'}" id="members"></aside>
    </div>
    <footer class="composer">
      <div class="suggest hidden" id="suggest"></div>
      <div class="composer-box" id="composer-box">
        <textarea id="input" rows="1" placeholder="${c.type === 'group' ? t('输入 @ 指派成员，输入 / 使用命令…') : t('给 {name} 发消息，输入 / 使用命令…', { name: esc(agentById(c.members[0])?.name || '') })}"></textarea>
        <div class="composer-bar">
          <div class="bar-left">
            <button class="chip-btn" id="btn-slash" title="${t('命令')}">${icon('slash', 14)} ${t('命令')}</button>
            ${c.type === 'group' ? `<button class="chip-btn" id="btn-at" title="${t('提及成员')}">${icon('at', 14)} ${t('提及')}</button>` : `<button class="chip-btn model-chip" id="btn-model" title="${t('选择模型和思考强度')}"></button>`}
            <button class="chip-btn arena-chip" id="btn-arena" title="${t('AI 擂台：让几个 AI 同时做同一个任务，盲评选出最好的')}">${icon('swords', 14)} ${t('擂台')}</button>
            <span class="bar-hint" id="bar-hint"></span>
          </div>
          <div class="bar-right">
            <button class="btn stop hidden" id="btn-stop">${icon('stop', 14)} ${t('停止')}</button>
            <button class="send-btn" id="btn-send" title="${t('发送 (Enter)')}">${icon('send', 17)}</button>
          </div>
        </div>
      </div>
    </footer>`;
  bindChat();
  renderChatHead();
  renderMessages(true);
}

export function renderChatHead() {
  const c = S.chat; if (!c || !$('#chat-title')) return;
  const fresh = S.chats.find((x) => x.id === c.id);
  if (fresh) Object.assign(c, { members: fresh.members, name: fresh.name, cwd: fresh.cwd, pinned: fresh.pinned });
  const isGroup = c.type === 'group';
  const a = agentById(c.members[0]);
  const cwd = c.cwd || c.cwdResolved || '';
  const shortCwd = cwd.replace(S.home, '~');
  $('#chat-title').innerHTML = isGroup
    ? `${groupAvatar(c, 40)}<div><div class="name">${esc(c.name)}</div><div class="sub">${t('{n} 位成员', { n: c.members.length })} · ${cwdChip(c, shortCwd, cwd)}</div></div>`
    : `${avatar(a, 40)}<div><div class="name">${esc(a?.name || c.name)} ${a?.status?.installed ? '' : `<span class="badge-soft warn">${t('未安装')}</span>`}</div><div class="sub">${esc(t(a?.vendor || ''))} · ${cwdChip(c, shortCwd, cwd)}</div></div>`;
  $('#source-slot').innerHTML = !isGroup && a ? sourcePill(a) : '';
  const busy = S.messages.some((m) => m.status === 'streaming');
  $('#btn-stop')?.classList.toggle('hidden', !busy);
  if (isGroup) renderMembers();
  const mc = $('#btn-model');
  if (mc && a) {
    const info = authInfo(a);
    mc.classList.toggle('hidden', !!a.noModel);
    mc.innerHTML = `${icon('sparkles', 14)} ${esc(info.model || t('默认模型'))}${info.effort ? ` · ${esc(effortName(info.effort))}` : ''} ${icon('chevron', 12)}`;
  }
  const hint = $('#bar-hint');
  if (hint) {
    hint.innerHTML = isGroup ? t('Enter 发送 · Shift+Enter 换行 · AI 之间可以互相 @ 接力')
      : a && !a.status?.installed ? t('{name} 未安装，{link}', { name: esc(a.name), link: `<a href="#" data-goto="tools">${t('去一键安装')}</a>` })
      : a?.auth && !a.auth.loggedIn && a.config.mode === 'official' && a.canLogin ? t('{name} 未登录，输入 {cmd} 或 {link}', { name: esc(a.name), cmd: '<code>/login</code>', link: `<a href="#" data-cmd="/login">${t('立即登录')}</a>` })
      : t('Enter 发送 · Shift+Enter 换行');
  }
}

function cwdChip(c, short, full) {
  const unset = needsCwd(c);
  return `<button class="cwd-chip ${unset ? 'warn' : ''}" data-cwd-menu data-menu-anchor title="${esc(full)}">${icon('folder', 12)}<span>${unset ? t('未选择工作目录（默认工作区）') : esc(short)}</span>${icon('chevron', 11)}</button>`;
}
/** 是否还需要让用户选择工作目录 */
export const needsCwd = (c) => !!c && !c.cwd && !c.cwdChosen && S.settings.askCwd !== false;

// ================= 工作目录 =================
/** 选择工作目录：原生文件夹选择框 / 最近使用 / 默认工作区 / 手动输入。resolve(true) 表示已设置 */
export function chooseCwd(c = S.chat, { reason } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const set = async (dir, close) => {
      try {
        await api('PATCH', `/api/chats/${encodeURIComponent(c.id)}`, { cwd: dir });
        Object.assign(c, { cwd: dir, cwdChosen: true });
        const local = S.chats.find((x) => x.id === c.id); if (local) Object.assign(local, { cwd: dir, cwdChosen: true });
        toast(dir ? t('工作目录：') + dir.replace(S.home, '~') : t('使用默认工作区'), 'ok');
        close();
        if (S.chat?.id === c.id) await openChat(c.id);
        finish(true);
      } catch (e) { toast(e.message, 'error'); }
    };
    const recent = (S.settings.recentDirs || []).filter((d) => d !== c.cwd).slice(0, 6);
    const m = modal({
      title: t('选择工作目录'), width: 520,
      body: `${reason ? `<p class="muted small" style="margin-top:0">${esc(reason)}</p>` : ''}
        <p class="cwd-explain">${t('AI 会在这个文件夹里读写文件、运行命令。选你的项目文件夹，做出来的东西就在你知道的地方。')}</p>
        <button class="cwd-pick" data-pick>${icon('folder', 22)}<div><b>${t('选择文件夹…')}</b><small>${t('打开系统的文件夹选择框')}</small></div></button>
        ${recent.length ? `<div class="cwd-sec">${t('最近使用')}</div><div class="cwd-recent">${recent.map((d) => `<button class="cwd-item" data-dir="${esc(d)}">${icon('folder', 14)}<span>${esc(d.replace(S.home, '~'))}</span></button>`).join('')}</div>` : ''}
        <div class="cwd-sec">${t('或者手动输入路径')}</div>
        <div class="cwd-input"><input id="cwd-path" placeholder="${t('~/Projects/my-app（不存在会自动创建）')}" value="${esc(c.cwd ? c.cwd.replace(S.home, '~') : '')}"><button class="btn sm" data-manual>${t('使用')}</button></div>
        <button class="link cwd-default" data-default>${t('使用默认工作区（{dir}）', { dir: esc((c.cwdResolved || S.settings.workspace || '').replace(S.home, '~')) })}</button>`,
      onMount: (el, close) => {
        el.addEventListener('click', async (e) => {
          if (e.target.closest('[data-pick]')) {
            const b = e.target.closest('[data-pick]'); b.disabled = true;
            try {
              const r = await api('POST', '/api/pick-folder', { prompt: t('选择 Noe Agent 的工作目录'), defaultPath: c.cwd || S.home });
              if (r.path) await set(r.path, close);
            } catch (er) { toast(er.message, 'error'); }
            b.disabled = false;
          }
          const d = e.target.closest('[data-dir]'); if (d) set(d.dataset.dir, close);
          if (e.target.closest('[data-manual]')) { const v = el.querySelector('#cwd-path').value.trim(); if (v) set(v, close); }
          if (e.target.closest('[data-default]')) set('', close);
        });
        el.querySelector('#cwd-path').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) set(v, close); } });
      },
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); finish(false); } });
    obs.observe(document.body, { childList: true });
  });
}

function cwdMenu(anchor) {
  const c = S.chat;
  const recent = (S.settings.recentDirs || []).filter((d) => d !== c.cwd).slice(0, 5);
  menu(anchor, [
    { header: (c.cwd || c.cwdResolved || '').replace(S.home, '~') || t('工作目录') },
    { label: t('选择其他文件夹…'), icon: 'folder', onClick: () => chooseCwd(c) },
    ...recent.map((d) => ({ label: d.replace(S.home, '~'), icon: 'clock', onClick: () => api('PATCH', `/api/chats/${encodeURIComponent(c.id)}`, { cwd: d }).then(() => { toast(t('工作目录已切换'), 'ok'); openChat(c.id); }) })),
    { divider: true },
    { label: t(/Windows/i.test(navigator.userAgent) ? '在资源管理器中打开' : '在访达中打开'), icon: 'folder', onClick: () => api('POST', `/api/chats/${encodeURIComponent(c.id)}/open-folder`) },
    { label: t('在终端中打开'), icon: 'terminal', onClick: () => sendText('/shell') },
  ], { width: 300 });
}

function sourcePill(a) {
  const info = authInfo(a);
  const warn = a.config.mode === 'official' && a.auth && !a.auth.loggedIn && a.canLogin;
  return `<button class="source-pill ${warn ? 'warn' : ''}" data-source="${a.id}" data-menu-anchor title="${t('切换 API 来源 / 模型')}">
    ${info.provider && !warn ? logoTile(providerLogo(info.provider), 16, esc(info.provider.name.slice(0, 1)), 'mini') : `<i class="dot" style="background:${warn ? 'var(--warn)' : 'var(--ok)'}"></i>`}
    <span>${esc(info.label)}${warn ? t('（未登录）') : ''}</span>${info.model ? `<span class="model">${esc(info.model)}${info.effort ? ' · ' + esc(effortName(info.effort)) : ''}</span>` : ''}${icon('chevron', 14)}</button>`;
}

function renderMembers() {
  const c = S.chat; const box = $('#members'); if (!box) return;
  box.innerHTML = `
    <div class="panel-title">${t('群成员')} <span class="count">${c.members.length}</span></div>
    <div class="member-list">${c.members.map((id) => {
      const a = agentById(id);
      return `<div class="member">${avatar(a, 32)}<div class="m-meta"><div>${esc(a?.name || id)} <span class="muted">@${esc(id)}</span></div>
        ${a ? sourcePill(a) : ''}</div><button class="icon-btn ghost xs" data-remove="${id}" title="${t('移出群聊')}">${icon('x', 14)}</button></div>`;
    }).join('')}</div>
    <div class="drop-zone" id="member-drop">${icon('plus', 16)} ${t('拖入 AI 加入群聊')}</div>
    <div class="add-chips">${S.agents.filter((a) => !c.members.includes(a.id)).map((a) => `<button class="chip" data-add="${a.id}">${avatar(a, 20)}${esc(a.name)}</button>`).join('')}</div>
    <div class="panel-title">${t('群设置')}</div>
    <label class="field"><span>${t('群名称')}</span><input id="group-name" value="${esc(c.name)}"></label>
    <label class="field"><span>${t('工作目录')}</span><input id="group-cwd" value="${esc(c.cwd || '')}" placeholder="${esc((c.cwdResolved || '').replace(S.home, '~'))}"></label>
    ${arenaBoard(c.members)}
    <button class="btn danger block" id="btn-del-group">${icon('trash', 15)} ${t('解散群聊')}</button>`;
}

// ================= 消息 =================
// 长会话只渲染最近的 PAGE 条消息，往上翻可以继续加载，避免几千条消息一次性塞进 DOM
const PAGE = 120;
let shown = PAGE;

export function renderMessages(scroll) {
  const box = $('#messages'); if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  const start = Math.max(0, S.messages.length - shown);
  let html = start ? `<button class="load-more" id="load-more">${icon('clock', 13)} ${t('显示更早的 {n} 条消息（共 {total} 条）', { n: Math.min(PAGE, start), total: S.messages.length })}</button>` : '';
  let lastDay = '', prev = null;
  for (const m of S.messages.slice(start)) {
    const day = fmtDay(m.ts);
    if (day !== lastDay) { html += `<div class="day-sep"><span>${day}</span></div>`; lastDay = day; prev = null; }
    html += msgHtml(m, prev);
    prev = m;
  }
  box.innerHTML = html || emptyChatHtml();
  if (scroll || nearBottom) box.scrollTop = box.scrollHeight;
  updateBusy();
}

/** 新消息只追加到末尾，不重绘整个列表 */
export function appendMessage(m) {
  const box = $('#messages'); if (!box) return;
  const i = S.messages.indexOf(m);
  const prev = S.messages[i - 1];
  if (!prev || !document.getElementById('m-' + prev.id)) return renderMessages(m.sender === 'user');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  const sameDay = fmtDay(prev.ts) === fmtDay(m.ts);
  box.insertAdjacentHTML('beforeend', (sameDay ? '' : `<div class="day-sep"><span>${fmtDay(m.ts)}</span></div>`) + msgHtml(m, sameDay ? prev : null));
  box.lastElementChild.classList.add('enter');
  shown++;
  if (m.sender === 'user' || nearBottom) box.scrollTop = box.scrollHeight;
  updateBusy();
}
const updateBusy = () => $('#btn-stop')?.classList.toggle('hidden', !S.messages.some((m) => m.status === 'streaming'));

function emptyChatHtml() {
  const c = S.chat;
  const cwdCard = needsCwd(c) ? `<div class="cwd-card">${icon('folder', 20)}<div><b>${t('先选择工作目录')}</b><small>${t('AI 做出来的文件都会放在这里，之后在顶部随时可以切换')}</small></div><button class="btn primary sm" data-choose-cwd>${t('选择文件夹')}</button></div>` : '';
  if (c.type === 'group') {
    const ms = c.members.map(agentById).filter(Boolean);
    const ex = ms.length >= 2 ? t('@{a} 帮我写一个待办应用的后端接口，@{b} 写对应的单元测试', { a: ms[0].id, b: ms[1].id }) : ms.length ? t('@{a} 介绍一下你自己', { a: ms[0].id }) : '';
    const arenaEx = ms.length >= 2 ? `/arena ${t('用纯 HTML/CSS 做一个好看的个人主页 index.html')}` : '';
    return `<div class="chat-empty">${groupAvatar(c, 64)}<h3>${esc(c.name)}</h3><p>${t('用 @ 把任务派给成员，他们会在同一个工作目录里协作。')}</p>${cwdCard}
      ${ex ? `<div class="examples"><button class="example" data-fill="${esc(ex)}">${icon('sparkles', 15)} ${esc(ex)}</button>
        ${arenaEx ? `<button class="example arena-ex" data-fill="${esc(arenaEx)}">${icon('swords', 15)} ${esc(arenaEx)}</button>` : ''}</div>` : `<p class="muted">${t('先把 AI 拖进群吧')}</p>`}</div>`;
  }
  const a = agentById(c.members[0]);
  const ex = [t('帮我在当前目录初始化一个 Vite + React 项目'), t('解释一下这个目录里的代码结构'), '/help'];
  return `<div class="chat-empty">${avatar(a, 64)}<h3>${esc(a?.name)}</h3><p>${esc(t(a?.desc || ''))}</p>${cwdCard}
    <div class="examples">${ex.map((e) => `<button class="example" data-fill="${esc(e)}">${icon(e.startsWith('/') ? 'slash' : 'sparkles', 15)} ${esc(e)}</button>`).join('')}</div></div>`;
}

function msgHtml(m, prev) {
  if (m.sender === 'system') return sysHtml(m);
  const me = m.sender === 'user';
  const compact = prev && prev.sender === m.sender && prev.sender !== 'system' && m.ts - prev.ts < 5 * 60e3 && !m.replyTo;
  if (me) {
    return `<div class="msg me ${compact ? 'compact' : ''}" id="m-${m.id}">
      <div class="body">
        <div class="bubble ${m.command ? 'cmd' : ''}">${m.command ? `${icon('slash', 13)}<span>${esc(m.text.replace(/^\//, ''))}</span>` : renderMentions(esc(m.text))}</div>
        <div class="msg-actions">${actBtn('copy', t('复制'))}${actBtn('edit', t('编辑后重新发送'))}${actBtn('trash', t('删除'))}<span class="time">${fmtTime(m.ts)}</span></div>
      </div></div>`;
  }
  const a = agentById(m.sender);
  const replyTo = m.replyTo && S.chat.type === 'group' ? S.messages.find((x) => x.id === m.replyTo) : null;
  const relay = replyTo && replyTo.sender !== 'user' ? `<span class="relay">${icon('zap', 12)} ${t('接力自 {name}', { name: esc(agentById(replyTo.sender)?.name || '') })}</span>`
    : m.arenaWin ? `<span class="relay win">${icon('trophy', 12)} ${t('擂台胜出')}</span>` : '';
  const meta = m.meta || {};
  const metaBits = [
    meta.durationMs && m.status !== 'streaming' ? fmtMs(meta.durationMs) : '',
    meta.inTok || meta.outTok ? `${fmtNum(meta.inTok)} → ${fmtNum(meta.outTok)} tokens` : '',
    meta.cost ? '$' + meta.cost.toFixed(meta.cost < 0.01 ? 4 : 3) : '',
  ].filter(Boolean);
  const streaming = m.status === 'streaming';
  const body = m.text ? md(m.text, { streaming })
    : m.queued ? `<span class="thinking">${icon('clock', 13)} ${t('排队中，等上一条任务完成后开始')}</span>`
    : streaming ? `<span class="thinking"><span class="typing-dots"><i></i><i></i><i></i></span>${m.steps?.length ? esc(t(m.steps.at(-1).title)) : t('思考中')}</span>`
    : m.error ? '' : `<span class="muted">${t('（没有输出）')}</span>`;
  return `<div class="msg ${compact ? 'compact' : ''} ${m.status}" id="m-${m.id}">
    ${compact ? '<div class="avatar-space"></div>' : avatar(a, 34)}
    <div class="body">
      ${compact ? '' : `<div class="who"><b>${esc(a?.name || m.sender)}</b>
        ${meta.provider || meta.model ? `<span class="model-tag">${esc([t(meta.provider), meta.model].filter(Boolean).join(' · '))}</span>` : ''}${relay}<span class="time">${fmtTime(m.ts)}</span></div>`}
      ${stepsHtml(m)}
      ${body ? `<div class="bubble md ${m.status === 'streaming' && m.text ? 'streaming' : ''}">${body}</div>` : ''}
      ${m.changes ? changesHtml(m) : ''}
      ${m.error ? `<div class="err-card">${icon('alert', 16)}<div><b>${t('运行出错')}</b><pre>${esc(m.error)}</pre></div></div>` : ''}
      ${m.status === 'stopped' ? `<div class="stopped">${icon('stop', 12)} ${t('已停止')}</div>` : ''}
      ${streaming ? `<div class="msg-actions live">${actBtn('stop', t(m.queued ? '取消排队' : '停止这条回复'))}</div>` : ''}
      ${m.status !== 'streaming' ? `<div class="msg-actions">${actBtn('copy', t('复制'))}${m.replyTo ? actBtn('refresh', t('重新生成')) : ''}${actBtn('trash', t('删除'))}
        ${metaBits.length ? `<span class="meta">${metaBits.map(esc).join(' · ')}</span>` : ''}</div>` : ''}
    </div></div>`;
}
// ================= 时光机：文件改动卡片 =================
const ST = { A: ['新增', 'add'], M: ['修改', 'mod'], D: ['删除', 'del'] };
const nums = (f) => f.binary ? `<i class="muted">${t('二进制')}</i>` : `${f.add ? `<i class="plus">+${f.add}</i>` : ''}${f.del ? `<i class="minus">−${f.del}</i>` : ''}`;
function changesHtml(m) {
  const c = m.changes;
  const more = c.total - Math.min(6, c.files.length);
  const btns = c.expired ? `<span class="muted small">${t('快照已清理')}</span>`
    : `<button class="ch-btn" data-ch="diff">${icon('eye', 13)} ${t('查看差异')}</button>
       ${c.reverted ? `<button class="ch-btn" data-ch="redo">${icon('redo', 13)} ${t('恢复改动')}</button>` : `<button class="ch-btn undo" data-ch="undo">${icon('undo', 13)} ${t('撤销改动')}</button>`}`;
  return `<div class="changes ${c.reverted ? 'reverted' : ''}">
    <div class="ch-head">${icon('clock', 14)}<b>${t(c.reverted ? '已撤销对 {n} 个文件的改动' : '改动了 {n} 个文件', { n: c.total })}</b>
      <span class="ch-stat">${nums(c)}</span><span class="grow"></span>${btns}</div>
    ${fileRows(c.files.slice(0, 6), { title: c.expired ? '' : t('查看这个文件的差异') })}
      ${more > 0 ? `<div class="ch-file more" data-ch="diff">${t('还有 {n} 个文件…', { n: more })}</div>` : ''}</div>`;
}
const fileRows = (files, { title = '' } = {}) => `<div class="ch-files">${files.map((f) => `<div class="ch-file" data-ch-file="${esc(f.path)}" title="${title}">
      <span class="ch-st st-${ST[f.status]?.[1] || 'mod'}" title="${t(ST[f.status]?.[0] || '')}">${f.status}</span><span class="ch-path">${esc(f.path)}</span><span class="ch-n">${nums(f)}</span></div>`).join('')}</div>`;

/** 差异查看器：左边文件列表，右边带行号的彩色差异 */
function showDiff(mid, file) {
  const m = S.messages.find((x) => x.id === mid); if (!m?.changes) return;
  diffViewer({
    changes: m.changes, file, who: agentById(m.sender)?.name || m.sender,
    url: (p) => `/api/chats/${encodeURIComponent(S.chatId)}/messages/${mid}/diff?path=${encodeURIComponent(p)}`,
  });
}
function diffViewer({ changes: c, file, who, url }) {
  let cur = file || c.files[0]?.path;
  modal({
    title: t('{who} 的改动 · {n} 个文件', { who, n: c.total }), width: 980,
    body: `<div class="diff-wrap"><div class="diff-list">${c.files.map((f) => `<button class="diff-item" data-df="${esc(f.path)}">
        <span class="ch-st st-${ST[f.status]?.[1] || 'mod'}">${f.status}</span><span class="ch-path">${esc(f.path)}</span><span class="ch-n">${nums(f)}</span></button>`).join('')}</div>
      <div class="diff-main"><div class="diff-bar"><code id="diff-name"></code><span class="grow"></span><button class="btn xs" id="diff-open">${icon('folder', 13)} ${t('打开文件')}</button></div><div class="diff-view" id="diff-view"></div></div></div>`,
    onMount: (el) => {
      const load = async (p) => {
        cur = p;
        el.querySelectorAll('[data-df]').forEach((b) => b.classList.toggle('on', b.dataset.df === p));
        el.querySelector('#diff-name').textContent = p;
        const f = c.files.find((x) => x.path === p);
        el.querySelector('#diff-open').disabled = f?.status === 'D' && !c.reverted;
        const view = el.querySelector('#diff-view');
        view.innerHTML = '<div class="diff-empty"><span class="spinner"></span></div>';
        try {
          const { diff } = await api('GET', url(p));
          if (cur === p) view.innerHTML = renderDiff(diff, f);
        } catch (e) { view.innerHTML = `<div class="diff-empty">${esc(e.message)}</div>`; }
      };
      el.querySelector('.diff-list').onclick = (e) => { const b = e.target.closest('[data-df]'); if (b) load(b.dataset.df); };
      el.querySelector('#diff-open').onclick = () => api('POST', '/api/open', { path: `${c.cwd}/${cur}`, chatId: S.chatId }).catch((er) => toast(er.message, 'error'));
      if (cur) load(cur);
    },
  });
}
function renderDiff(text, f) {
  if (f?.binary) return `<div class="diff-empty">${t('二进制文件，无法显示差异')}</div>`;
  let o = 0, n = 0;
  const rows = [];
  for (const line of text.split('\n')) {
    if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity|Binary files)/.test(line)) continue;
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
    if (h) { o = +h[1]; n = +h[2]; rows.push(`<tr class="hunk"><td></td><td></td><td>${esc(line)}</td></tr>`); continue; }
    if (line.startsWith('+')) rows.push(`<tr class="add"><td></td><td>${n++}</td><td>${esc(line)}</td></tr>`);
    else if (line.startsWith('-')) rows.push(`<tr class="del"><td>${o++}</td><td></td><td>${esc(line)}</td></tr>`);
    else if (line.startsWith('\\')) rows.push(`<tr class="meta"><td></td><td></td><td>${esc(line)}</td></tr>`);
    else if (line) rows.push(`<tr><td>${o++}</td><td>${n++}</td><td>${esc(line)}</td></tr>`);
  }
  return rows.length ? `<table class="diff">${rows.join('')}</table>` : `<div class="diff-empty">${t('没有文本差异（可能只改了权限或是空文件）')}</div>`;
}

async function revertChanges(mid, redo) {
  const m = S.messages.find((x) => x.id === mid); if (!m?.changes) return;
  const who = agentById(m.sender)?.name || m.sender;
  if (!redo && !(await confirmBox(t('撤销 {who} 这次对 {n} 个文件的改动？这些文件会回到这条回复开始之前的样子，之后还可以再恢复。', { who, n: m.changes.total }), { ok: t('撤销改动') }))) return;
  const url = `/api/chats/${encodeURIComponent(S.chatId)}/messages/${mid}/revert`;
  try {
    let r = await api('POST', url, { redo });
    if (r.conflicts) {
      const list = r.conflicts.slice(0, 5).join(t('、')) + (r.conflicts.length > 5 ? t(' 等 {n} 个', { n: r.conflicts.length }) : '');
      if (!(await confirmBox(t('{list} 在这之后又被修改过（可能是你或其他 AI 改的）。继续会覆盖这些后来的修改，确定吗？', { list }), { danger: true, ok: t('仍然继续') }))) return;
      r = await api('POST', url, { redo, force: true });
    }
    toast(t(redo ? '已恢复这些改动' : '已撤销，文件回到了之前的样子'), 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

const actBtn = (ic, title) => `<button class="act" data-act="${ic}" title="${title}">${icon(ic, 14)}</button>`;

function sysHtml(m) {
  if (m.kind === 'arena') return arenaHtml(m);
  const actions = [
    ...(m.term ? [`<button class="sys-btn" data-term="${m.term}">${icon('terminal', 13)} ${t('查看终端')}</button>`] : []),
    ...(m.actions || []).map((a) => `<button class="sys-btn" ${a.cmd ? `data-cmd="${esc(a.cmd)}"` : `data-goto="${esc(a.goto)}"`}>${esc(a.label)}</button>`),
  ].join('');
  if (m.markdown) return `<div class="sys-card" id="m-${m.id}"><div class="md">${md(m.text)}</div>${actions ? `<div class="sys-actions">${actions}</div>` : ''}</div>`;
  return `<div class="sys" id="m-${m.id}"><span>${renderMentions(esc(m.text))}</span>${actions}</div>`;
}

const STEP_ICON = { think: 'brain', result: 'check', error: 'alert', tool: 'tool' };
function stepsHtml(m) {
  if (!m.steps?.length) return '';
  const open = m.status === 'streaming' ? 'open' : '';
  const tools = m.steps.filter((s) => s.kind === 'tool' || !s.kind).length;
  const items = m.steps.slice(-80).map((s) => `<div class="step k-${s.kind || 'tool'}"><span class="s-ic">${icon(STEP_ICON[s.kind] || 'tool', 12)}</span>
    <div class="s-body"><div class="s-title">${esc(t(s.title))}</div>${s.detail ? `<pre>${esc(s.detail)}</pre>` : ''}</div></div>`).join('');
  return `<details class="steps" ${open}><summary>${icon('layers', 13)} ${t(m.status === 'streaming' ? '执行中' : '执行过程')} · ${t('{n} 次操作', { n: tools })} ${icon('chevron', 13)}</summary><div class="step-list">${items}</div></details>`;
}

export function patchMessage(m) {
  const el = document.getElementById('m-' + m.id);
  if (!el) return renderMessages();
  const box = $('#messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  const det = el.querySelector('details');
  const wasOpen = det?.open;
  const idx = S.messages.findIndex((x) => x.id === m.id);
  const prev = idx > 0 && fmtDay(S.messages[idx - 1].ts) === fmtDay(m.ts) ? S.messages[idx - 1] : null;
  const tmp = document.createElement('div'); tmp.innerHTML = msgHtml(m, prev);
  const fresh = tmp.firstElementChild;
  const fd = fresh.querySelector('details');
  if (fd && det && m.status === 'streaming') fd.open = wasOpen;
  const oldList = el.querySelector('.step-list');
  // 擂台卡片：正在作答的选手跟随最新输出，已完成的保持用户滚动到的位置
  const scrolls = new Map([...el.querySelectorAll('[data-entry] .ae-body')].map((b) => [b.closest('[data-entry]').dataset.entry, b.scrollTop]));
  el.replaceWith(fresh);
  const newList = fresh.querySelector('.step-list');
  if (oldList && newList) newList.scrollTop = newList.scrollHeight;
  for (const b of fresh.querySelectorAll('[data-entry] .ae-body')) {
    const entry = b.closest('[data-entry]');
    b.scrollTop = entry.classList.contains('running') ? b.scrollHeight : scrolls.get(entry.dataset.entry) || 0;
  }
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

// 流式输出时每帧都重新解析整段 Markdown 会越来越卡（文本越长越慢），限制到每 80ms 最多一次
const pending = new Map();
export function schedulePatch(id) {
  if (pending.has(id)) return;
  pending.set(id, setTimeout(() => {
    pending.delete(id);
    const cur = S.messages.find((x) => x.id === id);
    if (cur) requestAnimationFrame(() => patchMessage(cur));
  }, 80));
}

// ================= 发送 =================
export async function sendText(text) {
  if (!text || !S.chatId) return;
  try { await api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/messages`, { text }); }
  catch (e) { toast(e.message, 'error'); throw e; }
}
async function send() {
  const text = $('#input').value.trim();
  if (!text) return;
  // 新会话第一次干活前先确定工作目录，避免做出来的东西不知道放在哪
  if ((!text.startsWith('/') || /^\/arena\s+\S/.test(text)) && needsCwd(S.chat)) {
    hideSuggest();
    const ok = await chooseCwd(S.chat, { reason: t('开始之前，先选一个工作目录。') });
    if (!ok) return;
  }
  // 选择目录后会话会重绘，输入框已经换成新的元素，重新获取
  const input = $('#input');
  input.value = ''; autosize(); hideSuggest(); drafts.delete(S.chatId);
  history.unshift(text); histIdx = -1;
  try { await sendText(text); } catch { input.value = text; }
}
const history = [];
let histIdx = -1;

// ================= @ / 补全 =================
let sug = null; // { start, end, items, sel }
const FALLBACK_SLASH = {
  claude: ['init', 'review', 'compact', 'context', 'cost', 'config', 'mcp', 'permissions', 'memory', 'agents', 'doctor', 'resume'],
  terminal: ['model', 'status', 'init', 'compact', 'diff', 'mcp', 'review', 'new', 'approvals'],
};

function computeSuggest() {
  const input = $('#input'); if (!input || !S.chat) return hideSuggest();
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos);
  const c = S.chat;
  // / 命令：只在开头
  let m = before.match(/^\/([\w:-]*)$/);
  if (m) {
    const q = m[1].toLowerCase();
    const items = [];
    for (const cmd of S.commands) {
      if (cmd.group && c.type !== 'group') continue;
      if (q && !cmd.name.includes(q)) continue;
      items.push({ insert: '/' + cmd.name + ' ', title: '/' + cmd.name, args: cmd.args || '', sub: cmd.desc, ic: cmd.name === 'arena' ? 'swords' : 'zap', tag: 'Noe' });
    }
    const agents = c.type === 'dm' ? [agentById(c.members[0])] : c.members.map(agentById);
    for (const a of agents.filter(Boolean)) {
      if (!a.status?.installed) continue;
      const own = new Set(S.commands.map((x) => x.name));
      const list = (a.slash?.length ? a.slash : FALLBACK_SLASH[a.slashMode] || []).filter((n) => !own.has(n));
      for (const n of list) {
        if (q && !n.toLowerCase().includes(q)) continue;
        items.push({ insert: `/${n} ${c.type === 'group' ? '@' + a.id + ' ' : ''}`, title: '/' + n, sub: a.slashMode === 'claude' ? t('{name} 命令', { name: a.name }) : t('{name} 命令 · 在终端中打开', { name: a.name }), agent: a, tag: a.name });
      }
    }
    return items.length ? showSuggest(0, pos, items.slice(0, 60)) : hideSuggest();
  }
  m = before.match(/@([\w一-龥-]*)$/);
  if (m && c.type === 'group') {
    const q = m[1].toLowerCase();
    const pool = c.members.map(agentById).filter(Boolean);
    const items = [...pool.map((a) => ({ insert: '@' + a.id + ' ', title: a.name, sub: '@' + a.id + ' · ' + authInfo(a).label, agent: a })),
      ...(pool.length > 1 ? [{ insert: t('@所有人') + ' ', title: t('所有人'), sub: t('@所有人 · 同时派给全部成员'), ic: 'users' }] : [])]
      .filter((x) => !q || x.title.toLowerCase().includes(q) || x.insert.toLowerCase().includes(q));
    return items.length ? showSuggest(before.length - m[0].length, pos, items) : hideSuggest();
  }
  hideSuggest();
}
function showSuggest(start, end, items) {
  const keep = sug && sug.items.length === items.length ? Math.min(sug.sel, items.length - 1) : 0;
  sug = { start, end, items, sel: keep };
  drawSuggest();
}
function drawSuggest() {
  const box = $('#suggest');
  let lastTag = null;
  box.innerHTML = sug.items.map((it, i) => {
    const head = it.tag && it.tag !== lastTag ? `<div class="sg-head">${esc(t('{name} 命令', { name: it.tag }))}</div>` : '';
    lastTag = it.tag;
    return `${head}<div class="sg ${i === sug.sel ? 'sel' : ''}" data-i="${i}">
      ${it.agent && !it.title.startsWith('/') ? avatar(it.agent, 24) : `<span class="sg-ic">${icon(it.ic || 'slash', 14)}</span>`}
      <span class="sg-title">${esc(it.title)}${it.args ? ` <small>${esc(it.args)}</small>` : ''}</span><span class="sg-sub">${esc(it.sub || '')}</span></div>`;
  }).join('');
  box.classList.remove('hidden');
  box.querySelector('.sg.sel')?.scrollIntoView({ block: 'nearest' });
}
function hideSuggest() { sug = null; $('#suggest')?.classList.add('hidden'); }
function pickSuggest(i) {
  const it = sug.items[i]; const input = $('#input');
  input.value = input.value.slice(0, sug.start) + it.insert + input.value.slice(sug.end);
  const p = sug.start + it.insert.length;
  input.setSelectionRange(p, p); hideSuggest(); input.focus(); autosize();
}
function autosize() { const t = $('#input'); if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 240) + 'px'; }

// ================= API 来源菜单 =================
export function sourceMenu(anchor, a) {
  const cfg = a.config;
  const items = [{ header: `${a.name} · ${t('API 来源')}` }];
  const loginSub = a.auth ? (a.auth.loggedIn ? `${t('已登录')} · ${t(a.auth.detail)}` : t('未登录')) : t(a.officialLabel);
  items.push({ label: t('官方登录'), sub: loginSub, icon: 'login', check: cfg.mode === 'official', onClick: () => setCfg(a, { mode: 'official' }) });
  const ok = S.providers.filter((p) => fits(a, p));
  const no = S.providers.filter((p) => !fits(a, p));
  for (const p of ok) {
    items.push({ label: p.name, sub: p.hasKey ? t('{n} 个模型', { n: p.models.length }) : t('⚠ 未填写 API Key'), icon: logoTile(providerLogo(p), 18, esc(p.name.slice(0, 1)), 'mini'), check: cfg.mode === 'provider' && cfg.providerId === p.id, onClick: () => setCfg(a, { mode: 'provider', providerId: p.id, model: p.models.includes(cfg.model) ? cfg.model : '' }) });
  }
  for (const p of no) items.push({ label: p.name, sub: t('不兼容：缺少 {proto} 地址', { proto: a.protocols.map((k) => t(S.protocols[k])).join('/') }), icon: logoTile(providerLogo(p), 18, esc(p.name.slice(0, 1)), 'mini'), disabled: true });
  if (!a.noModel) {
    const info = authInfo(a);
    items.push({ divider: true }, { header: t('模型') });
    for (const m of modelChoices(a).slice(0, 5)) items.push({ label: t(m.name || m.id), sub: m.id, check: cfg.model === m.id, onClick: () => setCfg(a, { model: m.id }) });
    items.push({ label: t('全部模型与思考强度…'), sub: `${t('当前：')}${info.model}${info.effort ? ' · ' + effortName(info.effort) : ''}`, icon: 'sparkles', onClick: () => modelPicker(a) });
  }
  items.push({ divider: true });
  if (a.canLogin) items.push({ label: t(a.auth?.loggedIn ? '重新登录官方账号' : '登录官方账号'), icon: 'login', onClick: () => runLogin(a) });
  if (a.canLogout && a.auth?.loggedIn) items.push({ label: t('退出官方账号'), icon: 'logout', onClick: () => runLogin(a, true) });
  items.push({ label: t('管理模型厂商'), icon: 'key', onClick: () => emit('goto', 'providers') });
  menu(anchor, items, { align: 'right', width: 300 });
}
/** 当前 API 来源下可选的模型：官方目录或厂商的模型列表 */
export function modelChoices(a) {
  const p = a.config.mode === 'provider' ? providerById(a.config.providerId) : null;
  if (p) return p.models.map((id) => ({ id, ...(modelInfo(a.id, id) || { name: id }), name: modelInfo(a.id, id)?.name || id }));
  return S.models?.agents?.[a.id]?.models || [];
}

const TAG_CLS = { 推荐: 'accent', 最新: 'ok', 最强: 'violet', 快速: 'blue', 便宜: 'blue', 旧版: '' };

/** 模型选择器：搜索、说明、标签、思考强度 */
export function modelPicker(a) {
  let q = '';
  const efforts = () => {
    const cat = S.models?.agents?.[a.id];
    const sel = modelInfo(a.id, a.config.model);
    return sel?.efforts?.length ? sel.efforts : cat?.efforts || [];
  };
  modal({
    title: `${a.name} · ${t('选择模型')}`, width: 600,
    body: `<div class="mp-src">${avatar(a, 30)}<div><b>${esc(authInfo(a).label)}</b><small>${a.config.mode === 'provider' ? t('使用厂商 API 的模型列表') : esc(t(a.officialLabel || ''))}${S.models?.agents?.[a.id]?.live ? ' · ' + t('已从 CLI 实时读取') : ''}</small></div>
        <button class="btn xs" data-mp-src data-menu-anchor>${t('切换来源')}</button></div>
      <div class="search mp-search">${icon('search', 14)}<input id="mp-q" placeholder="${t('搜索或输入任意模型 ID，例如 opus、gpt-6、gemini-3.8-flash')}" autocomplete="off"></div>
      <div class="mp-list" id="mp-list"></div>
      <div id="mp-effort"></div>`,
    onMount: (el, close) => {
      const draw = () => {
        a = agentById(a.id) || a;
        const cur = a.config.model;
        const list = modelChoices(a);
        const ql = q.toLowerCase().replace(/\s+/g, '');
        const shown = list.filter((m) => !ql || (m.id + (m.name || '') + (m.desc || '') + t(m.desc || '')).toLowerCase().replace(/\s+/g, '').includes(ql));
        const custom = q.trim() && !list.some((m) => m.id === q.trim());
        el.querySelector('#mp-list').innerHTML = `
          ${!q ? `<button class="mp-item ${!cur ? 'on' : ''}" data-model="">${logoTile(null, 30, icon('sparkles', 15))}<div class="mp-main"><b>${t('默认')}</b><small>${t(a.config.mode === 'provider' ? '厂商列表里的第一个模型' : '由 CLI 自己决定')}</small></div>${!cur ? icon('check', 16) : ''}</button>` : ''}
          ${shown.map((m) => `<button class="mp-item ${cur === m.id ? 'on' : ''}" data-model="${esc(m.id)}">
            ${logoTile(modelLogo(m.id) || agentLogo(a), 30, esc((m.name || m.id).slice(0, 1)))}
            <div class="mp-main"><div class="mp-name"><b>${esc(t(m.name || m.id))}</b>${(m.tags || []).map((tag) => `<span class="mtag ${TAG_CLS[tag] ?? ''}">${esc(t(tag))}</span>`).join('')}</div>
              <small><code>${esc(m.id)}</code>${m.desc ? ' · ' + esc(t(m.desc)) : ''}</small></div>
            ${m.price ? `<span class="mp-price">${esc(m.price)}<i>${t('/百万 token')}</i></span>` : ''}${cur === m.id ? icon('check', 16) : ''}</button>`).join('')}
          ${custom ? `<button class="mp-item custom" data-model="${esc(q.trim())}"><div class="mp-main"><b>${t('使用自定义模型「{id}」', { id: esc(q.trim()) })}</b><small>${t('目录里没有也可以直接用，只要 CLI 或厂商支持')}</small></div>${icon('right', 16)}</button>` : ''}
          ${!shown.length && !custom ? `<p class="muted small" style="padding:8px">${t('没有模型')}</p>` : ''}`;
        const ef = efforts();
        el.querySelector('#mp-effort').innerHTML = ef.length && !a.noModel ? `<div class="mp-effort"><div><b>${t('思考强度')}</b><small>${t('越高越聪明，也越慢、越耗额度')}</small></div>
          <div class="seg">${['', ...ef].map((e) => `<button data-effort="${e}" class="${(a.config.effort || '') === e ? 'on' : ''}">${e ? esc(effortName(e)) : t('默认')}</button>`).join('')}</div></div>` : '';
      };
      el.querySelector('#mp-q').addEventListener('input', (e) => { q = e.target.value; draw(); });
      el.querySelector('#mp-q').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const first = el.querySelector('.mp-item[data-model]:not([data-model=""])') || el.querySelector('.mp-item'); first?.click(); }
      });
      el.addEventListener('click', async (e) => {
        const m = e.target.closest('[data-model]');
        if (m) { await setCfg(a, { model: m.dataset.model }); a.config.model = m.dataset.model; q = ''; el.querySelector('#mp-q').value = ''; draw(); return; }
        const ef = e.target.closest('[data-effort]');
        if (ef) { await setCfg(a, { effort: ef.dataset.effort }, true); a.config.effort = ef.dataset.effort; draw(); toast(`${t('思考强度')}: ${ef.dataset.effort ? effortName(ef.dataset.effort) : t('默认')}`, 'ok'); return; }
        const src = e.target.closest('[data-mp-src]');
        if (src) { close(); setTimeout(() => sourceMenu(document.querySelector(`[data-source="${a.id}"]`) || src, a), 200); }
      });
      draw();
      setTimeout(() => el.querySelector('#mp-q').focus(), 50);
    },
  });
}

async function setCfg(a, patch, silent) {
  try {
    await api('PUT', `/api/agents/${a.id}/config`, patch);
    if (silent) return;
    const label = patch.mode === 'official' ? t('官方登录') : patch.mode === 'provider' ? providerById(patch.providerId)?.name : null;
    toast(label ? t('{name} 已切换到 {target}', { name: a.name, target: label }) : t('{name} 的模型已切换为 {model}', { name: a.name, model: patch.model ? t(modelInfo(a.id, patch.model)?.name || patch.model) : t('默认') }), 'ok');
  } catch (e) { toast(e.message, 'error'); }
}
export async function runLogin(a, logout = false) {
  try {
    const { term } = await api('POST', `/api/agents/${a.id}/login`, { chatId: S.chatId, logout });
    emit('term.focus', term);
  } catch (e) { toast(e.message, 'error'); }
}

// ================= AI 擂台 =================
// 同一个任务交给几个 AI，各自在独立的项目副本里完成；默认盲评，选出胜者后它的改动才合并进工作目录
const AR_STATUS = { preparing: '正在复制项目…', running: '比赛中', done: '已完成', error: '出错了', stopped: '已停止' };
const arenaBase = (mid) => `/api/chats/${encodeURIComponent(S.chatId)}/messages/${mid}/arena`;
const entryName = (m, e) => (m.arena.blind && !m.arena.revealed ? t('选手 {x}', { x: e.label }) : agentById(e.agent)?.name || e.agent);

function arenaHtml(m) {
  const A = m.arena;
  const live = m.status === 'streaming';
  const hidden = A.blind && !A.revealed;
  // 赛后亮点：最快、最省
  const done = A.entries.filter((e) => e.status === 'done' && e.meta);
  const pick = (list, key) => (list.length > 1 ? list.reduce((x, y) => (y.meta[key] < x.meta[key] ? y : x)) : null);
  const fastest = live ? null : pick(done.filter((e) => e.meta.durationMs), 'durationMs');
  const cheapest = live ? null : pick(done.filter((e) => e.meta.cost), 'cost');
  const winner = A.winner && A.entries.find((e) => e.agent === A.winner);
  const sub = live ? t('{n} 位选手正在各自的项目副本里同时作答', { n: A.entries.length })
    : winner ? t('{name} 胜出', { name: agentById(winner.agent)?.name || winner.agent })
    : t('比赛结束，选出你最满意的方案');
  const actions = live ? `<button class="ch-btn" data-ar="stop">${icon('stop', 12)} ${t('停止比赛')}</button>`
    : hidden && !A.winner ? `<button class="ch-btn" data-ar="reveal">${icon('eye', 13)} ${t('揭晓身份')}</button>` : '';
  return `<div class="arena ${live ? 'live' : ''} ${A.winner ? 'decided' : ''} ${hidden ? 'blind' : ''}" id="m-${m.id}">
    <div class="ar-head"><span class="ar-badge">${icon('swords', 18)}</span>
      <div class="ar-title"><div><b>${t('AI 擂台')}</b>${A.blind ? `<span class="ar-mode">${t('盲评')}</span>` : ''}</div><small>${esc(sub)}</small></div>
      <span class="grow"></span>${actions}<span class="time">${fmtTime(m.ts)}</span></div>
    <div class="ar-task">${renderMentions(esc(A.task))}</div>
    ${A.git === false ? `<div class="ar-note">${icon('info', 13)} ${t('没有检测到 git，只能比较回答，无法比较和合并文件改动')}</div>` : ''}
    <div class="ar-grid" style="--n:${A.entries.length}">${A.entries.map((e) => arenaEntryHtml(m, e, { hidden, live, fastest: e === fastest, cheapest: e === cheapest })).join('')}</div>
    ${A.winner ? `<div class="ar-foot">${arenaBoard(A.entries.map((e) => e.agent), { compact: true })}</div>` : ''}
  </div>`;
}

function arenaEntryHtml(m, e, { hidden, live, fastest, cheapest }) {
  const A = m.arena;
  const a = agentById(e.agent);
  const busy = ['preparing', 'running'].includes(e.status);
  const meta = e.meta || {};
  const av = hidden ? `<div class="avatar ar-anon" style="--s:30px">${esc(e.label)}</div>` : avatar(a, 30);
  const tags = [
    A.winner === e.agent ? `<span class="ar-tag win">${icon('trophy', 11)} ${t('胜出')}</span>` : '',
    fastest ? `<span class="ar-tag fast">${icon('zap', 11)} ${t('最快')}</span>` : '',
    cheapest ? `<span class="ar-tag cheap">$ ${t('最省')}</span>` : '',
  ].join('');
  const stats = [
    meta.durationMs && !busy ? fmtMs(meta.durationMs) : '',
    meta.cost ? '$' + meta.cost.toFixed(meta.cost < 0.01 ? 4 : 3) : '',
    meta.inTok || meta.outTok ? `${fmtNum(meta.inTok)} → ${fmtNum(meta.outTok)} tok` : '',
  ].filter(Boolean).map(esc).join(' · ');
  const body = e.text ? md(e.text, { streaming: busy })
    : busy ? `<span class="thinking"><span class="typing-dots"><i></i><i></i><i></i></span>${esc(t(e.status === 'preparing' ? AR_STATUS.preparing : e.lastStep || '思考中'))}</span>`
    : e.error ? '' : `<span class="muted">${t('（没有输出）')}</span>`;
  const changes = e.changes ? `<div class="ae-files"><div class="ae-fh">${t('改动了 {n} 个文件', { n: e.changes.total })}<span class="ch-stat">${nums(e.changes)}</span></div>
      ${fileRows(e.changes.files.slice(0, 4), { title: t('查看这个文件的差异') })}${e.changes.total > 4 ? `<div class="ch-file more" data-ar="diff">${t('还有 {n} 个文件…', { n: e.changes.total - 4 })}</div>` : ''}</div>`
    : !busy && A.git !== false && e.status === 'done' ? `<div class="ae-files none">${t('没有改动文件')}</div>` : '';
  // 出错 / 被停止的选手只有留下了文件改动才值得选
  const canPick = !live && !A.winner && (e.status === 'done' ? e.text || e.changes : !busy && e.changes);
  return `<div class="ar-entry ${e.status} ${A.winner === e.agent ? 'winner' : A.winner ? 'loser' : ''}" data-entry="${esc(e.agent)}" style="--c:${hidden ? 'var(--accent)' : a?.color || 'var(--accent)'}">
    <div class="ae-top">${av}<div class="ae-name"><b>${esc(entryName(m, e))}</b>${!hidden && meta.model ? `<small>${esc(meta.model)}</small>` : ''}</div><span class="grow"></span>
      <span class="ae-status ${e.status}">${busy ? '<span class="spinner"></span>' : ''}${t(AR_STATUS[e.status] || e.status)}</span></div>
    ${tags ? `<div class="ae-tags">${tags}</div>` : ''}
    ${busy && e.steps ? `<div class="ae-step">${icon('layers', 12)} <span>${t('{n} 次操作', { n: e.steps })} · ${esc(t(e.lastStep))}</span></div>` : ''}
    <div class="ae-body md">${body}</div>
    ${e.error ? `<div class="err-card">${icon('alert', 16)}<div><b>${t('运行出错')}</b><pre>${esc(e.error)}</pre></div></div>` : ''}
    ${changes}
    ${stats ? `<div class="ae-stats">${stats}</div>` : ''}
    ${busy ? '' : `<div class="ae-actions">
      <button class="ch-btn" data-ar="view">${icon('maximize', 12)} ${t('完整回答')}</button>
      ${e.changes ? `<button class="ch-btn" data-ar="diff">${icon('eye', 13)} ${t('查看改动')}</button>` : ''}
      ${e.dir ? `<button class="ch-btn icon-only" data-ar="open" title="${t('打开这位选手的项目副本')}">${icon('folder', 13)}</button>` : ''}
      <span class="grow"></span>
      ${canPick ? `<button class="ch-btn pick" data-ar="pick">${icon('trophy', 13)} ${t('选它')}</button>` : ''}</div>`}
  </div>`;
}

/** 擂台战绩：ids 为空时显示所有 AI */
function arenaBoard(ids, { compact } = {}) {
  const stats = S.arenaStats || {};
  const rows = (ids?.length ? ids : Object.keys(stats)).filter((id) => stats[id]?.played)
    .map((id) => ({ id, a: agentById(id), ...stats[id] }))
    .sort((x, y) => y.wins - x.wins || y.wins / y.played - x.wins / x.played);
  if (!rows.length) return '';
  const top = Math.max(...rows.map((r) => r.wins), 1);
  return `<div class="ar-board ${compact ? 'compact' : ''}">${compact ? '' : `<div class="panel-title">${icon('trophy', 13)} ${t('擂台战绩')}</div>`}
    ${rows.map((r, i) => `<div class="ab-row">${compact ? '' : `<span class="ab-rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>`}${avatar(r.a, compact ? 18 : 22)}
      <span class="ab-name">${esc(r.a?.name || r.id)}</span><span class="ab-bar"><i style="width:${(r.wins / top) * 100}%;--c:${r.a?.color || 'var(--accent)'}"></i></span>
      <span class="ab-num">${t('{w} 胜 / {p} 场', { w: r.wins, p: r.played })}</span></div>`).join('')}</div>`;
}

async function arenaAction(btn) {
  const card = btn.closest('.arena'); if (!card) return;
  const mid = card.id.slice(2);
  const m = S.messages.find((x) => x.id === mid); if (!m) return;
  const agentId = btn.closest('[data-entry]')?.dataset.entry;
  const e = m.arena.entries.find((x) => x.agent === agentId);
  const act = btn.dataset.ar || (btn.dataset.chFile ? 'diff' : '');
  try {
    if (act === 'stop') await api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/stop`, { messageId: mid });
    if (act === 'reveal') await api('POST', `${arenaBase(mid)}/reveal`);
    if (act === 'view') showArenaEntry(m, e);
    if (act === 'diff' && e?.changes) {
      diffViewer({ changes: e.changes, file: btn.dataset.chFile, who: entryName(m, e), url: (p) => `${arenaBase(mid)}/${encodeURIComponent(e.agent)}/diff?path=${encodeURIComponent(p)}` });
    }
    if (act === 'open') await api('POST', `${arenaBase(mid)}/${encodeURIComponent(e.agent)}/open`);
    if (act === 'pick') {
      const name = entryName(m, e);
      const msg = e.changes
        ? t('选 {name} 为胜者？它改动的 {n} 个文件会合并到工作目录（之后可以在它的回复下一键撤销），其他选手的改动会被丢弃。', { name, n: e.changes.total })
        : t('选 {name} 为胜者？它的回答会作为一条回复加入对话。', { name });
      if (!(await confirmBox(msg, { ok: t('就选它') }))) return;
      const r = await api('POST', `${arenaBase(mid)}/${encodeURIComponent(e.agent)}/adopt`);
      toast(r.files ? t('{name} 胜出！已合并 {n} 个文件的改动', { name: agentById(e.agent)?.name || e.agent, n: r.files }) : t('{name} 胜出！', { name: agentById(e.agent)?.name || e.agent }), 'ok');
      celebrate(card.querySelector(`[data-entry="${CSS.escape(e.agent)}"]`));
    }
  } catch (err) { toast(err.message, 'error'); }
}

/** 胜出时在卡片上撒一把彩纸 */
function celebrate(el) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = 'confetti';
  Object.assign(box.style, { left: r.left + r.width / 2 + 'px', top: r.top + 24 + 'px' });
  const colors = ['#18181b', '#3f3f46', '#71717a', '#a1a1aa', '#d4d4d8', '#f4f4f5'];
  box.innerHTML = Array.from({ length: 36 }, (_, i) => `<i style="--x:${Math.cos(i) * (60 + (i * 37) % 120)}px;--y:${-60 - (i * 53) % 140}px;--r:${(i * 47) % 360}deg;background:${colors[i % colors.length]};animation-delay:${(i % 6) * 12}ms"></i>`).join('');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1600);
}

function showArenaEntry(m, e) {
  if (!e) return;
  const hidden = m.arena.blind && !m.arena.revealed;
  modal({
    title: `${entryName(m, e)}${!hidden && e.meta?.model ? ' · ' + e.meta.model : ''}`, width: 760,
    body: `<div class="ar-full"><div class="md">${e.text ? md(e.text) : `<p class="muted">${t('（没有输出）')}</p>`}</div>
      ${e.error ? `<div class="err-card">${icon('alert', 16)}<div><b>${t('运行出错')}</b><pre>${esc(e.error)}</pre></div></div>` : ''}</div>`,
  });
}

/** 发起擂台：写任务、挑选手、选择是否盲评 */
export function arenaDialog({ task = '' } = {}) {
  const c = S.chat; if (!c) return;
  const installed = S.agents.filter((a) => a.status?.installed);
  const pick = new Set(c.members.filter((id) => installed.some((a) => a.id === id)));
  // 私聊里默认再拉一位已安装的 AI 来比
  if (c.type === 'dm') for (const a of installed) { if (pick.size >= 2) break; pick.add(a.id); }
  const draw = (el) => {
    el.querySelector('#ar-pick').innerHTML = installed.map((a) => `<button class="pick ${pick.has(a.id) ? 'on' : ''}" data-pick="${a.id}">
      ${avatar(a, 30)}<span>${esc(a.name)}<small>${esc(authInfo(a).model || authInfo(a).label)}</small></span>${icon('check', 14)}</button>`).join('')
      || `<p class="muted small">${t('还没有安装 AI 工具')}</p>`;
    el.querySelector('#ar-count').textContent = t('已选 {n} 位', { n: pick.size });
  };
  modal({
    title: t('AI 擂台'), width: 600,
    body: `<div class="ar-intro">${icon('swords', 22)}<p>${t('几个 AI 同时做同一个任务，各自在独立的项目副本里干活、互不干扰。比完之后由你来评选，只有胜者的改动会合并进工作目录。')}</p></div>
      <label class="field"><span>${t('任务')}</span><textarea id="ar-task" rows="3" placeholder="${t('例如：给首页加一个深色模式切换按钮')}">${esc(task)}</textarea></label>
      <div class="field"><span>${t('选手（至少两位）')} · <em id="ar-count"></em></span><div class="pick-grid" id="ar-pick"></div></div>
      <label class="ar-blind"><input type="checkbox" id="ar-blind" checked><span><b>${t('盲评')}</b><small>${t('比赛时隐藏选手身份，选完胜者再揭晓，评得更公平')}</small></span></label>`,
    onMount: (el) => {
      draw(el);
      el.querySelector('#ar-pick').onclick = (ev) => { const b = ev.target.closest('[data-pick]'); if (!b) return; const id = b.dataset.pick; pick.has(id) ? pick.delete(id) : pick.add(id); draw(el); };
      setTimeout(() => el.querySelector('#ar-task').focus(), 50);
    },
    actions: [{ label: t('取消') }, {
      label: t('开始比赛'), primary: true, onClick: async (el) => {
        const text = el.querySelector('#ar-task').value.trim();
        if (!text) { toast(t('先写上要比的任务'), 'error'); return false; }
        if (pick.size < 2) { toast(t('至少选两位选手'), 'error'); return false; }
        if (needsCwd(S.chat) && !(await chooseCwd(S.chat, { reason: t('开始之前，先选一个工作目录。') }))) return false;
        await api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/arena`, { task: text, members: [...pick], blind: el.querySelector('#ar-blind').checked });
      },
    }],
  });
}

// ================= 新建群聊 =================
export function openNewGroup(preset = []) {
  const pick = new Set(preset);
  const draw = (el) => {
    el.querySelector('#ng-pick').innerHTML = S.agents.map((a) => `<button class="pick ${pick.has(a.id) ? 'on' : ''}" data-pick="${a.id}">
      ${avatar(a, 30)}<span>${esc(a.name)}<small>${a.status?.installed ? authInfo(a).label : t('未安装')}</small></span>${icon('check', 14)}</button>`).join('');
  };
  modal({
    title: t('新建群聊'), width: 520,
    body: `<label class="field"><span>${t('群名称')}</span><input id="ng-name" placeholder="${t('例如：全栈小分队')}"></label>
      <div class="field"><span>${t('选择成员（之后也可以拖进来）')}</span><div class="pick-grid" id="ng-pick"></div></div>
      <div class="field"><span>${t('工作目录（建议选择你的项目文件夹）')}</span><div class="cwd-input"><input id="ng-cwd" placeholder="${t('留空则使用默认工作区')}"><button class="btn sm" id="ng-pick-dir">${icon('folder', 14)} ${t('选择…')}</button></div></div>`,
    onMount: (el) => {
      draw(el);
      el.querySelector('#ng-pick-dir').onclick = async () => {
        try { const r = await api('POST', '/api/pick-folder', { prompt: t('选择群聊的工作目录') }); if (r.path) el.querySelector('#ng-cwd').value = r.path; }
        catch (er) { toast(er.message, 'error'); }
      };
      el.querySelector('#ng-pick').onclick = (e) => { const b = e.target.closest('[data-pick]'); if (!b) return; const id = b.dataset.pick; pick.has(id) ? pick.delete(id) : pick.add(id); draw(el); };
      setTimeout(() => el.querySelector('#ng-name').focus(), 50);
    },
    actions: [{ label: t('取消') }, {
      label: t('创建群聊'), primary: true, onClick: async (el) => {
        const members = [...pick];
        const name = el.querySelector('#ng-name').value.trim() || members.map((id) => agentById(id)?.name).join(t('、')) || t('新群聊');
        const chat = await api('POST', '/api/chats', { name, members, cwd: el.querySelector('#ng-cwd').value.trim() });
        if (!S.chats.some((c) => c.id === chat.id)) S.chats.push({ ...chat, last: null });
        emit('goto', 'chat');
        openChat(chat.id);
      },
    }],
  });
}

export async function createTemplateGroup(name, ids) {
  const members = ids.filter((id) => agentById(id));
  const chat = await api('POST', '/api/chats', { name, members });
  // 先放进本地列表再打开，不必等刷新回来
  if (!S.chats.some((c) => c.id === chat.id)) S.chats.push({ ...chat, last: null });
  emit('goto', 'chat');
  await openChat(chat.id);
}

async function setMembers(gid, members) {
  try { await api('PATCH', `/api/chats/${gid}`, { members }); } catch (e) { toast(e.message, 'error'); }
}

// ================= 欢迎页 =================
function welcomeHtml() {
  const installed = S.agents.filter((a) => a.status?.installed);
  const loggedOrProvider = S.agents.filter((a) => a.status?.installed && (a.config.mode === 'provider' || a.auth?.loggedIn));
  const steps = [
    { n: 1, title: t('安装 AI 工具'), desc: installed.length ? t('已安装 {n} 个：{list}', { n: installed.length, list: installed.map((a) => a.name).join(t('、')) }) : t('一键安装 Claude Code、Codex 等'), done: installed.length > 0, goto: 'tools', btn: t('去安装') },
    { n: 2, title: t('登录或配置 API'), desc: S.providers.length ? t('已添加 {n} 个模型厂商', { n: S.providers.length }) : t('官方账号登录，或添加 DeepSeek / GLM / Kimi 等厂商'), done: loggedOrProvider.length > 0, goto: 'providers', btn: t('配置厂商') },
    { n: 3, title: t('开始协作'), desc: t('私聊任意 AI，或者拉个群用 @ 派活'), done: S.chats.some((c) => c.last), action: 'group', btn: t('新建群聊') },
  ];
  const tpl = [
    { name: t('全栈小分队'), ids: ['claude', 'codex'], desc: t('Claude 写功能，Codex 写测试和审查') },
    { name: t('代码评审会'), ids: ['claude', 'codex', 'gemini'], desc: t('多个 AI 交叉审查同一份代码') },
    { name: t('AI 擂台'), ids: ['claude', 'codex', 'gemini'], desc: t('同一个任务让几个 AI 比一比，盲评选出最好的') },
  ];
  return `<div class="welcome">
    <div class="hero"><img src="icon.svg" alt=""><h1>Noe Agent <span class="beta-tag">Beta</span></h1><p>${t('把所有 AI 编程助手装进一个聊天软件，私聊、拉群、@ 谁就谁来干活。')}</p></div>
    <div class="steps-row">${steps.map((s) => `<div class="step-card ${s.done ? 'done' : ''}">
      <div class="sc-n">${s.done ? icon('check', 16) : s.n}</div><h4>${s.title}</h4><p>${esc(s.desc)}</p>
      <button class="btn ${s.done ? '' : 'primary'} sm" ${s.goto ? `data-goto="${s.goto}"` : 'data-new-group'}>${s.btn}</button></div>`).join('')}</div>
    <div class="tpl-title">${t('群聊模板')}</div>
    <div class="tpl-row">${tpl.map((x) => `<button class="tpl" data-tpl="${esc(x.name)}" data-ids="${x.ids.join(',')}">
      <div class="tpl-av">${x.ids.map((id) => agentById(id)).filter(Boolean).map((a) => avatar(a, 28)).join('')}</div>
      <b>${esc(x.name)}</b><small>${esc(x.desc)}</small></button>`).join('')}</div>
    <div class="kbd-tips"><span><kbd>⌘</kbd><kbd>K</kbd> ${t('快速切换')}</span><span><kbd>/</kbd> ${t('命令')}</span><span><kbd>@</kbd> ${t('提及成员')}</span><span><kbd>⌘</kbd><kbd>J</kbd> ${t('终端')}</span></div>
  </div>`;
}

// ================= 事件绑定 =================
function bindChat() {
  const input = $('#input');
  input.addEventListener('input', () => { autosize(); computeSuggest(); });
  input.addEventListener('click', computeSuggest);
  input.addEventListener('blur', () => setTimeout(hideSuggest, 150));
  input.addEventListener('keydown', (e) => {
    if (sug) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sug.sel = (sug.sel + (e.key === 'ArrowDown' ? 1 : -1) + sug.items.length) % sug.items.length; return drawSuggest(); }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const it = sug.items[sug.sel];
        // 无参数的 Noe 命令：回车直接执行
        if (e.key === 'Enter' && it.tag === 'Noe' && !it.args && input.value.trim() === it.title.slice(0, input.value.trim().length) && !e.shiftKey) {
          e.preventDefault(); input.value = it.title; return send();
        }
        e.preventDefault(); return pickSuggest(sug.sel);
      }
      if (e.key === 'Escape') { e.preventDefault(); return hideSuggest(); }
    }
    if (e.key === 'ArrowUp' && !input.value && history.length) { e.preventDefault(); histIdx = Math.min(histIdx + 1, history.length - 1); input.value = history[histIdx]; autosize(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $('#suggest').addEventListener('mousedown', (e) => { const o = e.target.closest('[data-i]'); if (o) { e.preventDefault(); pickSuggest(+o.dataset.i); } });
  $('#btn-send').onclick = send;
  $('#btn-slash').onclick = () => { input.value = '/'; input.focus(); input.setSelectionRange(1, 1); computeSuggest(); };
  $('#btn-at') && ($('#btn-at').onclick = () => { const p = input.selectionStart; input.value = input.value.slice(0, p) + '@' + input.value.slice(p); input.focus(); input.setSelectionRange(p + 1, p + 1); computeSuggest(); });
  $('#btn-model') && ($('#btn-model').onclick = () => { const a = agentById(S.chat.members[0]); if (a) modelPicker(a); });
  $('#btn-arena').onclick = () => arenaDialog({ task: input.value.trim().startsWith('/') ? '' : input.value.trim() });
  $('#btn-stop').onclick = () => api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/stop`);
  $('#btn-folder').onclick = () => api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/open-folder`);
  $('#chat-title').addEventListener('click', (e) => { const b = e.target.closest('[data-cwd-menu]'); if (b) cwdMenu(b); });
  $('#btn-term').onclick = (e) => {
    const c = S.chat;
    const items = c.members.map(agentById).filter(Boolean).map((a) => ({ label: t('{name} 交互终端', { name: a.name }), sub: t(c.sessions?.[a.id] ? '续接当前会话' : '新会话'), icon: avatar(a, 18), disabled: !a.status?.installed, onClick: () => sendText(`/terminal @${a.id}`) }));
    menu(e.currentTarget, [...items, { divider: true }, { label: t('系统终端（工作目录）'), icon: 'terminal', onClick: () => sendText('/shell') }], { align: 'right', width: 260 });
  };
  $('#btn-members') && ($('#btn-members').onclick = (e) => {
    const m = $('#members'); m.classList.toggle('hidden'); e.currentTarget.classList.toggle('on', !m.classList.contains('hidden'));
    try { localStorage.setItem('noe.members', m.classList.contains('hidden') ? '0' : '1'); } catch { /* 忽略 */ }
  });
  $('#btn-more').onclick = (e) => {
    const c = S.chat;
    menu(e.currentTarget, [
      { label: t('开启新会话'), sub: t('保留聊天记录，重置 AI 上下文'), icon: 'refresh', onClick: () => sendText('/new') },
      { label: t('查看成员状态'), icon: 'info', onClick: () => sendText('/status') },
      { label: t('AI 擂台…'), sub: t('几个 AI 同时做同一个任务，盲评选最佳'), icon: 'swords', onClick: () => arenaDialog() },
      { label: t('擂台排行榜'), icon: 'trophy', onClick: () => sendText('/arena') },
      ...(c.type === 'group' ? [{ label: t(c.pinned ? '取消置顶' : '置顶群聊'), icon: 'pin', onClick: () => api('PATCH', `/api/chats/${c.id}`, { pinned: !c.pinned }) }] : []),
      { label: t('切换工作目录'), icon: 'folder', onClick: () => chooseCwd(c) },
      { label: t('导出聊天记录'), sub: t('保存为 Markdown 文件'), icon: 'download', onClick: () => exportChat(c.id) },
      { divider: true },
      { label: t('清空聊天记录'), icon: 'trash', danger: true, onClick: async () => { if (await confirmBox(t('清空本会话的聊天记录，并重置所有 AI 的上下文？'), { danger: true, ok: t('清空') })) sendText('/clear'); } },
      ...(c.type === 'group' ? [{ label: t('解散群聊'), icon: 'x', danger: true, onClick: deleteGroup }] : []),
    ], { align: 'right', width: 240 });
  };
  const box = $('#messages');
  box.addEventListener('scroll', () => { $('#jump').classList.toggle('hidden', box.scrollHeight - box.scrollTop - box.clientHeight < 300); });
  $('#jump').onclick = () => box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  box.addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp) return copyText(cp.closest('.code').querySelector('code').innerText);
    if (e.target.closest('[data-choose-cwd]')) return chooseCwd(S.chat);
    const fill = e.target.closest('[data-fill]');
    if (fill) { input.value = fill.dataset.fill; autosize(); input.focus(); return; }
    const ar = e.target.closest('[data-ar], .ar-entry [data-ch-file]');
    if (ar) return arenaAction(ar);
    const ch = e.target.closest('[data-ch], [data-ch-file]');
    if (ch && !ch.closest('.arena')) {
      const mid = ch.closest('.msg').id.slice(2);
      const m = S.messages.find((x) => x.id === mid);
      if (m?.changes?.expired) return toast(t('快照已清理，无法查看或撤销'));
      if (ch.dataset.chFile) return showDiff(mid, ch.dataset.chFile);
      if (ch.dataset.ch === 'diff') return showDiff(mid);
      return revertChanges(mid, ch.dataset.ch === 'redo');
    }
    if (e.target.closest('#load-more')) {
      const h = box.scrollHeight;
      shown += PAGE; renderMessages();
      box.scrollTop = box.scrollHeight - h; // 保持当前看到的位置不跳
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const id = act.closest('.msg').id.slice(2);
    const m = S.messages.find((x) => x.id === id);
    if (!m) return;
    if (act.dataset.act === 'copy') copyText(m.text);
    if (act.dataset.act === 'edit') { input.value = m.text; autosize(); input.focus(); input.setSelectionRange(m.text.length, m.text.length); computeSuggest(); }
    if (act.dataset.act === 'stop') api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/stop`, { messageId: id }).catch((err) => toast(err.message, 'error'));
    if (act.dataset.act === 'refresh') api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/retry`, { messageId: id }).catch((err) => toast(err.message, 'error'));
    if (act.dataset.act === 'trash') api('DELETE', `/api/chats/${encodeURIComponent(S.chatId)}/messages/${id}`);
  });
  const members = $('#members');
  if (members) {
    members.addEventListener('click', (e) => {
      const x = e.target.closest('[data-remove]'); if (x) return setMembers(S.chatId, S.chat.members.filter((m) => m !== x.dataset.remove));
      const c = e.target.closest('[data-add]'); if (c) return setMembers(S.chatId, [...S.chat.members, c.dataset.add]);
      if (e.target.closest('#btn-del-group')) deleteGroup();
    });
    members.addEventListener('change', (e) => {
      if (e.target.id === 'group-name') api('PATCH', `/api/chats/${S.chatId}`, { name: e.target.value.trim() || S.chat.name });
      if (e.target.id === 'group-cwd') api('PATCH', `/api/chats/${S.chatId}`, { cwd: e.target.value.trim() }).then(() => openChat(S.chatId));
    });
  }
}
async function exportChat(id) {
  try {
    const { name, markdown } = await api('GET', `/api/chats/${encodeURIComponent(id)}/export`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(t('已导出 {name}', { name }), 'ok');
  } catch (e) { toast(e.message, 'error'); }
}
async function deleteGroup() {
  if (await confirmBox(t('解散群聊「{name}」？聊天记录会被删除。', { name: S.chat.name }), { danger: true, ok: t('解散') })) await api('DELETE', `/api/chats/${S.chatId}`);
}

// ================= 拖拽拉群 =================
export function setupDnD() {
  document.addEventListener('dragstart', (e) => {
    const it = e.target.closest?.('[data-agent]');
    if (!it) return;
    e.dataTransfer.setData('text/noe-agent', it.dataset.agent);
    e.dataTransfer.effectAllowed = 'copy';
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragend', () => { document.body.classList.remove('dragging'); $$('.drag-over').forEach((x) => x.classList.remove('drag-over')); });
  const targetOf = (e) => e.target.closest?.('[data-group], #drop-new, #member-drop, #members, .messages-wrap');
  const groupOk = () => S.chat?.type === 'group';
  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/noe-agent')) return;
    const tg = targetOf(e);
    if (!tg || (['members', 'member-drop'].includes(tg.id) || tg.classList.contains('messages-wrap')) && !groupOk()) return;
    e.preventDefault();
    const hl = tg.id === 'members' ? $('#member-drop') : tg;
    $$('.drag-over').forEach((x) => x !== hl && x.classList.remove('drag-over'));
    hl.classList.add('drag-over');
  });
  document.addEventListener('drop', async (e) => {
    const id = e.dataTransfer.getData('text/noe-agent');
    document.body.classList.remove('dragging');
    $$('.drag-over').forEach((x) => x.classList.remove('drag-over'));
    const tg = targetOf(e);
    if (!id || !tg) return;
    e.preventDefault();
    if (tg.id === 'drop-new') return openNewGroup([id]);
    const gid = tg.dataset.group || S.chatId;
    const chat = S.chats.find((c) => c.id === gid);
    if (!chat || chat.type !== 'group') return;
    if (chat.members.includes(id)) return toast(t('{name} 已经在群里了', { name: agentById(id).name }));
    await setMembers(gid, [...chat.members, id]);
    toast(t('已把 {name} 拉进「{chat}」', { name: agentById(id).name, chat: chat.name }), 'ok');
  });
}

// ================= 快速切换 + 搜索消息（⌘K） =================
export function quickSwitch() {
  const all = [
    ...S.agents.map((a) => ({ id: 'dm-' + a.id, name: a.name, sub: t('私聊') + ' · ' + authInfo(a).label, av: avatar(a, 28) })),
    ...S.chats.filter((c) => c.type === 'group').map((c) => ({ id: c.id, name: c.name, sub: `${t('群聊')} · ${t('{n} 位成员', { n: c.members.length })}`, av: groupAvatar(c, 28) })),
  ];
  let sel = 0, list = all, hits = [], timer = null, seq = 0;
  const chatName = (id) => id.startsWith('dm-') ? agentById(id.slice(3))?.name || id : S.chats.find((c) => c.id === id)?.name || id;
  const m = modal({
    title: t('快速切换'), width: 520,
    body: `<input class="qs-input" id="qs" placeholder="${t('搜索 AI、群聊或聊天记录…')}"><div class="qs-list" id="qs-list"></div>`,
    onMount: (el, close) => {
      const items = () => [...list, ...hits];
      const draw = () => {
        const msgHead = hits.length ? `<div class="qs-sec">${t('聊天记录')}</div>` : '';
        el.querySelector('#qs-list').innerHTML = (list.map((x, i) => row(x, i)).join('') + msgHead + hits.map((x, i) => row(x, list.length + i)).join(''))
          || `<div class="muted" style="padding:12px">${t('没有匹配项')}</div>`;
        el.querySelector('.qs-item.sel')?.scrollIntoView({ block: 'nearest' });
      };
      const row = (x, i) => `<div class="qs-item ${i === sel ? 'sel' : ''} ${x.msg ? 'msg' : ''}" data-i="${i}">${x.av}<span>${esc(x.name)}</span><small>${x.msg ? x.sub : esc(x.sub)}</small></div>`;
      const go = (i) => { const x = items()[i]; if (x) { close(); emit('goto', 'chat'); openChat(x.chatId || x.id, { focus: x.msg }); } };
      const q = el.querySelector('#qs');
      q.oninput = () => {
        const s = q.value.trim().toLowerCase();
        list = all.filter((x) => x.name.toLowerCase().includes(s) || x.sub.toLowerCase().includes(s)); sel = 0; hits = []; draw();
        clearTimeout(timer);
        if (s.length < 2) return;
        const my = ++seq;
        timer = setTimeout(async () => {
          try {
            const { results } = await api('GET', '/api/search?q=' + encodeURIComponent(s));
            if (my !== seq) return;
            hits = results.map((r) => {
              const a = agentById(r.sender);
              const hl = esc(r.snippet).replace(new RegExp(esc(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (x) => `<mark>${x}</mark>`);
              return { chatId: r.chatId, msg: r.id, name: `${chatName(r.chatId)} · ${r.sender === 'user' ? t('我') : a?.name || r.sender}`, sub: hl, av: a ? avatar(a, 28) : `<span class="qs-ic">${icon('search', 15)}</span>` };
            });
            draw();
          } catch { /* 忽略 */ }
        }, 200);
      };
      q.onkeydown = (e) => {
        const n = items().length;
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, n - 1); draw(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
        if (e.key === 'Enter' && !e.isComposing) go(sel);
      };
      el.querySelector('#qs-list').onclick = (e) => { const it = e.target.closest('[data-i]'); if (it) go(+it.dataset.i); };
      draw(); setTimeout(() => q.focus(), 30);
    },
  });
  return m;
}
