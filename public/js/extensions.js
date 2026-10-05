// 扩展页：MCP 服务器（目录、已安装矩阵、自定义 / 导入）与插件（Claude 插件市场、Codex 插件、Gemini 扩展）
import { $, $$, esc, S, api, toast, icon, avatar, agentById, modal, confirmBox, menu, emit } from './core.js';

const E = {
  tab: 'mcp', cat: '全部', q: '',
  mcp: null, loading: false,
  pluginAgent: null, plugins: {}, pluginMeta: null, pq: '', busy: new Set(),
};

// ======================= 入口 =======================
export async function renderExtensions({ soft } = {}) {
  const page = $('#view-ext');
  if (!soft || !page.querySelector('.ext')) {
    page.innerHTML = `<div class="page ext">
      <div class="page-head">
        <div><h1>MCP 与插件</h1><p>一键把 MCP 服务器装进多个 AI 工具，管理 Claude Code 插件市场、Codex 插件和 Gemini 扩展。</p></div>
        <div class="seg big">
          <button data-tab="mcp" class="${E.tab === 'mcp' ? 'on' : ''}">${icon('plug', 15)} MCP 服务器</button>
          <button data-tab="plugins" class="${E.tab === 'plugins' ? 'on' : ''}">${icon('puzzle', 15)} 插件</button>
        </div>
      </div>
      <div id="ext-body"></div>
    </div>`;
  }
  if (E.tab === 'mcp') { if (!E.mcp || !soft) await loadMcp(); drawMcp(); }
  else { await loadPluginMeta(); drawPlugins(); }
}

async function loadMcp() {
  E.loading = true;
  try { E.mcp = await api('GET', '/api/ext/mcp'); }
  catch (e) { toast(e.message, 'error'); }
  E.loading = false;
}

// ======================= MCP =======================
const mcpAgents = () => (E.mcp?.agents || []).filter((a) => a.installed);

function installedMap() {
  // name -> { [agentId]: serverConfig }
  const map = {};
  for (const [aid, r] of Object.entries(E.mcp?.configs || {})) for (const s of r.servers) (map[s.name] ||= {})[aid] = s;
  return map;
}

