// 页面：工具（安装/登录/API 来源）、模型厂商、设置
import { $, $$, esc, S, api, toast, icon, avatar, agentById, providerById, authInfo, fits, modal, confirmBox, emit, menu } from './core.js';
import { runLogin, sourceMenu, modelPicker } from './chat.js';

// ======================= 工具页 =======================
const openLog = new Set();
const openAdv = new Set();

export function renderTools() {
  const page = $('#view-tools');
  const installed = S.agents.filter((a) => a.status?.installed).length;
  page.innerHTML = `<div class="page">
    <div class="page-head">
      <div><h1>AI 工具</h1><p>一键安装 AI CLI，选择用官方账号登录还是用模型厂商的 API。已安装 <b>${installed}</b> / ${S.agents.length}</p></div>
      <div class="head-actions">
        <button class="btn" id="btn-refresh">${icon('refresh', 15)} 重新检测</button>
        <button class="btn" id="btn-custom">${icon('plus', 15)} 自定义 CLI</button>
      </div>
    </div>
    <div class="tool-grid">${S.agents.map(toolCard).join('')}</div>
  </div>`;
  $$('.log', page).forEach((l) => (l.scrollTop = l.scrollHeight));
}

function toolCard(a) {
  const st = a.status;
  const status = a.installing ? '<span class="status busy"><span class="spinner"></span>处理中</span>'
    : st?.installed ? `<span class="status ok">${icon('check', 13)} ${st.version ? 'v' + esc(st.version) : '已安装'}</span>`
    : st ? '<span class="status off">未安装</span>' : '<span class="status off">检测中…</span>';
  const info = authInfo(a);
  const fitsList = S.providers.filter((p) => fits(a, p));
  const cfg = a.config;
  const log = S.logs[a.id];
  const showLog = log && (openLog.has(a.id) || a.installing);
  const authLine = a.auth ? (a.auth.loggedIn ? `<span class="ok-text">${icon('check', 13)} 已登录 · ${esc(a.auth.detail)}</span>` : '<span class="warn-text">未登录</span>') : `<span class="muted">${esc(a.officialLabel || '')}</span>`;
  return `<div class="tool-card ${st?.installed ? 'installed' : ''}" data-card="${a.id}" style="--c:${a.color}">
    <div class="tc-top">${avatar(a, 46)}
      <div class="tc-name"><h3>${esc(a.name)}</h3><span>${esc(a.vendor)} · <code>${esc(a.bin)}</code></span></div>${status}</div>
    <p class="tc-desc">${esc(a.desc)}</p>
    ${a.custom && !a.protocols.length ? '' : `<div class="tc-auth">
      <div class="seg">
        <button class="${cfg.mode === 'official' ? 'on' : ''}" data-mode="official">${icon('login', 14)} 官方登录</button>
        <button class="${cfg.mode === 'provider' ? 'on' : ''}" data-mode="provider" ${a.protocols.length ? '' : 'disabled'}>${icon('key', 14)} 模型厂商 API</button>
      </div>
      ${cfg.mode === 'official' ? `<div class="auth-row">${authLine}
          <span class="grow"></span>
          ${a.canLogin && st?.installed ? `<button class="btn xs" data-act="login">${a.auth?.loggedIn ? '重新登录' : '登录'}</button>` : ''}
          ${a.canLogout && a.auth?.loggedIn ? `<button class="btn xs ghost" data-act="logout">退出</button>` : ''}</div>`
        : `<div class="auth-row">${fitsList.length ? `<select class="select" data-provider>${fitsList.map((p) => `<option value="${p.id}" ${p.id === cfg.providerId ? 'selected' : ''}>${esc(p.name)}${p.hasKey ? '' : '（未填 Key）'}</option>`).join('')}${cfg.providerId && !fitsList.find((p) => p.id === cfg.providerId) ? '<option selected disabled>请选择</option>' : ''}</select>`
          : `<span class="muted">没有兼容的厂商（需要 ${a.protocols.map((k) => S.protocols[k]).join('/')} 地址）</span>`}
          <button class="btn xs" data-goto="providers">${icon('plus', 13)} 管理厂商</button></div>`}
      ${a.noModel ? '' : `<div class="auth-row"><span class="label">模型</span><button class="model-btn" data-picker="${a.id}">${icon('sparkles', 13)} ${esc(info.model)}${info.effort ? ' · ' + esc(S.models?.effortLabel?.[info.effort] || info.effort) : ''} ${icon('chevron', 13)}</button></div>`}
      ${a.protocolNote && cfg.mode === 'provider' ? `<div class="note">${icon('info', 13)} ${esc(a.protocolNote)}</div>` : ''}
    </div>`}
    <div class="tc-actions">
      ${a.installCmd ? `<button class="btn sm ${st?.installed ? '' : 'primary'}" data-act="install" ${a.installing ? 'disabled' : ''}>${icon(st?.installed ? 'refresh' : 'download', 14)} ${st?.installed ? '更新' : '一键安装'}</button>` : ''}
      ${st?.installed ? `<button class="btn sm" data-act="chat">${icon('chat', 14)} 私聊</button><button class="btn sm" data-act="term">${icon('terminal', 14)} 终端</button>` : ''}
      <span class="grow"></span>
      <button class="icon-btn ghost sm" data-act="more" data-menu-anchor title="更多">${icon('more', 16)}</button>
    </div>
    ${a.installCmd ? `<div class="cmd-line"><code>$ ${esc(a.installCmd)}</code>${log ? `<button class="link" data-act="log">${showLog ? '收起日志' : '查看日志'}</button>` : ''}</div>` : ''}
    ${showLog ? `<pre class="log" data-log="${a.id}">${esc(log)}</pre>` : ''}
    ${openAdv.has(a.id) ? `<div class="adv"><label class="field"><span>额外环境变量（每行 KEY=VALUE，例如代理）</span><textarea data-extra rows="3" placeholder="HTTPS_PROXY=http://127.0.0.1:7890">${esc(cfg.extraEnv)}</textarea></label>
      <button class="btn sm primary" data-act="save-adv">保存</button></div>` : ''}
  </div>`;
}

