// 聊天：会话列表、消息流、输入框（@ 与 / 补全）、拖拽拉群、API 来源切换
import {
  $, $$, esc, S, api, toast, icon, avatar, groupAvatar, agentById, providerById, fmtTime, fmtDay, fmtNum, fmtMs,
  authInfo, fits, menu, modal, confirmBox, copyText, emit, modelInfo, effortName,
} from './core.js';
import { md, renderMentions } from './markdown.js';

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
    const preview = c?.busy ? '<span class="typing-dots"><i></i><i></i><i></i></span> 正在输入' : esc(c?.last ? previewText(c.last) : on ? `${info.label}${info.model ? ' · ' + info.model : ''}` : a.installing ? '安装中…' : '未安装');
    return `<div class="item ${S.chatId === 'dm-' + a.id ? 'active' : ''} ${on ? '' : 'dim'}" draggable="true" data-agent="${a.id}" data-chat="dm-${a.id}">
      ${avatar(a, 38)}
      <div class="meta">
        <div class="row1"><span class="title">${esc(a.name)}</span>${c?.last ? `<span class="time">${fmtTime(c.last.ts)}</span>` : on ? '' : '<span class="badge-soft">未安装</span>'}</div>
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
        <div class="row2"><span class="preview">${c.busy ? '<span class="typing-dots"><i></i><i></i><i></i></span> 有成员在干活' : esc(c.last ? previewText(c.last) : `${c.members.length} 位成员`)}</span>${isUnread(c) ? '<span class="unread"></span>' : ''}</div>
      </div></div>`).join('')
    || `<div class="side-empty">还没有群聊<br><small>把上面的 AI 拖到下方虚线框里试试</small></div>`;
  $('#group-count').textContent = groups.length || '';
}
function previewText(m) {
  const who = m.sender === 'user' ? '我' : m.sender === 'system' ? '' : agentById(m.sender)?.name || m.sender;
  const t = m.status === 'streaming' ? '正在输入…' : (m.text || (m.error ? '出错了' : '')).replace(/[#*`>|_-]+/g, '').replace(/\s+/g, ' ');
  return (who ? who + '：' : '') + t;
}

// ================= 打开会话 =================
export async function openChat(id) {
  S.chatId = id;
  // 加载期间到达的实时事件会被丢弃，所以加载完若有新事件就再取一次
  S.chatLoading = id; S.chatDirty = false;
  let res = await api('GET', '/api/chats/' + encodeURIComponent(id));
  if (S.chatDirty && S.chatId === id) res = await api('GET', '/api/chats/' + encodeURIComponent(id));
  S.chatLoading = null;
  const { chat, messages } = res;
  if (S.chatId !== id) return;
  S.chat = chat; S.messages = messages;
  if (!S.chats.find((c) => c.id === id)) S.chats.push({ ...chat, last: messages.at(-1) || null });
  markRead(id);
  try { localStorage.setItem('noe.lastChat', id); } catch { /* 忽略 */ }
  renderChatShell();
  renderSidebar();
  $('#input')?.focus();
}

export function closeChat() {
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
        <button class="icon-btn ghost" id="btn-folder" title="打开工作目录">${icon('folder')}</button>
        <button class="icon-btn ghost" id="btn-term" title="打开终端（/terminal）">${icon('terminal')}</button>
        ${c.type === 'group' ? `<button class="icon-btn ghost ${membersOpen ? 'on' : ''}" id="btn-members" title="群成员">${icon('users')}</button>` : ''}
        <button class="icon-btn ghost" id="btn-more" data-menu-anchor title="更多">${icon('more')}</button>
      </div>
    </header>
    <div class="chat-body">
      <div class="messages-wrap">
        <div class="messages" id="messages"></div>
        <button class="jump hidden" id="jump">${icon('chevron', 16)} 回到最新</button>
      </div>
      <aside class="members ${membersOpen ? '' : 'hidden'}" id="members"></aside>
    </div>
    <footer class="composer">
      <div class="suggest hidden" id="suggest"></div>
      <div class="composer-box" id="composer-box">
        <textarea id="input" rows="1" placeholder="${c.type === 'group' ? '输入 @ 指派成员，输入 / 使用命令…' : `给 ${esc(agentById(c.members[0])?.name || '')} 发消息，输入 / 使用命令…`}"></textarea>
        <div class="composer-bar">
          <div class="bar-left">
            <button class="chip-btn" id="btn-slash" title="命令">${icon('slash', 14)} 命令</button>
            ${c.type === 'group' ? `<button class="chip-btn" id="btn-at" title="提及成员">${icon('at', 14)} 提及</button>` : `<button class="chip-btn model-chip" id="btn-model" title="选择模型和思考强度"></button>`}
            <span class="bar-hint" id="bar-hint"></span>
          </div>
          <div class="bar-right">
            <button class="btn stop hidden" id="btn-stop">${icon('stop', 14)} 停止</button>
            <button class="send-btn" id="btn-send" title="发送 (Enter)">${icon('send', 17)}</button>
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
    ? `${groupAvatar(c, 40)}<div><div class="name">${esc(c.name)}</div><div class="sub">${c.members.length} 位成员 · ${cwdChip(c, shortCwd, cwd)}</div></div>`
    : `${avatar(a, 40)}<div><div class="name">${esc(a?.name || c.name)} ${a?.status?.installed ? '' : '<span class="badge-soft warn">未安装</span>'}</div><div class="sub">${esc(a?.vendor || '')} · ${cwdChip(c, shortCwd, cwd)}</div></div>`;
  $('#source-slot').innerHTML = !isGroup && a ? sourcePill(a) : '';
  const busy = S.messages.some((m) => m.status === 'streaming');
  $('#btn-stop')?.classList.toggle('hidden', !busy);
  if (isGroup) renderMembers();
  const mc = $('#btn-model');
  if (mc && a) {
    const info = authInfo(a);
    mc.classList.toggle('hidden', !!a.noModel);
    mc.innerHTML = `${icon('sparkles', 14)} ${esc(info.model || '默认模型')}${info.effort ? ` · ${esc(effortName(info.effort))}` : ''} ${icon('chevron', 12)}`;
  }
  const hint = $('#bar-hint');
  if (hint) {
    hint.innerHTML = isGroup ? 'Enter 发送 · Shift+Enter 换行 · AI 之间可以互相 @ 接力'
      : a && !a.status?.installed ? `${esc(a.name)} 未安装，<a href="#" data-goto="tools">去一键安装</a>`
      : a?.auth && !a.auth.loggedIn && a.config.mode === 'official' && a.canLogin ? `${esc(a.name)} 未登录，输入 <code>/login</code> 或 <a href="#" data-cmd="/login">立即登录</a>`
      : 'Enter 发送 · Shift+Enter 换行';
  }
}

function cwdChip(c, short, full) {
  const unset = needsCwd(c);
  return `<button class="cwd-chip ${unset ? 'warn' : ''}" data-cwd-menu data-menu-anchor title="${esc(full)}">${icon('folder', 12)}<span>${unset ? '未选择工作目录（默认工作区）' : esc(short)}</span>${icon('chevron', 11)}</button>`;
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
        toast(dir ? `工作目录：${dir.replace(S.home, '~')}` : '使用默认工作区', 'ok');
        finish(true); close();
        if (S.chat?.id === c.id) openChat(c.id);
      } catch (e) { toast(e.message, 'error'); }
    };
    const recent = (S.settings.recentDirs || []).filter((d) => d !== c.cwd).slice(0, 6);
    const m = modal({
      title: '选择工作目录', width: 520,
      body: `${reason ? `<p class="muted small" style="margin-top:0">${esc(reason)}</p>` : ''}
        <p class="cwd-explain">AI 会在这个文件夹里读写文件、运行命令。选你的项目文件夹，做出来的东西就在你知道的地方。</p>
        <button class="cwd-pick" data-pick>${icon('folder', 22)}<div><b>选择文件夹…</b><small>打开系统的文件夹选择框</small></div></button>
        ${recent.length ? `<div class="cwd-sec">最近使用</div><div class="cwd-recent">${recent.map((d) => `<button class="cwd-item" data-dir="${esc(d)}">${icon('folder', 14)}<span>${esc(d.replace(S.home, '~'))}</span></button>`).join('')}</div>` : ''}
        <div class="cwd-sec">或者手动输入路径</div>
        <div class="cwd-input"><input id="cwd-path" placeholder="~/Projects/my-app（不存在会自动创建）" value="${esc(c.cwd ? c.cwd.replace(S.home, '~') : '')}"><button class="btn sm" data-manual>使用</button></div>
        <button class="link cwd-default" data-default>使用默认工作区（${esc((c.cwdResolved || S.settings.workspace || '').replace(S.home, '~'))}）</button>`,
      onMount: (el, close) => {
        el.addEventListener('click', async (e) => {
          if (e.target.closest('[data-pick]')) {
            const b = e.target.closest('[data-pick]'); b.disabled = true;
            try {
              const r = await api('POST', '/api/pick-folder', { prompt: '选择 Noe Agent 的工作目录', defaultPath: c.cwd || S.home });
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
    { header: (c.cwd || c.cwdResolved || '').replace(S.home, '~') || '工作目录' },
    { label: '选择其他文件夹…', icon: 'folder', onClick: () => chooseCwd(c) },
    ...recent.map((d) => ({ label: d.replace(S.home, '~'), icon: 'clock', onClick: () => api('PATCH', `/api/chats/${encodeURIComponent(c.id)}`, { cwd: d }).then(() => { toast('工作目录已切换', 'ok'); openChat(c.id); }) })),
    { divider: true },
    { label: '在访达中打开', icon: 'folder', onClick: () => api('POST', `/api/chats/${encodeURIComponent(c.id)}/open-folder`) },
    { label: '在终端中打开', icon: 'terminal', onClick: () => sendText('/shell') },
  ], { width: 300 });
}

function sourcePill(a) {
  const info = authInfo(a);
  const warn = a.config.mode === 'official' && a.auth && !a.auth.loggedIn && a.canLogin;
  return `<button class="source-pill ${warn ? 'warn' : ''}" data-source="${a.id}" data-menu-anchor title="切换 API 来源 / 模型">
    <i class="dot" style="background:${warn ? 'var(--warn)' : info.provider ? info.color : 'var(--ok)'}"></i>
    <span>${esc(info.label)}${warn ? '（未登录）' : ''}</span>${info.model ? `<span class="model">${esc(info.model)}${info.effort ? ' · ' + esc(effortName(info.effort)) : ''}</span>` : ''}${icon('chevron', 14)}</button>`;
}

function renderMembers() {
  const c = S.chat; const box = $('#members'); if (!box) return;
  box.innerHTML = `
    <div class="panel-title">群成员 <span class="count">${c.members.length}</span></div>
    <div class="member-list">${c.members.map((id) => {
      const a = agentById(id);
      return `<div class="member">${avatar(a, 32)}<div class="m-meta"><div>${esc(a?.name || id)} <span class="muted">@${esc(id)}</span></div>
        ${a ? sourcePill(a) : ''}</div><button class="icon-btn ghost xs" data-remove="${id}" title="移出群聊">${icon('x', 14)}</button></div>`;
    }).join('')}</div>
    <div class="drop-zone" id="member-drop">${icon('plus', 16)} 拖入 AI 加入群聊</div>
    <div class="add-chips">${S.agents.filter((a) => !c.members.includes(a.id)).map((a) => `<button class="chip" data-add="${a.id}">${avatar(a, 20)}${esc(a.name)}</button>`).join('')}</div>
    <div class="panel-title">群设置</div>
    <label class="field"><span>群名称</span><input id="group-name" value="${esc(c.name)}"></label>
    <label class="field"><span>工作目录</span><input id="group-cwd" value="${esc(c.cwd || '')}" placeholder="${esc((c.cwdResolved || '').replace(S.home, '~'))}"></label>
    <button class="btn danger block" id="btn-del-group">${icon('trash', 15)} 解散群聊</button>`;
}

// ================= 消息 =================
export function renderMessages(scroll) {
  const box = $('#messages'); if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  let html = '', lastDay = '', prev = null;
  for (const m of S.messages) {
    const day = fmtDay(m.ts);
    if (day !== lastDay) { html += `<div class="day-sep"><span>${day}</span></div>`; lastDay = day; prev = null; }
    html += msgHtml(m, prev);
    prev = m;
  }
  box.innerHTML = html || emptyChatHtml();
  if (scroll || nearBottom) box.scrollTop = box.scrollHeight;
  $('#btn-stop')?.classList.toggle('hidden', !S.messages.some((m) => m.status === 'streaming'));
}

function emptyChatHtml() {
  const c = S.chat;
  const cwdCard = needsCwd(c) ? `<div class="cwd-card">${icon('folder', 20)}<div><b>先选择工作目录</b><small>AI 做出来的文件都会放在这里，之后在顶部随时可以切换</small></div><button class="btn primary sm" data-choose-cwd>选择文件夹</button></div>` : '';
  if (c.type === 'group') {
    const ms = c.members.map(agentById).filter(Boolean);
    const ex = ms.length >= 2 ? `@${ms[0].id} 帮我写一个待办应用的后端接口，@${ms[1].id} 写对应的单元测试` : ms.length ? `@${ms[0].id} 介绍一下你自己` : '';
    return `<div class="chat-empty">${groupAvatar(c, 64)}<h3>${esc(c.name)}</h3><p>用 @ 把任务派给成员，他们会在同一个工作目录里协作。</p>${cwdCard}
      ${ex ? `<button class="example" data-fill="${esc(ex)}">${icon('sparkles', 15)} ${esc(ex)}</button>` : '<p class="muted">先把 AI 拖进群吧</p>'}</div>`;
  }
  const a = agentById(c.members[0]);
  const ex = ['帮我在当前目录初始化一个 Vite + React 项目', '解释一下这个目录里的代码结构', '/help'];
  return `<div class="chat-empty">${avatar(a, 64)}<h3>${esc(a?.name)}</h3><p>${esc(a?.desc || '')}</p>${cwdCard}
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
        <div class="msg-actions">${actBtn('copy', '复制')}${actBtn('trash', '删除')}<span class="time">${fmtTime(m.ts)}</span></div>
      </div></div>`;
  }
  const a = agentById(m.sender);
  const replyTo = m.replyTo && S.chat.type === 'group' ? S.messages.find((x) => x.id === m.replyTo) : null;
  const relay = replyTo && replyTo.sender !== 'user' ? `<span class="relay">${icon('zap', 12)} 接力自 ${esc(agentById(replyTo.sender)?.name || '')}</span>` : '';
  const meta = m.meta || {};
  const metaBits = [
    meta.durationMs && m.status !== 'streaming' ? fmtMs(meta.durationMs) : '',
    meta.inTok || meta.outTok ? `${fmtNum(meta.inTok)} → ${fmtNum(meta.outTok)} tokens` : '',
    meta.cost ? '$' + meta.cost.toFixed(meta.cost < 0.01 ? 4 : 3) : '',
  ].filter(Boolean);
  const body = m.text ? md(m.text) : m.status === 'streaming' ? `<span class="thinking"><span class="typing-dots"><i></i><i></i><i></i></span>${m.steps?.length ? esc(m.steps.at(-1).title) : '思考中'}</span>` : m.error ? '' : '<span class="muted">（没有输出）</span>';
  return `<div class="msg ${compact ? 'compact' : ''} ${m.status}" id="m-${m.id}">
    ${compact ? '<div class="avatar-space"></div>' : avatar(a, 34)}
    <div class="body">
      ${compact ? '' : `<div class="who"><b style="color:${a?.color || 'inherit'}">${esc(a?.name || m.sender)}</b>
        ${meta.provider || meta.model ? `<span class="model-tag">${esc([meta.provider, meta.model].filter(Boolean).join(' · '))}</span>` : ''}${relay}<span class="time">${fmtTime(m.ts)}</span></div>`}
      ${stepsHtml(m)}
      ${body ? `<div class="bubble md ${m.status === 'streaming' && m.text ? 'streaming' : ''}">${body}</div>` : ''}
      ${m.error ? `<div class="err-card">${icon('alert', 16)}<div><b>运行出错</b><pre>${esc(m.error)}</pre></div></div>` : ''}
      ${m.status === 'stopped' ? `<div class="stopped">${icon('stop', 12)} 已停止</div>` : ''}
      ${m.status !== 'streaming' ? `<div class="msg-actions">${actBtn('copy', '复制')}${m.replyTo ? actBtn('refresh', '重新生成') : ''}${actBtn('trash', '删除')}
        ${metaBits.length ? `<span class="meta">${metaBits.map(esc).join(' · ')}</span>` : ''}</div>` : ''}
    </div></div>`;
}
const actBtn = (ic, title) => `<button class="act" data-act="${ic}" title="${title}">${icon(ic, 14)}</button>`;

function sysHtml(m) {
  const actions = [
    ...(m.term ? [`<button class="sys-btn" data-term="${m.term}">${icon('terminal', 13)} 查看终端</button>`] : []),
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
    <div class="s-body"><div class="s-title">${esc(s.title)}</div>${s.detail ? `<pre>${esc(s.detail)}</pre>` : ''}</div></div>`).join('');
  return `<details class="steps" ${open}><summary>${icon('layers', 13)} ${m.status === 'streaming' ? '执行中' : '执行过程'} · ${tools} 次操作 ${icon('chevron', 13)}</summary><div class="step-list">${items}</div></details>`;
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
  el.replaceWith(fresh);
  const newList = fresh.querySelector('.step-list');
  if (oldList && newList) newList.scrollTop = newList.scrollHeight;
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

const pending = new Map();
export function schedulePatch(id) {
  if (pending.has(id)) return;
  pending.set(id, requestAnimationFrame(() => {
    pending.delete(id);
    const cur = S.messages.find((x) => x.id === id);
    if (cur) patchMessage(cur);
  }));
}

// ================= 发送 =================
export async function sendText(text) {
  if (!text || !S.chatId) return;
  try { await api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/messages`, { text }); }
  catch (e) { toast(e.message, 'error'); throw e; }
}
async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  // 新会话第一次干活前先确定工作目录，避免做出来的东西不知道放在哪
  if (!text.startsWith('/') && needsCwd(S.chat)) {
    hideSuggest();
    const ok = await chooseCwd(S.chat, { reason: '开始之前，先选一个工作目录。' });
    if (!ok) return;
  }
  input.value = ''; autosize(); hideSuggest();
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
      items.push({ insert: '/' + cmd.name + ' ', title: '/' + cmd.name, args: cmd.args || '', sub: cmd.desc, ic: 'zap', tag: 'Noe' });
    }
    const agents = c.type === 'dm' ? [agentById(c.members[0])] : c.members.map(agentById);
    for (const a of agents.filter(Boolean)) {
      if (!a.status?.installed) continue;
      const own = new Set(S.commands.map((x) => x.name));
      const list = (a.slash?.length ? a.slash : FALLBACK_SLASH[a.slashMode] || []).filter((n) => !own.has(n));
      for (const n of list) {
        if (q && !n.toLowerCase().includes(q)) continue;
        items.push({ insert: `/${n} ${c.type === 'group' ? '@' + a.id + ' ' : ''}`, title: '/' + n, sub: a.slashMode === 'claude' ? `${a.name} 命令` : `${a.name} 命令 · 在终端中打开`, agent: a, tag: a.name });
      }
    }
    return items.length ? showSuggest(0, pos, items.slice(0, 60)) : hideSuggest();
  }
  m = before.match(/@([\w一-龥-]*)$/);
  if (m && c.type === 'group') {
    const q = m[1].toLowerCase();
    const pool = c.members.map(agentById).filter(Boolean);
    const items = [...pool.map((a) => ({ insert: '@' + a.id + ' ', title: a.name, sub: '@' + a.id + ' · ' + authInfo(a).label, agent: a })),
      ...(pool.length > 1 ? [{ insert: '@所有人 ', title: '所有人', sub: '@所有人 · 同时派给全部成员', ic: 'users' }] : [])]
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
    const head = it.tag && it.tag !== lastTag ? `<div class="sg-head">${esc(it.tag === 'Noe' ? 'Noe 命令' : it.tag + ' 命令')}</div>` : '';
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
  const items = [{ header: `${a.name} · API 来源` }];
  const loginSub = a.auth ? (a.auth.loggedIn ? `已登录 · ${a.auth.detail}` : '未登录') : a.officialLabel;
  items.push({ label: '官方登录', sub: loginSub, icon: 'login', check: cfg.mode === 'official', onClick: () => setCfg(a, { mode: 'official' }) });
  const ok = S.providers.filter((p) => fits(a, p));
  const no = S.providers.filter((p) => !fits(a, p));
  for (const p of ok) {
    items.push({ label: p.name, sub: p.hasKey ? `${p.models.length} 个模型` : '⚠ 未填写 API Key', icon: `<i class="dot lg" style="background:${p.color}"></i>`, check: cfg.mode === 'provider' && cfg.providerId === p.id, onClick: () => setCfg(a, { mode: 'provider', providerId: p.id, model: p.models.includes(cfg.model) ? cfg.model : '' }) });
  }
  for (const p of no) items.push({ label: p.name, sub: `不兼容：缺少 ${a.protocols.map((k) => S.protocols[k]).join('/')} 地址`, icon: `<i class="dot lg" style="background:${p.color};opacity:.4"></i>`, disabled: true });
  if (!a.noModel) {
    const info = authInfo(a);
    items.push({ divider: true }, { header: '模型' });
    for (const m of modelChoices(a).slice(0, 5)) items.push({ label: m.name || m.id, sub: m.id, check: cfg.model === m.id, onClick: () => setCfg(a, { model: m.id }) });
    items.push({ label: '全部模型与思考强度…', sub: `当前：${info.model}${info.effort ? ' · ' + effortName(info.effort) : ''}`, icon: 'sparkles', onClick: () => modelPicker(a) });
  }
  items.push({ divider: true });
  if (a.canLogin) items.push({ label: a.auth?.loggedIn ? '重新登录官方账号' : '登录官方账号', icon: 'login', onClick: () => runLogin(a) });
  if (a.canLogout && a.auth?.loggedIn) items.push({ label: '退出官方账号', icon: 'logout', onClick: () => runLogin(a, true) });
  items.push({ label: '管理模型厂商', icon: 'key', onClick: () => emit('goto', 'providers') });
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
    title: `${a.name} · 选择模型`, width: 600,
    body: `<div class="mp-src">${avatar(a, 30)}<div><b>${esc(authInfo(a).label)}</b><small>${a.config.mode === 'provider' ? '使用厂商 API 的模型列表' : esc(a.officialLabel || '')}${S.models?.agents?.[a.id]?.live ? ' · 已从 CLI 实时读取' : ''}</small></div>
        <button class="btn xs" data-mp-src data-menu-anchor>切换来源</button></div>
      <div class="search mp-search">${icon('search', 14)}<input id="mp-q" placeholder="搜索或输入任意模型 ID，例如 opus、gpt-6、gemini-3.8-flash" autocomplete="off"></div>
      <div class="mp-list" id="mp-list"></div>
      <div id="mp-effort"></div>`,
    onMount: (el, close) => {
      const draw = () => {
        a = agentById(a.id) || a;
        const cur = a.config.model;
        const list = modelChoices(a);
        const ql = q.toLowerCase().replace(/\s+/g, '');
        const shown = list.filter((m) => !ql || (m.id + (m.name || '') + (m.desc || '')).toLowerCase().replace(/\s+/g, '').includes(ql));
        const custom = q.trim() && !list.some((m) => m.id === q.trim());
        el.querySelector('#mp-list').innerHTML = `
          ${!q ? `<button class="mp-item ${!cur ? 'on' : ''}" data-model=""><div class="mp-main"><b>默认</b><small>${a.config.mode === 'provider' ? '厂商列表里的第一个模型' : '由 CLI 自己决定'}</small></div>${!cur ? icon('check', 16) : ''}</button>` : ''}
          ${shown.map((m) => `<button class="mp-item ${cur === m.id ? 'on' : ''}" data-model="${esc(m.id)}">
            <div class="mp-main"><div class="mp-name"><b>${esc(m.name || m.id)}</b>${(m.tags || []).map((t) => `<span class="mtag ${TAG_CLS[t] ?? ''}">${esc(t)}</span>`).join('')}</div>
              <small><code>${esc(m.id)}</code>${m.desc ? ' · ' + esc(m.desc) : ''}</small></div>
            ${m.price ? `<span class="mp-price">${esc(m.price)}<i>/百万 token</i></span>` : ''}${cur === m.id ? icon('check', 16) : ''}</button>`).join('')}
          ${custom ? `<button class="mp-item custom" data-model="${esc(q.trim())}"><div class="mp-main"><b>使用自定义模型「${esc(q.trim())}」</b><small>目录里没有也可以直接用，只要 CLI 或厂商支持</small></div>${icon('right', 16)}</button>` : ''}
          ${!shown.length && !custom ? '<p class="muted small" style="padding:8px">没有模型</p>' : ''}`;
        const ef = efforts();
        el.querySelector('#mp-effort').innerHTML = ef.length && !a.noModel ? `<div class="mp-effort"><div><b>思考强度</b><small>越高越聪明，也越慢、越耗额度</small></div>
          <div class="seg">${['', ...ef].map((e) => `<button data-effort="${e}" class="${(a.config.effort || '') === e ? 'on' : ''}">${e ? esc(effortName(e)) : '默认'}</button>`).join('')}</div></div>` : '';
      };
      el.querySelector('#mp-q').addEventListener('input', (e) => { q = e.target.value; draw(); });
      el.querySelector('#mp-q').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const first = el.querySelector('.mp-item[data-model]:not([data-model=""])') || el.querySelector('.mp-item'); first?.click(); }
      });
      el.addEventListener('click', async (e) => {
        const m = e.target.closest('[data-model]');
        if (m) { await setCfg(a, { model: m.dataset.model }); a.config.model = m.dataset.model; q = ''; el.querySelector('#mp-q').value = ''; draw(); return; }
        const ef = e.target.closest('[data-effort]');
        if (ef) { await setCfg(a, { effort: ef.dataset.effort }, true); a.config.effort = ef.dataset.effort; draw(); toast(`思考强度：${ef.dataset.effort ? effortName(ef.dataset.effort) : '默认'}`, 'ok'); return; }
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
    const label = patch.mode === 'official' ? '官方登录' : patch.mode === 'provider' ? providerById(patch.providerId)?.name : null;
    toast(label ? `${a.name} 已切换到 ${label}` : `${a.name} 的模型已切换为 ${patch.model ? modelInfo(a.id, patch.model)?.name || patch.model : '默认'}`, 'ok');
  } catch (e) { toast(e.message, 'error'); }
}
export async function runLogin(a, logout = false) {
  try {
    const { term } = await api('POST', `/api/agents/${a.id}/login`, { chatId: S.chatId, logout });
    emit('term.focus', term);
  } catch (e) { toast(e.message, 'error'); }
}