function drawMcp() {
  const body = $('#ext-body'); if (!body || !E.mcp) return;
  const agents = mcpAgents();
  const map = installedMap();
  const names = Object.keys(map).sort();
  const cats = ['全部', ...new Set(E.mcp.catalog.map((c) => c.category))];
  const q = E.q.toLowerCase();
  const list = E.mcp.catalog.filter((c) => (E.cat === '全部' || c.category === E.cat) && (!q || (c.name + c.en + c.desc + c.id).toLowerCase().includes(q)));
  const errors = Object.entries(E.mcp.configs).filter(([, r]) => !r.ok);
  const warn = [
    !E.mcp.tools.node ? '未检测到 npx（Node.js），基于 npx 的 MCP 无法启动' : '',
    !E.mcp.tools.uv ? '未检测到 uvx，Git / 网页抓取 / 时间等 Python MCP 需要先安装 uv：<code>brew install uv</code>' : '',
    ...errors.map(([id, r]) => `读取 ${esc(agentName(id))} 配置失败：${esc(r.error)}`),
  ].filter(Boolean);

  body.innerHTML = `
    ${!agents.length ? `<div class="banner warn">${icon('alert', 16)} 还没有安装支持 MCP 的工具（Claude Code / Codex / Gemini / Qwen / OpenCode），<a href="#" data-goto="tools">去安装</a></div>` : ''}
    ${warn.map((w) => `<div class="banner">${icon('info', 15)} <span>${w}</span></div>`).join('')}

    <div class="sec-head"><h2>已安装 <span class="count">${names.length}</span></h2>
      <div class="sec-tools"><button class="btn sm" data-act="import">${icon('download', 14)} 导入 JSON</button><button class="btn sm" data-act="custom">${icon('plus', 14)} 自定义 MCP</button>
      <button class="icon-btn ghost sm" data-act="reload" title="刷新">${icon('refresh', 15)}</button></div></div>
    ${names.length ? `<div class="matrix">
      <div class="mx-row mx-head"><div class="mx-name">服务器</div>${agents.map((a) => `<div class="mx-cell">${avatar(agentById(a.id), 22)}<span>${esc(a.label)}</span></div>`).join('')}<div class="mx-act"></div></div>
      ${names.map((n) => {
        const row = map[n];
        const any = Object.values(row)[0];
        const cat = E.mcp.catalog.find((c) => c.id === n);
        const builtin = Object.values(row).some((x) => x.builtin);
        const missing = builtin ? [] : agents.filter((a) => !row[a.id]);
        return `<div class="mx-row" data-name="${esc(n)}">
          <div class="mx-name">${tile(cat, 30)}<div><b>${esc(n)}${builtin ? ' <span class="tag" title="ChatGPT 桌面版为 Codex 注入的服务器，只能在 ChatGPT 环境中运行">ChatGPT 内置</span>' : ''}</b><small>${esc(describe(any))}</small></div></div>
          ${agents.map((a) => row[a.id]
            ? `<div class="mx-cell"><button class="mx-on ${row[a.id].disabled ? 'off' : ''}" data-cell="${a.id}" data-menu-anchor title="${row[a.id].disabled ? '已禁用' : '已安装'}">${icon('check', 14)}</button></div>`
            : builtin ? '<div class="mx-cell"><span class="muted">—</span></div>' : `<div class="mx-cell"><button class="mx-add" data-sync="${a.id}" title="同步到 ${esc(a.label)}">${icon('plus', 14)}</button></div>`).join('')}
          <div class="mx-act">${missing.length ? `<button class="btn xs" data-sync-all title="同步到所有工具">同步全部</button>` : ''}<button class="icon-btn ghost xs" data-remove-all title="从所有工具移除">${icon('trash', 14)}</button></div>
        </div>`;
      }).join('')}
    </div>` : `<div class="empty-box">${icon('plug', 26)}<p>还没有安装 MCP 服务器，从下面的推荐里挑一个吧</p></div>`}

    <div class="sec-head"><h2>推荐 MCP</h2>
      <div class="sec-tools"><div class="search sm">${icon('search', 14)}<input id="mcp-q" placeholder="搜索 MCP" value="${esc(E.q)}"></div></div></div>
    <div class="chips-row">${cats.map((c) => `<button class="fchip ${c === E.cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="mcp-grid">${list.map((c) => {
      const where = agents.filter((a) => map[c.id]?.[a.id]);
      return `<div class="mcp-card" data-cat-id="${c.id}">
        <div class="mc-top">${tile(c, 40)}<div class="mc-name"><b>${esc(c.name)}</b><small>${esc(c.en)} · ${esc(c.category)}</small></div>
          ${c.config.type === 'stdio' ? `<span class="pill">本地</span>` : `<span class="pill blue">远程</span>`}</div>
        <p>${esc(c.desc)}</p>
        <div class="mc-foot">
          <div class="mc-tags">${c.requires ? `<span class="tag ${E.mcp.tools[c.requires] ? '' : 'warn'}">需要 ${c.requires === 'uv' ? 'uv' : 'Node.js'}</span>` : ''}${c.params?.some((p) => p.required && p.secret) ? '<span class="tag">需要 Key</span>' : ''}${c.auth === 'oauth' ? '<span class="tag">需授权</span>' : ''}
            ${where.length ? `<span class="where">${where.map((a) => avatar(agentById(a.id), 18)).join('')}</span>` : ''}</div>
          <button class="btn sm ${where.length === agents.length && agents.length ? '' : 'primary'}" data-install="${c.id}" ${agents.length ? '' : 'disabled'}>${where.length === agents.length && agents.length ? '重新配置' : where.length ? '装到更多' : '一键安装'}</button>
        </div></div>`;
    }).join('') || '<p class="muted">没有匹配的 MCP</p>'}</div>`;
}

const agentName = (id) => E.mcp?.agents.find((a) => a.id === id)?.label || id;
function tile(c, size) {
  if (!c) return `<span class="mc-tile" style="--c:#64748b;--s:${size}px">${icon('plug', size * 0.5)}</span>`;
  return `<span class="mc-tile" style="--c:${c.color};--s:${size}px">${icon(c.icon || 'plug', size * 0.5)}</span>`;
}
function describe(s) {
  if (!s) return '';
  return s.type === 'stdio' ? [s.command, ...(s.args || [])].join(' ') : `${s.type.toUpperCase()} · ${s.url}`;
}

function targetsHtml(preselect) {
  const agents = mcpAgents();
  return `<div class="field"><span>安装到</span><div class="targets">${agents.map((a) => `<label class="target"><input type="checkbox" value="${a.id}" ${preselect(a) ? 'checked' : ''}>${avatar(agentById(a.id), 22)}<span>${esc(a.label)}<small>${esc(a.configPath)}</small></span></label>`).join('')}</div></div>`;
}
const checkedTargets = (el) => $$('.targets input:checked', el).map((i) => i.value);

function resultsHtml(results, oauth = [], name) {
  return `<div class="results">${results.map((r) => `<div class="res ${r.ok ? 'ok' : 'bad'}">${icon(r.ok ? 'check' : 'alert', 15)}<b>${esc(agentName(r.agent))}</b>
    <span>${r.ok ? '已安装' : esc(r.error)}${(r.notes || []).map((n) => `<br><small>${esc(n)}</small>`).join('')}</span>
    ${r.ok && oauth.includes(r.agent) ? `<button class="btn xs" data-oauth="${r.agent}" data-name="${esc(name)}">去授权</button>` : ''}</div>`).join('')}</div>`;
}

function installDialog(c) {
  const map = installedMap();
  modal({
    title: `安装 ${c.name}`, width: 560,
    body: `<div class="mc-intro">${tile(c, 44)}<div><b>${esc(c.name)}</b><p>${esc(c.desc)}</p>
        <code class="cfg-preview">${esc(c.config.type === 'stdio' ? [c.config.command, ...c.config.args].join(' ') : c.config.url)}</code></div></div>
      ${(c.params || []).map((p) => `<label class="field"><span>${esc(p.label)}${p.required ? ' *' : ''} ${p.help ? `<a class="link" href="${esc(p.help)}" target="_blank" rel="noopener">${icon('link', 11)} 获取</a>` : ''}</span>
        <input data-param="${p.key}" ${p.secret ? 'type="password" autocomplete="off"' : ''} value="${esc(p.default ? p.default.replace('{{WORKSPACE}}', S.settings.workspace || '') : '')}" placeholder="${p.required ? '必填' : '可留空'}"></label>`).join('')}
      <label class="field"><span>名称（在各工具里显示的 ID）</span><input data-name value="${esc(c.id)}"></label>
      ${targetsHtml((a) => !map[c.id]?.[a.id])}
      ${c.auth === 'oauth' ? `<p class="note">${icon('info', 13)} 这是需要账号授权的远程服务，安装后点「去授权」在内置终端完成登录。</p>` : ''}
      <div id="inst-res"></div>`,
    actions: [{ label: '关闭' }, {
      label: '安装', primary: true, onClick: async (el) => {
        const values = Object.fromEntries($$('[data-param]', el).map((i) => [i.dataset.param, i.value]));
        const targets = checkedTargets(el);
        const name = $('[data-name]', el).value.trim();
        const box = $('#inst-res', el);
        box.innerHTML = `<div class="res">${'<span class="spinner"></span>'} 正在安装…</div>`;
        try {
          const r = await api('POST', '/api/ext/mcp/install', { catalogId: c.id, values, targets, name });
          box.innerHTML = resultsHtml(r.results, r.oauth, name);
          if (r.results.every((x) => x.ok)) toast(`${c.name} 安装完成`, 'ok');
        } catch (e) { box.innerHTML = `<div class="res bad">${icon('alert', 15)} ${esc(e.message)}</div>`; }
        return false;
      },
    }],
  });
}

function oauthClick(e) {
  const b = e.target.closest('[data-oauth]'); if (!b) return;
  api('POST', '/api/ext/mcp/login', { agent: b.dataset.oauth, name: b.dataset.name })
    .then((r) => emit('term.focus', r.term)).catch((er) => toast(er.message, 'error'));
}

function splitArgs(s) {
  const out = []; let cur = '', q = null, has = false;
  for (const ch of String(s).trim()) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}
const parseKV = (text, sep) => Object.fromEntries(String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const i = l.indexOf(sep); return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
}));

function customDialog(prefill) {
  let type = prefill?.type || 'stdio';
  const map = installedMap();
  const p = prefill || {};
  modal({
    title: prefill ? `编辑并安装 ${p.name}` : '自定义 MCP 服务器', width: 580,
    body: `<label class="field"><span>名称</span><input data-f="name" value="${esc(p.name || '')}" placeholder="例如 my-server"></label>
      <div class="field"><span>类型</span><div class="seg" id="cm-type">${['stdio', 'http', 'sse'].map((t) => `<button data-t="${t}" class="${t === type ? 'on' : ''}">${t === 'stdio' ? '本地命令 (stdio)' : t === 'http' ? '远程 HTTP' : '远程 SSE'}</button>`).join('')}</div></div>
      <div data-show="stdio">
        <label class="field"><span>启动命令</span><input data-f="cmdline" value="${esc(p.command ? [p.command, ...(p.args || [])].map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ') : '')}" placeholder="npx -y @scope/some-mcp-server --flag"></label>
        <label class="field"><span>环境变量（每行 KEY=VALUE）</span><textarea data-f="env" rows="3" placeholder="API_KEY=xxx">${esc(Object.entries(p.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'))}</textarea></label>
      </div>
      <div data-show="remote">
        <label class="field"><span>URL</span><input data-f="url" value="${esc(p.url || '')}" placeholder="https://example.com/mcp"></label>
        <label class="field"><span>请求头（每行 Key: Value）</span><textarea data-f="headers" rows="3" placeholder="Authorization: Bearer xxx">${esc(Object.entries(p.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n'))}</textarea></label>
      </div>
      ${targetsHtml((a) => !map[p.name]?.[a.id])}
      <div id="inst-res"></div>`,
    onMount: (el) => {
      const sync = () => { $('[data-show="stdio"]', el).classList.toggle('hidden', type !== 'stdio'); $('[data-show="remote"]', el).classList.toggle('hidden', type === 'stdio'); };
      $('#cm-type', el).onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; type = b.dataset.t; $$('#cm-type button', el).forEach((x) => x.classList.toggle('on', x === b)); sync(); };
      sync();
    },
    actions: [{ label: '关闭' }, {
      label: '安装', primary: true, onClick: async (el) => {
        const f = (k) => $(`[data-f="${k}"]`, el).value;
        const argv = splitArgs(f('cmdline'));
        const server = type === 'stdio'
          ? { name: f('name'), type, command: argv[0], args: argv.slice(1), env: parseKV(f('env'), '=') }
          : { name: f('name'), type, url: f('url').trim(), headers: parseKV(f('headers'), ':') };
        const box = $('#inst-res', el);
        box.innerHTML = '<div class="res"><span class="spinner"></span> 正在安装…</div>';
        try {
          const r = await api('POST', '/api/ext/mcp/install', { server, targets: checkedTargets(el) });
          box.innerHTML = resultsHtml(r.results);
          if (r.results.every((x) => x.ok)) toast(`${server.name} 安装完成`, 'ok');
        } catch (e) { box.innerHTML = `<div class="res bad">${icon('alert', 15)} ${esc(e.message)}</div>`; }
        return false;
      },
    }],
  });
}

function importDialog() {
  modal({
    title: '导入 MCP 配置', width: 600,
    body: `<p class="muted small" style="margin-top:0">粘贴 MCP 文档里常见的 JSON 配置，例如 <code>{"mcpServers": {...}}</code>，支持 Claude / Cursor / Gemini / OpenCode 格式，可一次导入多个。</p>
      <textarea class="code-input" id="imp-text" rows="9" placeholder='{
  "mcpServers": {
    "my-server": { "command": "npx", "args": ["-y", "some-mcp"], "env": { "API_KEY": "xxx" } }
  }
}'></textarea>
      <div id="imp-preview"></div>
      ${targetsHtml(() => true)}
      <div id="inst-res"></div>`,
    actions: [{ label: '关闭' }, {
      label: '解析并安装', primary: true, onClick: async (el) => {
        const box = $('#inst-res', el);
        try {
          const { servers } = await api('POST', '/api/ext/mcp/import', { text: $('#imp-text', el).value });
          $('#imp-preview', el).innerHTML = `<div class="imp-list">${servers.map((s) => `<div>${icon('plug', 13)} <b>${esc(s.name)}</b> <small>${esc(describe(s))}</small></div>`).join('')}</div>`;
          box.innerHTML = '<div class="res"><span class="spinner"></span> 正在安装…</div>';
          let html = '';
          for (const s of servers) {
            const r = await api('POST', '/api/ext/mcp/install', { server: s, targets: checkedTargets(el) });
            html += `<div class="res-group"><b>${esc(s.name)}</b>${resultsHtml(r.results)}</div>`;
          }
          box.innerHTML = html;
        } catch (e) { box.innerHTML = `<div class="res bad">${icon('alert', 15)} ${esc(e.message)}</div>`; }
        return false;
      },
    }],
  });
}

async function syncServer(name, targets) {
  const row = installedMap()[name];
  const src = Object.values(row)[0];
  const t = toastBusy(`正在把 ${name} 同步到 ${targets.map(agentName).join('、')}…`);
  try {
    const r = await api('POST', '/api/ext/mcp/install', { server: { ...src, name }, targets });
    const bad = r.results.filter((x) => !x.ok);
    bad.length ? toast(bad.map((x) => `${agentName(x.agent)}：${x.error}`).join('；'), 'error') : toast(`${name} 已同步`, 'ok');
    const notes = r.results.flatMap((x) => x.notes || []);
    if (notes.length) toast(notes[0]);
  } catch (e) { toast(e.message, 'error'); }
  t.remove();
}
async function removeServer(name, agents) {
  if (!(await confirmBox(`从 ${agents.map(agentName).join('、')} 移除 MCP「${name}」？`, { danger: true, ok: '移除' }))) return;
  const r = await api('POST', '/api/ext/mcp/remove', { name, agents });
  const bad = r.results.filter((x) => !x.ok);
  bad.length ? toast(bad.map((x) => `${agentName(x.agent)}：${x.error}`).join('；'), 'error') : toast('已移除', 'ok');
}
function toastBusy(text) {
  const el = document.createElement('div'); el.className = 'toast show'; el.innerHTML = `<span class="spinner"></span><span>${esc(text)}</span>`;
  $('#toasts').appendChild(el); return el;
}

// ======================= 插件 =======================
async function loadPluginMeta() {
  if (!E.pluginMeta) E.pluginMeta = await api('GET', '/api/ext/plugins');
  const av = E.pluginMeta.agents;
  if (!E.pluginAgent || !av[E.pluginAgent]) E.pluginAgent = ['claude', 'codex', 'gemini'].find((a) => av[a]) || 'claude';
}
async function loadPlugins(agent, fresh) {
  E.plugins[agent] = { loading: true, ...(E.plugins[agent] || {}) };
  drawPlugins();
  try { E.plugins[agent] = await api('GET', `/api/ext/plugins/${agent}${fresh ? '?fresh=1' : ''}`); }
  catch (e) { E.plugins[agent] = { error: e.message }; }
  drawPlugins();
}

const P_AGENTS = [['claude', 'Claude Code', '插件市场'], ['codex', 'Codex', '插件'], ['gemini', 'Gemini CLI', '扩展']];

function drawPlugins() {
  const body = $('#ext-body'); if (!body || E.tab !== 'plugins') return;
  const av = E.pluginMeta.agents;
  const a = E.pluginAgent;
  const d = E.plugins[a];
  if (av[a] && !d) { loadPlugins(a); return; }
  body.innerHTML = `
    <div class="agent-tabs">${P_AGENTS.map(([id, label, sub]) => `<button class="atab ${id === a ? 'on' : ''}" data-pagent="${id}" ${av[id] ? '' : 'disabled'}>${avatar(agentById(id), 26)}<span><b>${label}</b><small>${av[id] ? sub : '未安装'}</small></span></button>`).join('')}</div>
    ${!av[a] ? `<div class="empty-box">${icon('puzzle', 26)}<p>${esc(agentById(a)?.name)} 还没有安装</p><button class="btn primary sm" data-goto="tools">去安装</button></div>`
      : d?.error ? `<div class="banner warn">${icon('alert', 16)} ${esc(d.error)}</div>`
      : d?.loading && !d.installed ? `<div class="loading-box"><span class="spinner"></span> 正在读取${a === 'claude' ? '插件市场（首次可能需要十几秒）' : '插件列表'}…</div>`
      : a === 'claude' ? claudeHtml(d) : a === 'codex' ? codexHtml(d) : geminiHtml(d)}`;
}

const busyBtn = (key, label, cls = 'primary', extra = '') => E.busy.has(key)
  ? `<button class="btn xs ${cls}" disabled><span class="spinner"></span></button>`
  : `<button class="btn xs ${cls}" ${extra}>${label}</button>`;

function claudeHtml(d) {
  const inst = new Map(d.installed.map((p) => [p.id, p]));
  const q = E.pq.toLowerCase();
  const avail = d.available.filter((p) => !q || (p.name + ' ' + p.desc).toLowerCase().includes(q)).sort((x, y) => y.installs - x.installs);
  const recos = E.pluginMeta.claudeMarkets.filter((m) => !d.markets.some((x) => x.name === m.name));
  return `
    <div class="sec-head"><h2>插件市场 <span class="count">${d.markets.length}</span></h2><div class="sec-tools">
      <button class="btn sm" data-pact="market-update" data-target="">${E.busy.has('market-update') ? '<span class="spinner"></span>' : icon('refresh', 14)} 更新市场</button></div></div>
    <div class="markets">
      ${d.markets.map((m) => `<div class="market">${icon('box', 16)}<div><b>${esc(m.name)}</b><small>${esc(m.source || '')}</small></div><button class="icon-btn ghost xs" data-pact="market-remove" data-target="${esc(m.name)}" title="移除市场">${icon('x', 13)}</button></div>`).join('')}
      ${recos.map((m) => `<div class="market reco">${icon('sparkles', 16)}<div><b>${esc(m.title)}</b><small>${esc(m.desc)}</small></div>${busyBtn('market-add:' + m.source, '一键添加', 'primary', `data-pact="market-add" data-target="${esc(m.source)}"`)}</div>`).join('')}
      <form class="market add" id="market-form">${icon('plus', 16)}<input name="src" placeholder="添加市场：GitHub 仓库（owner/repo）、Git URL 或本地路径"><button class="btn xs">添加</button></form>
    </div>

    ${d.installed.length ? `<div class="sec-head"><h2>已安装 <span class="count">${d.installed.length}</span></h2></div>
    <div class="plist2">${d.installed.map((p) => {
      const info = d.available.find((x) => x.id === p.id);
      return `<div class="prow"><span class="p-ic">${icon('puzzle', 16)}</span><div class="pr-main"><b>${esc(p.id.split('@')[0])}</b><small>${esc(info?.desc || p.id)}</small></div>
        <span class="muted small">v${esc(String(p.version).slice(0, 12))}</span>
        <label class="switch" title="${p.enabled ? '已启用' : '已停用'}"><input type="checkbox" data-ptoggle="${esc(p.id)}" ${p.enabled ? 'checked' : ''}><i></i></label>
        <button class="icon-btn ghost xs" data-pact="update" data-target="${esc(p.id)}" title="更新">${icon('refresh', 14)}</button>
        <button class="icon-btn ghost xs" data-pact="uninstall" data-target="${esc(p.id)}" title="卸载">${icon('trash', 14)}</button></div>`;
    }).join('')}</div>` : ''}

    <div class="sec-head"><h2>发现插件 <span class="count">${d.available.length}</span></h2><div class="sec-tools">
      <div class="search sm">${icon('search', 14)}<input id="plugin-q" placeholder="搜索插件" value="${esc(E.pq)}"></div>
      <button class="icon-btn ghost sm" data-preload title="刷新">${icon('refresh', 15)}</button></div></div>
    ${!d.markets.length ? `<div class="empty-box">${icon('box', 26)}<p>先添加一个插件市场，推荐上面的 Anthropic 官方目录</p></div>` : ''}
    <div class="pgrid">${avail.slice(0, 90).map((p) => `<div class="pcard">
      <div class="pc-top"><span class="p-ic">${icon('puzzle', 16)}</span><b>${esc(p.name)}</b>${p.installs ? `<span class="muted small">${icon('download', 11)} ${p.installs >= 1000 ? (p.installs / 1000).toFixed(1) + 'k' : p.installs}</span>` : ''}</div>
      <p>${esc(p.desc)}</p>
      <div class="pc-foot"><small class="muted">${esc(p.market)}</small>${inst.has(p.id) ? '<span class="tag ok">已安装</span>' : busyBtn('install:' + p.id, '安装', 'primary', `data-pact="install" data-target="${esc(p.id)}"`)}</div></div>`).join('')}</div>
    ${avail.length > 90 ? `<p class="muted small center">还有 ${avail.length - 90} 个，用搜索缩小范围</p>` : ''}`;
}

function codexHtml(d) {
  const q = E.pq.toLowerCase();
  const avail = q ? d.available.filter((p) => p.id.toLowerCase().includes(q)).slice(0, 60) : [];
  return `
    <div class="sec-head"><h2>已安装 <span class="count">${d.installed.length}</span></h2><div class="sec-tools"><button class="icon-btn ghost sm" data-preload title="刷新">${icon('refresh', 15)}</button></div></div>
    <div class="plist2">${d.installed.map((p) => `<div class="prow"><span class="p-ic">${icon('puzzle', 16)}</span><div class="pr-main"><b>${esc(p.name)}</b><small>${esc(p.market)}</small></div>
      <span class="muted small">v${esc(p.version || '')}</span>${p.enabled ? '<span class="tag ok">已启用</span>' : '<span class="tag">未启用</span>'}
      <button class="icon-btn ghost xs" data-pact="uninstall" data-target="${esc(p.id)}" title="卸载">${icon('trash', 14)}</button></div>`).join('') || '<p class="muted">还没有安装插件</p>'}</div>
    <div class="sec-head"><h2>搜索插件 <span class="count">${d.available.length}</span></h2><div class="sec-tools"><div class="search sm">${icon('search', 14)}<input id="plugin-q" placeholder="输入名称，例如 github、figma、notion" value="${esc(E.pq)}"></div></div></div>
    ${q ? `<div class="plist2">${avail.map((p) => `<div class="prow"><span class="p-ic">${icon('puzzle', 16)}</span><div class="pr-main"><b>${esc(p.name)}</b><small>${esc(p.market)} · v${esc(p.version || '')}</small></div>
      ${busyBtn('install:' + p.id, '安装', 'primary', `data-pact="install" data-target="${esc(p.id)}"`)}</div>`).join('') || '<p class="muted">没有匹配的插件</p>'}</div>`
      : `<div class="empty-box small">${icon('search', 22)}<p>Codex 的远程插件目录有 ${d.available.length} 个条目，输入关键词搜索</p></div>`}`;
}

function geminiHtml(d) {
  const names = d.installed.map((x) => x.name);
  const has = (n) => names.some((x) => x === n || x.endsWith('-' + n)); // 例如 security 装完叫 gemini-cli-security
  return `
    <div class="sec-head"><h2>已安装扩展 <span class="count">${d.installed.length}</span></h2><div class="sec-tools"><button class="icon-btn ghost sm" data-preload title="刷新">${icon('refresh', 15)}</button></div></div>
    <div class="plist2">${d.installed.map((p) => `<div class="prow"><span class="p-ic">${icon('puzzle', 16)}</span><div class="pr-main"><b>${esc(p.name)}</b><small>${esc(p.desc || (p.mcp.length ? 'MCP：' + p.mcp.join(', ') : ''))}</small></div>
      <span class="muted small">${p.version ? 'v' + esc(p.version) : ''}</span>
      <button class="btn xs" data-gconfig="${esc(p.name)}">配置</button>
      <button class="icon-btn ghost xs" data-pact="update" data-target="${esc(p.name)}" title="更新">${icon('refresh', 14)}</button>
      <button class="icon-btn ghost xs" data-pact="uninstall" data-target="${esc(p.name)}" title="卸载">${icon('trash', 14)}</button></div>`).join('') || '<p class="muted">还没有安装扩展</p>'}</div>
    <form class="market add" id="gext-form">${icon('link', 16)}<input name="src" placeholder="从 GitHub 地址安装扩展，例如 https://github.com/gemini-cli-extensions/workspace"><button class="btn xs">安装</button></form>
    <div class="sec-head"><h2>推荐扩展</h2><div class="sec-tools"><a class="link" href="https://geminicli.com/extensions/" target="_blank" rel="noopener">${icon('globe', 12)} 浏览扩展目录</a></div></div>
    <div class="pgrid">${E.pluginMeta.geminiRecommended.map((x) => `<div class="pcard">
      <div class="pc-top"><span class="p-ic">${icon('puzzle', 16)}</span><b>${esc(x.title)}</b></div><p>${esc(x.desc)}</p>
      <div class="pc-foot"><small class="muted">${esc(x.url.replace('https://github.com/', ''))}</small>${has(x.name) ? '<span class="tag ok">已安装</span>' : busyBtn('install:' + x.url, '安装', 'primary', `data-pact="install" data-target="${esc(x.url)}"`)}</div></div>`).join('')}</div>`;
}

async function pluginAction(action, target) {
  const a = E.pluginAgent;
  const key = action.startsWith('market') && action !== 'market-remove' ? (action === 'market-add' ? 'market-add:' + target : action) : `${action}:${target}`;
  if (['uninstall', 'market-remove'].includes(action) && !(await confirmBox(`${action === 'uninstall' ? '卸载' : '移除市场'}「${target}」？`, { danger: true, ok: '确定' }))) return;
  E.busy.add(key); drawPlugins();
  const label = { install: '安装', uninstall: '卸载', enable: '启用', disable: '停用', update: '更新', 'market-add': '添加市场', 'market-remove': '移除市场', 'market-update': '更新市场' }[action];
  try {
    await api('POST', `/api/ext/plugins/${a}`, { action, target });
    toast(`${label}成功${action === 'install' && a === 'claude' ? '，新会话中生效' : ''}`, 'ok');
  } catch (e) { toast(`${label}失败：${e.message.split('\n').slice(-2).join(' ')}`, 'error'); }
  E.busy.delete(key);
  await loadPlugins(a, true);
}

// ======================= 事件 =======================
export function bindExtensions() {
  const page = $('#view-ext');
  page.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { E.tab = tab.dataset.tab; $$('[data-tab]', page).forEach((b) => b.classList.toggle('on', b === tab)); return renderExtensions({ soft: true }); }
    const cat = e.target.closest('[data-cat]');
    if (cat) { E.cat = cat.dataset.cat; return drawMcp(); }
    const ins = e.target.closest('[data-install]');
    if (ins) return installDialog(E.mcp.catalog.find((c) => c.id === ins.dataset.install));
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'custom') return customDialog();
    if (act === 'import') return importDialog();
    if (act === 'reload') { await loadMcp(); drawMcp(); return toast('已刷新', 'ok'); }
    const row = e.target.closest('.mx-row[data-name]');
    if (row) {
      const name = row.dataset.name;
      const map = installedMap()[name];
      const sync = e.target.closest('[data-sync]');
      if (sync) return syncServer(name, [sync.dataset.sync]);
      if (e.target.closest('[data-sync-all]')) return syncServer(name, mcpAgents().filter((a) => !map[a.id]).map((a) => a.id));
      if (e.target.closest('[data-remove-all]')) return removeServer(name, Object.keys(map));
      const cell = e.target.closest('[data-cell]');
      if (cell) {
        const aid = cell.dataset.cell;
        const s = map[aid];
        const ad = E.mcp.agents.find((x) => x.id === aid);
        return menu(cell, [
          { header: `${ad.label} · ${name}` },
          { html: `<code class="menu-code">${esc(describe(s))}</code>` },
          ...(s.type !== 'stdio' && ad.canLogin ? [{ label: '授权登录', icon: 'login', onClick: () => api('POST', '/api/ext/mcp/login', { agent: aid, name }).then((r) => emit('term.focus', r.term)) }] : []),
          { label: '编辑后重新安装', icon: 'edit', onClick: () => customDialog({ ...s, name }) },
          { label: `从 ${ad.label} 移除`, icon: 'trash', danger: true, onClick: () => removeServer(name, [aid]) },
        ], { width: 320 });
      }
    }
    // 插件
    const pa = e.target.closest('[data-pagent]');
    if (pa && !pa.disabled) { E.pluginAgent = pa.dataset.pagent; E.pq = ''; return drawPlugins(); }
    if (e.target.closest('[data-preload]')) return loadPlugins(E.pluginAgent, true);
    const pact = e.target.closest('[data-pact]');
    if (pact) return pluginAction(pact.dataset.pact, pact.dataset.target);
    const gc = e.target.closest('[data-gconfig]');
    if (gc) return api('POST', '/api/ext/plugins/gemini/configure', { target: gc.dataset.gconfig }).then((r) => emit('term.focus', r.term)).catch((er) => toast(er.message, 'error'));
  });
  page.addEventListener('change', (e) => {
    const t = e.target.closest('[data-ptoggle]');
    if (t) pluginAction(t.checked ? 'enable' : 'disable', t.dataset.ptoggle);
  });
  page.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = e.target.src?.value.trim(); if (!v) return;
    if (e.target.id === 'market-form') pluginAction('market-add', v);
    if (e.target.id === 'gext-form') pluginAction('install', v);
  });
  let qt = null;
  page.addEventListener('input', (e) => {
    if (e.target.id === 'mcp-q') { E.q = e.target.value; clearTimeout(qt); qt = setTimeout(() => { drawMcp(); refocus('#mcp-q'); }, 150); }
    if (e.target.id === 'plugin-q') { E.pq = e.target.value; clearTimeout(qt); qt = setTimeout(() => { drawPlugins(); refocus('#plugin-q'); }, 150); }
  });
  document.addEventListener('click', oauthClick);
}
function refocus(sel) { const i = $(sel); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }

/** SSE：外部修改后刷新 */
export async function onExtChanged(detail) {
  if (S.view !== 'ext') { E.mcp = null; if (detail.kind === 'plugins') delete E.plugins[detail.agent]; return; }
  if (detail.kind === 'mcp' && E.tab === 'mcp') { await loadMcp(); drawMcp(); }
}
export function invalidateExt() { E.mcp = null; E.pluginMeta = null; }