function bindTools() {
  const page = $('#view-tools');
  page.addEventListener('click', async (e) => {
    if (e.target.closest('#btn-refresh')) { toast('正在重新检测…'); await api('POST', '/api/agents/refresh'); return toast('检测完成', 'ok'); }
    if (e.target.closest('#btn-custom')) return customDialog();
    const card = e.target.closest('[data-card]'); if (!card) return;
    const a = agentById(card.dataset.card);
    const mode = e.target.closest('[data-mode]');
    if (mode && !mode.disabled) {
      if (mode.dataset.mode === 'provider') {
        const p = S.providers.find((x) => x.id === a.config.providerId && fits(a, x)) || S.providers.find((x) => fits(a, x));
        if (!p) { toast(`还没有兼容 ${a.name} 的厂商，先添加一个`, 'error'); return emit('goto', 'providers'); }
        return save(a, { mode: 'provider', providerId: p.id });
      }
      return save(a, { mode: 'official' });
    }
    if (e.target.closest('[data-picker]')) return modelPicker(a);
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const act = btn.dataset.act;
    try {
      if (act === 'install') { S.logs[a.id] = ''; openLog.add(a.id); await api('POST', `/api/agents/${a.id}/install`); }
      if (act === 'login') runLogin(a);
      if (act === 'logout') runLogin(a, true);
      if (act === 'chat') { emit('goto', 'chat'); emit('open-chat', 'dm-' + a.id); }
      if (act === 'term') { const r = await api('POST', `/api/agents/${a.id}/terminal`, {}); emit('term.focus', r.term); }
      if (act === 'log') { openLog.has(a.id) ? openLog.delete(a.id) : openLog.add(a.id); renderTools(); }
      if (act === 'save-adv') { await save(a, { extraEnv: card.querySelector('[data-extra]').value }); openAdv.delete(a.id); }
      if (act === 'more') {
        menu(btn, [
          { label: '环境变量 / 代理', icon: 'settings', onClick: () => { openAdv.has(a.id) ? openAdv.delete(a.id) : openAdv.add(a.id); renderTools(); } },
          ...(a.homepage ? [{ label: '官方文档', icon: 'link', onClick: () => window.open(a.homepage, '_blank') }] : []),
          ...(a.status?.installed && a.installCmd && !a.custom ? [{ divider: true }, { label: '卸载', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox(`卸载 ${a.name}？`, { danger: true, ok: '卸载' })) { S.logs[a.id] = ''; openLog.add(a.id); api('POST', `/api/agents/${a.id}/uninstall`); } } }] : []),
          ...(a.custom ? [{ label: '编辑', icon: 'edit', onClick: () => customDialog(a.customDef) }, { label: '移除', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox(`移除自定义工具 ${a.name}？`, { danger: true })) api('DELETE', `/api/agents/custom/${a.id}`); } }] : []),
        ], { align: 'right', width: 200 });
      }
    } catch (err) { toast(err.message, 'error'); }
  });
  page.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-provider]'); if (!sel) return;
    const a = agentById(sel.closest('[data-card]').dataset.card);
    save(a, { mode: 'provider', providerId: sel.value, model: '' });
  });
}
async function save(a, patch) {
  try { await api('PUT', `/api/agents/${a.id}/config`, patch); toast(`${a.name} 配置已更新`, 'ok'); }
  catch (e) { toast(e.message, 'error'); }
}