// ================= 新建群聊 =================
export function openNewGroup(preset = []) {
  const pick = new Set(preset);
  const draw = (el) => {
    el.querySelector('#ng-pick').innerHTML = S.agents.map((a) => `<button class="pick ${pick.has(a.id) ? 'on' : ''}" data-pick="${a.id}">
      ${avatar(a, 30)}<span>${esc(a.name)}<small>${a.status?.installed ? authInfo(a).label : '未安装'}</small></span>${icon('check', 14)}</button>`).join('');
  };
  modal({
    title: '新建群聊', width: 520,
    body: `<label class="field"><span>群名称</span><input id="ng-name" placeholder="例如：全栈小分队"></label>
      <div class="field"><span>选择成员（之后也可以拖进来）</span><div class="pick-grid" id="ng-pick"></div></div>
      <div class="field"><span>工作目录（建议选择你的项目文件夹）</span><div class="cwd-input"><input id="ng-cwd" placeholder="留空则使用默认工作区"><button class="btn sm" id="ng-pick-dir">${icon('folder', 14)} 选择…</button></div></div>`,
    onMount: (el) => {
      draw(el);
      el.querySelector('#ng-pick-dir').onclick = async () => {
        try { const r = await api('POST', '/api/pick-folder', { prompt: '选择群聊的工作目录' }); if (r.path) el.querySelector('#ng-cwd').value = r.path; }
        catch (er) { toast(er.message, 'error'); }
      };
      el.querySelector('#ng-pick').onclick = (e) => { const b = e.target.closest('[data-pick]'); if (!b) return; const id = b.dataset.pick; pick.has(id) ? pick.delete(id) : pick.add(id); draw(el); };
      setTimeout(() => el.querySelector('#ng-name').focus(), 50);
    },
    actions: [{ label: '取消' }, {
      label: '创建群聊', primary: true, onClick: async (el) => {
        const members = [...pick];
        const name = el.querySelector('#ng-name').value.trim() || members.map((id) => agentById(id)?.name).join('、') || '新群聊';
        const chat = await api('POST', '/api/chats', { name, members, cwd: el.querySelector('#ng-cwd').value.trim() });
        emit('reload'); emit('goto', 'chat');
        setTimeout(() => openChat(chat.id), 50);
      },
    }],
  });
}