function customDialog(def = {}) {
  modal({
    title: def.id ? '编辑自定义 CLI' : '添加自定义 CLI', width: 520,
    body: `<p class="muted small" style="margin-top:0">任何能在命令行里“输入一段话、输出结果”的工具都能接入，例如 Aider、Cursor CLI、Goose。</p>
      <div class="grid2">
        <label class="field"><span>名称</span><input name="name" value="${esc(def.name || '')}" placeholder="如 Aider"></label>
        <label class="field"><span>群内 ID（@ 时用）</span><input name="id" value="${esc(def.id || '')}" placeholder="如 aider" ${def.id ? 'readonly' : ''}></label>
      </div>
      <label class="field"><span>命令</span><input name="bin" value="${esc(def.bin || '')}" placeholder="如 aider"></label>
      <label class="field"><span>参数模板（{prompt} 会替换成消息）</span><input name="argsTemplate" value="${esc(def.argsTemplate || '{prompt}')}" placeholder="--yes --message {prompt}"></label>
      <label class="field"><span>安装命令（可选）</span><input name="installCmd" value="${esc(def.installCmd || '')}" placeholder="如 pip install aider-chat"></label>`,
    actions: [{ label: '取消' }, {
      label: '保存', primary: true, onClick: async (el) => {
        const body = Object.fromEntries($$('input', el).map((i) => [i.name, i.value.trim()]));
        await api('POST', '/api/agents/custom', body); toast('已保存', 'ok');
      },
    }],
  });
}

// ======================= 模型厂商页 =======================
export function renderProviders({ soft } = {}) {
  const page = $('#view-providers');
  if (S.providerSel && !providerById(S.providerSel)) S.providerSel = null;
  if (!S.providerSel && S.providers.length) S.providerSel = S.providers[0].id;
  const p = providerById(S.providerSel);
  // 后台刷新时只更新列表和“谁在用”，不打断正在编辑的表单
  const pe = $('.pe', page);
  if (soft && p && pe && pe.dataset.pe === p.id) {
    $('.plist-items', page).innerHTML = listHtml();
    $('.user-list', page).innerHTML = usersHtml(p);
    return;
  }
  page.innerHTML = `<div class="split">
    <aside class="plist">
      <div class="plist-head"><h2>模型厂商</h2><button class="btn primary sm" id="btn-add-provider">${icon('plus', 14)} 添加</button></div>
      <p class="muted small plist-tip">添加多个厂商的 API，在工具卡片、聊天顶部或用 <code>/use</code> 一键切换；随时切回官方登录。</p>
      <div class="plist-items">${listHtml()}</div>
    </aside>
    <section class="peditor">${p ? editorHtml(p) : emptyEditor()}</section>
  </div>`;
}

function listHtml() {
  return S.providers.map((x) => {
    const users = S.agents.filter((a) => a.config.mode === 'provider' && a.config.providerId === x.id);
    return `<button class="pitem ${x.id === S.providerSel ? 'active' : ''}" data-p="${x.id}">
      <span class="p-logo" style="--c:${x.color}">${esc(x.name.slice(0, 1))}</span>
      <span class="p-meta"><b>${esc(x.name)}</b><small>${x.hasKey ? `${x.models.length} 个模型` : '<span class="warn-text">未填写 Key</span>'} · ${Object.keys(x.urls).map((k) => k[0].toUpperCase() + k.slice(1)).join(' / ') || '无地址'}</small></span>
      <span class="p-users">${users.map((a) => avatar(a, 18)).join('')}</span></button>`;
  }).join('') || `<div class="plist-empty">${icon('key', 28)}<p>还没有添加厂商</p><button class="btn primary sm" data-add-first>${icon('plus', 14)} 添加第一个</button></div>`;
}

function usersHtml(p) {
  return S.agents.filter((a) => a.protocols.length).map((a) => {
    const ok = fits(a, p);
    const using = a.config.mode === 'provider' && a.config.providerId === p.id;
    return `<div class="user-row ${ok ? '' : 'dim'}">${avatar(a, 28)}<span><b>${esc(a.name)}</b><small>${ok ? (using ? '正在使用 · ' + esc(authInfo(a).model || '') : `当前：${esc(authInfo(a).label)}`) : '缺少 ' + a.protocols.map((k) => S.protocols[k]).join('/') + ' 地址'}</small></span>
      ${ok ? (using ? `<button class="btn xs" data-official="${a.id}">切回官方登录</button>` : `<button class="btn xs primary" data-use="${a.id}">使用此厂商</button>`) : ''}</div>`;
  }).join('');
}

function emptyEditor() {
  return `<div class="pe-empty">${icon('layers', 40)}<h3>用自己的 API Key 驱动 AI 工具</h3>
    <p>支持 DeepSeek、智谱 GLM、Kimi、阿里云百炼、MiniMax、OpenRouter、硅基流动等厂商，以及任何 Anthropic / OpenAI 兼容的接口。</p>
    <button class="btn primary" data-add-first>${icon('plus', 15)} 添加模型厂商</button></div>`;
}

const URL_FIELDS = [
  { k: 'anthropic', label: 'Anthropic 协议地址', users: 'Claude Code', ph: 'https://…/anthropic' },
  { k: 'openai', label: 'OpenAI 协议地址', users: 'Codex · Qwen Code · OpenCode · DeepSeek Harness', ph: 'https://…/v1' },
  { k: 'gemini', label: 'Gemini 协议地址', users: 'Gemini CLI', ph: 'https://generativelanguage.googleapis.com' },
];

function editorHtml(p) {
  const preset = S.presets.find((x) => x.preset === p.preset);
  return `<div class="pe" data-pe="${p.id}">
    <div class="pe-head"><span class="p-logo lg" style="--c:${p.color}">${esc(p.name.slice(0, 1))}</span>
      <div class="pe-title"><input class="title-input" name="name" value="${esc(p.name)}"><small>${preset && preset.preset !== 'custom' ? '预设：' + esc(preset.name) : '自定义厂商'}</small></div>
      <span class="grow"></span>
      <button class="icon-btn ghost" data-act="delete" title="删除厂商">${icon('trash', 17)}</button>
    </div>

    <div class="pe-sec">
      <div class="sec-title">API Key ${preset?.site ? `<a class="link" href="${esc(preset.site)}" target="_blank" rel="noopener">${icon('link', 12)} 获取 Key</a>` : ''}</div>
      <div class="key-row"><input type="password" name="apiKey" value="${esc(p.apiKey)}" placeholder="粘贴 API Key" autocomplete="off" spellcheck="false">
        <button class="icon-btn ghost" data-act="eye" title="显示/隐藏">${icon('eye', 16)}</button></div>
      <small class="muted">只保存在本机 ~/.noe-agent/data.json，界面上会隐藏中间部分。</small>
    </div>

    <div class="pe-sec">
      <div class="sec-title">接口地址 <small class="muted">填了哪个协议，对应的工具就能使用这个厂商</small></div>
      ${URL_FIELDS.map((f) => `<label class="field url-field"><span>${f.label}<em>${f.users}</em></span><input name="url.${f.k}" value="${esc(p.urls[f.k] || '')}" placeholder="${f.ph}"></label>`).join('')}
    </div>

    <div class="pe-sec">
      <div class="sec-title">模型 <small class="muted">第一个为默认模型</small>
        ${preset && preset.models?.length ? `<button class="link" data-act="sync-preset">${icon('refresh', 12)} 同步最新预设</button>` : ''}
        <button class="link" data-act="fetch">${icon('download', 12)} 从厂商拉取列表</button></div>
      <div class="tags" id="model-tags">${p.models.map((m, i) => `<span class="tag-chip ${i === 0 ? 'first' : ''}">${i === 0 ? icon('zap', 11) : ''}${esc(m)}<button data-rm="${esc(m)}" title="移除">${icon('x', 11)}</button>${i ? `<button data-top="${esc(m)}" title="设为默认">${icon('pin', 11)}</button>` : ''}</span>`).join('')}
        <input class="tag-input" id="model-input" placeholder="输入模型名，回车添加"></div>
      <label class="field" style="margin-top:12px"><span>Claude Code 后台小模型（可选，默认与主模型相同）</span><input name="smallModel" value="${esc(p.smallModel || '')}" placeholder="如 deepseek-chat"></label>
    </div>

    <div class="pe-sec">
      <div class="sec-title">连通性测试</div>
      <div class="test-row"><select class="select" id="test-model">${p.models.map((m) => `<option>${esc(m)}</option>`).join('')}</select>
        <button class="btn sm" data-act="test">${icon('wifi', 14)} 测试连接</button></div>
      <div id="test-result"></div>
    </div>

    <div class="pe-sec">
      <div class="sec-title">谁在用</div>
      <div class="user-list">${usersHtml(p)}</div>
    </div>

    <div class="pe-foot"><span class="muted small" id="dirty-hint"></span><button class="btn primary" data-act="save">${icon('check', 15)} 保存</button></div>
  </div>`;
}