export async function createTemplateGroup(name, ids) {
  const members = ids.filter((id) => agentById(id));
  const chat = await api('POST', '/api/chats', { name, members });
  emit('reload'); setTimeout(() => openChat(chat.id), 50);
}

async function setMembers(gid, members) {
  try { await api('PATCH', `/api/chats/${gid}`, { members }); } catch (e) { toast(e.message, 'error'); }
}

// ================= 欢迎页 =================
function welcomeHtml() {
  const installed = S.agents.filter((a) => a.status?.installed);
  const loggedOrProvider = S.agents.filter((a) => a.status?.installed && (a.config.mode === 'provider' || a.auth?.loggedIn));
  const steps = [
    { n: 1, title: '安装 AI 工具', desc: installed.length ? `已安装 ${installed.length} 个：${installed.map((a) => a.name).join('、')}` : '一键安装 Claude Code、Codex 等', done: installed.length > 0, goto: 'tools', btn: '去安装' },
    { n: 2, title: '登录或配置 API', desc: S.providers.length ? `已添加 ${S.providers.length} 个模型厂商` : '官方账号登录，或添加 DeepSeek / GLM / Kimi 等厂商', done: loggedOrProvider.length > 0, goto: 'providers', btn: '配置厂商' },
    { n: 3, title: '开始协作', desc: '私聊任意 AI，或者拉个群用 @ 派活', done: S.chats.some((c) => c.last), action: 'group', btn: '新建群聊' },
  ];
  const tpl = [
    { name: '全栈小分队', ids: ['claude', 'codex'], desc: 'Claude 写功能，Codex 写测试和审查' },
    { name: '代码评审会', ids: ['claude', 'codex', 'gemini'], desc: '多个 AI 交叉审查同一份代码' },
    { name: '国产模型组', ids: ['deepseek', 'qwen'], desc: 'DeepSeek + 通义千问 协作' },
  ];
  return `<div class="welcome">
    <div class="hero"><img src="icon.svg" alt=""><h1>Noe Agent <span class="beta-tag">Beta</span></h1><p>把所有 AI 编程助手装进一个聊天软件，私聊、拉群、@ 谁就谁来干活。</p></div>
    <div class="steps-row">${steps.map((s) => `<div class="step-card ${s.done ? 'done' : ''}">
      <div class="sc-n">${s.done ? icon('check', 16) : s.n}</div><h4>${s.title}</h4><p>${esc(s.desc)}</p>
      <button class="btn ${s.done ? '' : 'primary'} sm" ${s.goto ? `data-goto="${s.goto}"` : 'data-new-group'}>${s.btn}</button></div>`).join('')}</div>
    <div class="tpl-title">群聊模板</div>
    <div class="tpl-row">${tpl.map((t) => `<button class="tpl" data-tpl="${esc(t.name)}" data-ids="${t.ids.join(',')}">
      <div class="tpl-av">${t.ids.map((id) => agentById(id)).filter(Boolean).map((a) => avatar(a, 28)).join('')}</div>
      <b>${esc(t.name)}</b><small>${esc(t.desc)}</small></button>`).join('')}</div>
    <div class="kbd-tips"><span><kbd>⌘</kbd><kbd>K</kbd> 快速切换</span><span><kbd>/</kbd> 命令</span><span><kbd>@</kbd> 提及成员</span><span><kbd>⌘</kbd><kbd>J</kbd> 终端</span></div>
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
  $('#btn-stop').onclick = () => api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/stop`);
  $('#btn-folder').onclick = () => api('POST', `/api/chats/${encodeURIComponent(S.chatId)}/open-folder`);
  $('#chat-title').addEventListener('click', (e) => { const b = e.target.closest('[data-cwd-menu]'); if (b) cwdMenu(b); });
  $('#btn-term').onclick = (e) => {
    const c = S.chat;
    const items = c.members.map(agentById).filter(Boolean).map((a) => ({ label: `${a.name} 交互终端`, sub: c.sessions?.[a.id] ? '续接当前会话' : '新会话', icon: avatar(a, 18), disabled: !a.status?.installed, onClick: () => sendText(`/terminal @${a.id}`) }));
    menu(e.currentTarget, [...items, { divider: true }, { label: '系统终端（工作目录）', icon: 'terminal', onClick: () => sendText('/shell') }], { align: 'right', width: 260 });
  };
  $('#btn-members') && ($('#btn-members').onclick = (e) => {
    const m = $('#members'); m.classList.toggle('hidden'); e.currentTarget.classList.toggle('on', !m.classList.contains('hidden'));
    try { localStorage.setItem('noe.members', m.classList.contains('hidden') ? '0' : '1'); } catch { /* 忽略 */ }
  });
  $('#btn-more').onclick = (e) => {
    const c = S.chat;
    menu(e.currentTarget, [
      { label: '开启新会话', sub: '保留聊天记录，重置 AI 上下文', icon: 'refresh', onClick: () => sendText('/new') },
      { label: '查看成员状态', icon: 'info', onClick: () => sendText('/status') },
      ...(c.type === 'group' ? [{ label: c.pinned ? '取消置顶' : '置顶群聊', icon: 'pin', onClick: () => api('PATCH', `/api/chats/${c.id}`, { pinned: !c.pinned }) }] : []),
      { label: '切换工作目录', icon: 'folder', onClick: () => chooseCwd(c) },
      { divider: true },
      { label: '清空聊天记录', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox('清空本会话的聊天记录，并重置所有 AI 的上下文？', { danger: true, ok: '清空' })) sendText('/clear'); } },
      ...(c.type === 'group' ? [{ label: '解散群聊', icon: 'x', danger: true, onClick: deleteGroup }] : []),
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
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const id = act.closest('.msg').id.slice(2);
    const m = S.messages.find((x) => x.id === id);
    if (act.dataset.act === 'copy') copyText(m.text);
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
async function deleteGroup() {
  if (await confirmBox(`解散群聊「${S.chat.name}」？聊天记录会被删除。`, { danger: true, ok: '解散' })) await api('DELETE', `/api/chats/${S.chatId}`);
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
    const t = targetOf(e);
    if (!t || (['members', 'member-drop'].includes(t.id) || t.classList.contains('messages-wrap')) && !groupOk()) return;
    e.preventDefault();
    const hl = t.id === 'members' ? $('#member-drop') : t;
    $$('.drag-over').forEach((x) => x !== hl && x.classList.remove('drag-over'));
    hl.classList.add('drag-over');
  });
  document.addEventListener('drop', async (e) => {
    const id = e.dataTransfer.getData('text/noe-agent');
    document.body.classList.remove('dragging');
    $$('.drag-over').forEach((x) => x.classList.remove('drag-over'));
    const t = targetOf(e);
    if (!id || !t) return;
    e.preventDefault();
    if (t.id === 'drop-new') return openNewGroup([id]);
    const gid = t.dataset.group || S.chatId;
    const chat = S.chats.find((c) => c.id === gid);
    if (!chat || chat.type !== 'group') return;
    if (chat.members.includes(id)) return toast(`${agentById(id).name} 已经在群里了`);
    await setMembers(gid, [...chat.members, id]);
    toast(`已把 ${agentById(id).name} 拉进「${chat.name}」`, 'ok');
  });
}