function collect(pe) {
  const body = { urls: {}, models: $$('.tag-chip', pe).map((t) => t.textContent.trim()) };
  for (const i of $$('input[name]', pe)) {
    if (i.name.startsWith('url.')) body.urls[i.name.slice(4)] = i.value.trim();
    else body[i.name] = i.value;
  }
  return body;
}

function bindProviders() {
  const page = $('#view-providers');
  const markDirty = () => { const h = $('#dirty-hint'); if (h) h.textContent = '有未保存的修改'; };
  page.addEventListener('input', (e) => { if (e.target.closest('.pe') && e.target.id !== 'model-input') markDirty(); });
  page.addEventListener('keydown', (e) => {
    if (e.target.id === 'model-input' && e.key === 'Enter') {
      e.preventDefault();
      const v = e.target.value.trim(); if (!v) return;
      addModels([v]); e.target.value = '';
    }
  });
  const addModels = (list) => {
    const pe = $('.pe'); const tags = $('#model-tags');
    const have = new Set($$('.tag-chip', pe).map((t) => t.textContent.trim()));
    for (const m of list) if (!have.has(m)) {
      const s = document.createElement('span'); s.className = 'tag-chip';
      s.innerHTML = `${esc(m)}<button data-rm="${esc(m)}">${icon('x', 11)}</button><button data-top="${esc(m)}" title="设为默认">${icon('pin', 11)}</button>`;
      tags.insertBefore(s, $('#model-input'));
    }
    markDirty();
  };
  page.addEventListener('click', async (e) => {
    if (e.target.closest('#btn-add-provider, [data-add-first]')) return addProviderDialog();
    const item = e.target.closest('[data-p]');
    if (item) { S.providerSel = item.dataset.p; return renderProviders(); }
    const pe = e.target.closest('.pe'); if (!pe) return;
    const id = pe.dataset.pe;
    const rm = e.target.closest('[data-rm]');
    if (rm) { rm.closest('.tag-chip').remove(); return markDirty(); }
    const top = e.target.closest('[data-top]');
    if (top) { const chip = top.closest('.tag-chip'); $('#model-tags').prepend(chip); return markDirty(); }
    const use = e.target.closest('[data-use]');
    if (use) {
      await saveProvider(id, pe, true);
      return api('PUT', `/api/agents/${use.dataset.use}/config`, { mode: 'provider', providerId: id, model: '' }).then(() => toast(`${agentById(use.dataset.use).name} 已使用此厂商`, 'ok')).catch((er) => toast(er.message, 'error'));
    }
    const off = e.target.closest('[data-official]');
    if (off) return api('PUT', `/api/agents/${off.dataset.official}/config`, { mode: 'official' }).then(() => toast('已切回官方登录', 'ok'));
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'eye') {
      const inp = $('input[name=apiKey]', pe);
      if (inp.type === 'password' && inp.value.includes('••••')) toast('已保存的 Key 不会再完整显示，可直接粘贴新的 Key 覆盖');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    }
    if (act === 'save') await saveProvider(id, pe);
    if (act === 'delete') {
      const p = providerById(id);
      if (await confirmBox(`删除厂商「${p.name}」？正在使用它的工具会切回官方登录。`, { danger: true, ok: '删除' })) { await api('DELETE', `/api/providers/${id}`); S.providerSel = null; toast('已删除', 'ok'); }
    }
    if (act === 'test') {
      await saveProvider(id, pe, true);
      const box = $('#test-result');
      box.innerHTML = `<div class="test-line"><span class="spinner"></span> 正在测试…</div>`;
      try {
        const { results } = await api('POST', `/api/providers/${id}/test`, { model: $('#test-model')?.value });
        box.innerHTML = results.map((r) => `<div class="test-line ${r.ok ? 'ok' : 'bad'}">${icon(r.ok ? 'check' : 'alert', 14)}
          <b>${esc(S.protocols[r.protocol] || '')}</b><span>${r.ok ? `连接成功 · ${r.ms}ms${r.reply ? ' · 回复：' + esc(r.reply) : ''}` : esc(r.error)}</span></div>`).join('');
      } catch (er) { box.innerHTML = `<div class="test-line bad">${icon('alert', 14)} ${esc(er.message)}</div>`; }
    }
    if (act === 'sync-preset') {
      try {
        const { added } = await api('POST', `/api/providers/${id}/sync-preset`);
        S.providerSel = id; renderProviders();
        toast(added.length ? `已添加：${added.join('、')}` : '已经是最新的预设模型', 'ok');
      } catch (er) { toast(er.message, 'error'); }
    }
    if (act === 'fetch') {
      await saveProvider(id, pe, true);
      const t = toastLoading('正在拉取模型列表…');
      try {
        const { models } = await api('POST', `/api/providers/${id}/models`);
        t.remove();
        pickModels(models, addModels);
      } catch (er) { t.remove(); toast(er.message, 'error'); }
    }
  });
}
function toastLoading(text) {
  const el = document.createElement('div'); el.className = 'toast show'; el.innerHTML = `<span class="spinner"></span><span>${esc(text)}</span>`;
  $('#toasts').appendChild(el); return el;
}
async function saveProvider(id, pe, silent) {
  try {
    await api('PUT', `/api/providers/${id}`, collect(pe));
    if (!silent) toast('已保存', 'ok');
    const h = $('#dirty-hint'); if (h) h.textContent = '';
  } catch (e) { toast(e.message, 'error'); throw e; }
}
function pickModels(models, addModels) {
  const sel = new Set();
  modal({
    title: `选择模型（共 ${models.length} 个）`, width: 520,
    body: `<input class="qs-input" id="pm-q" placeholder="筛选…"><div class="pm-list" id="pm-list"></div>`,
    onMount: (el) => {
      const draw = (q = '') => {
        el.querySelector('#pm-list').innerHTML = models.filter((m) => m.toLowerCase().includes(q)).slice(0, 400)
          .map((m) => `<label class="pm"><input type="checkbox" value="${esc(m)}" ${sel.has(m) ? 'checked' : ''}><span>${esc(m)}</span></label>`).join('') || '<p class="muted">没有匹配</p>';
      };
      el.querySelector('#pm-q').oninput = (e) => draw(e.target.value.toLowerCase());
      el.querySelector('#pm-list').onchange = (e) => { e.target.checked ? sel.add(e.target.value) : sel.delete(e.target.value); };
      draw();
    },
    actions: [{ label: '取消' }, { label: '添加选中', primary: true, onClick: () => { addModels([...sel]); } }],
  });
}

function addProviderDialog() {
  modal({
    title: '添加模型厂商', width: 640,
    body: `<div class="preset-grid">${S.presets.map((p) => `<button class="preset" data-preset="${p.preset}">
      <span class="p-logo" style="--c:${p.color}">${esc(p.name.slice(0, 1))}</span><b>${esc(p.name)}</b>
      <small>${Object.keys(p.urls).map((k) => k[0].toUpperCase() + k.slice(1)).join(' · ')}</small></button>`).join('')}</div>`,
    onMount: (el, close) => {
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-preset]'); if (!b) return;
        const pr = S.presets.find((x) => x.preset === b.dataset.preset);
        const same = S.providers.filter((x) => x.preset === pr.preset).length;
        const created = await api('POST', '/api/providers', { ...pr, name: same ? `${pr.name} ${same + 1}` : pr.name });
        close();
        S.providerSel = created.id;
        emit('reload');
        setTimeout(() => $('input[name=apiKey]')?.focus(), 300);
      });
    },
  });
}

// ======================= 设置页 =======================
export function renderSettings() {
  const s = S.settings;
  const theme = localStorage.getItem('noe.theme') || 'system';
  $('#view-settings').innerHTML = `<div class="page narrow">
    <div class="page-head"><div><h1>设置</h1><p>工作区、群聊协作与外观。</p></div></div>
    <div class="set-card">
      <div class="set-row"><div><b>外观</b><small>跟随系统，或固定浅色 / 深色</small></div>
        <div class="seg">${[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([k, l]) => `<button class="${theme === k ? 'on' : ''}" data-theme="${k}">${l}</button>`).join('')}</div></div>
      <div class="set-row"><div><b>新会话先选择工作目录</b><small>第一次发消息前弹出文件夹选择，避免 AI 把东西做在找不到的地方</small></div><label class="switch"><input type="checkbox" name="askCwd" ${s.askCwd !== false ? 'checked' : ''}><i></i></label></div>
      <div class="set-row"><div><b>完成通知</b><small>窗口不在前台时，AI 回复完成后发系统通知</small></div><label class="switch"><input type="checkbox" name="notify" ${s.notify ? 'checked' : ''}><i></i></label></div>
    </div>
    <div class="set-card">
      <div class="set-row col"><div><b>默认工作区</b><small>每个私聊 / 群聊在这里有自己的子目录，AI 在其中读写文件</small></div><input class="input" name="workspace" value="${esc(s.workspace)}"></div>
      <div class="set-row"><div><b>群聊接力轮数</b><small>AI 在回复里 @ 其他成员时自动转交的最大轮数，0 为关闭</small></div><input class="input num" type="number" min="0" max="10" name="maxChain" value="${s.maxChain}"></div>
      <div class="set-row"><div><b>群聊上下文条数</b><small>被 @ 的 AI 能看到的最近群消息条数</small></div><input class="input num" type="number" min="0" max="100" name="historyLimit" value="${s.historyLimit}"></div>
    </div>
    <div class="set-card danger-zone">
      <div class="set-row"><div><b>全自动模式</b><small>跳过 CLI 的所有权限确认（Claude 的 bypassPermissions、Codex 关闭沙箱等）。只在可信目录中开启。</small></div><label class="switch"><input type="checkbox" name="autoApprove" ${s.autoApprove ? 'checked' : ''}><i></i></label></div>
    </div>
    <div class="set-card about">
      <div class="about-head"><img src="icon.svg" alt=""><div><b>Noe Agent <span class="beta-tag">Beta</span></b><small>版本 ${esc(S.version || '')} · MIT 开源协议</small></div>
        <a class="btn sm" href="https://github.com/haha362636-coder/noe-agent" target="_blank" rel="noopener">${icon('git', 14)} GitHub</a></div>
      <div class="beta-note">${icon('info', 15)}<span>这是 Beta 测试版，还会有一些问题。遇到问题欢迎到 GitHub 提 Issue 反馈。</span></div>
      <div class="about-row"><b>致谢</b><span>感谢 <a href="https://claude.com/claude-code" target="_blank" rel="noopener">Claude Code</a> 与 <a href="https://www.electronjs.org" target="_blank" rel="noopener">Electron</a>。</span></div>
      <div class="about-row"><b>支持项目</b><span>如果觉得项目不错，可以<a href="https://nuoyannotebook.xyz/support.html" target="_blank" rel="noopener">支持一下作者 ❤</a></span></div>
    </div>
    <p class="muted small">数据保存在 <code>~/.noe-agent/data.json</code>（仅本机，权限 600）。</p>
  </div>`;
}
function bindSettings() {
  const page = $('#view-settings');
  page.addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme]'); if (!t) return;
    try { localStorage.setItem('noe.theme', t.dataset.theme); } catch { /* 忽略 */ }
    emit('theme'); renderSettings();
  });
  page.addEventListener('change', async (e) => {
    const el = e.target; if (!el.name) return;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value.trim();
    S.settings = await api('PUT', '/api/settings', { [el.name]: v });
    if (el.name === 'notify' && v && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    toast('设置已保存', 'ok');
  });
}

export function bindPages() { bindTools(); bindProviders(); bindSettings(); }
export { sourceMenu };