// ================= 快速切换（⌘K） =================
export function quickSwitch() {
  const all = [
    ...S.agents.map((a) => ({ id: 'dm-' + a.id, name: a.name, sub: '私聊 · ' + authInfo(a).label, av: avatar(a, 28) })),
    ...S.chats.filter((c) => c.type === 'group').map((c) => ({ id: c.id, name: c.name, sub: `群聊 · ${c.members.length} 位成员`, av: groupAvatar(c, 28) })),
  ];
  let sel = 0, list = all;
  const m = modal({
    title: '快速切换', width: 480,
    body: `<input class="qs-input" id="qs" placeholder="搜索 AI 或群聊…"><div class="qs-list" id="qs-list"></div>`,
    onMount: (el, close) => {
      const draw = () => {
        el.querySelector('#qs-list').innerHTML = list.map((x, i) => `<div class="qs-item ${i === sel ? 'sel' : ''}" data-i="${i}">${x.av}<span>${esc(x.name)}</span><small>${esc(x.sub)}</small></div>`).join('') || '<div class="muted" style="padding:12px">没有匹配项</div>';
      };
      const go = (i) => { if (list[i]) { close(); emit('goto', 'chat'); openChat(list[i].id); } };
      const q = el.querySelector('#qs');
      q.oninput = () => { const s = q.value.toLowerCase(); list = all.filter((x) => x.name.toLowerCase().includes(s) || x.sub.toLowerCase().includes(s)); sel = 0; draw(); };
      q.onkeydown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, list.length - 1); draw(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
        if (e.key === 'Enter') go(sel);
      };
      el.querySelector('#qs-list').onclick = (e) => { const it = e.target.closest('[data-i]'); if (it) go(+it.dataset.i); };
      draw(); setTimeout(() => q.focus(), 30);
    },
  });
  return m;
}
