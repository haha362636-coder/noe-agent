// MCP 服务器与插件：读取各 CLI 的现有配置，一键安装 / 卸载 / 同步
// 统一的 MCP 配置格式：{ type: 'stdio'|'http'|'sse', command, args, env, url, headers }
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { baseEnv, which } = require('./env');

const HOME = os.homedir();
const P = {
  claude: path.join(HOME, '.claude.json'),
  gemini: path.join(HOME, '.gemini', 'settings.json'),
  qwen: path.join(HOME, '.qwen', 'settings.json'),
  opencode: path.join(HOME, '.config', 'opencode', 'opencode.json'),
};

// ---------- 子进程 ----------
function run(argv, { env, cwd, timeout = 180000, onLog } = {}) {
  return new Promise((resolve) => {
    const bin = which(argv[0]) || argv[0];
    const proc = spawn(bin, argv.slice(1), { env: env || baseEnv(), cwd: cwd || HOME, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (c) => { const s = c.toString(); out += s; onLog?.(s); };
    proc.stdout.on('data', add); proc.stderr.on('data', add);
    const timer = setTimeout(() => { out += '\n[超时，已终止]'; proc.kill('SIGTERM'); }, timeout);
    proc.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, out: e.code === 'ENOENT' ? `未找到命令 ${argv[0]}` : e.message }); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim() }); });
  });
}
const ok = (r, what) => { if (r.code !== 0) throw new Error(`${what}失败：${r.out.split('\n').slice(-6).join('\n') || '退出码 ' + r.code}`); return r; };

// ---------- JSON 配置文件 ----------
function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return fallback;
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`${file.replace(HOME, '~')} 不是合法的 JSON，为避免破坏原配置已停止修改（${e.message}）`); }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 每个文件第一次被 Noe 修改前留一份备份
  const bak = file + '.noe-backup';
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
  const tmp = file + '.noe-tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// ---------- 各 CLI 的 MCP 适配器 ----------
function fromClaudeLike(c) {
  if (c.url || c.httpUrl) return { type: c.type === 'sse' ? 'sse' : 'http', url: c.httpUrl || c.url, headers: c.headers || {} };
  return { type: 'stdio', command: c.command, args: c.args || [], env: c.env || {} };
}

// gemini / qwen 的 settings.json
const geminiAdapter = (file) => ({
  async list() {
    const s = readJson(file);
    return Object.entries(s.mcpServers || {}).map(([name, c]) => ({ name, ...fromClaudeLike(c), disabled: !!c.disabled }));
  },
  async add(name, c) {
    const s = readJson(file);
    s.mcpServers ||= {};
    s.mcpServers[name] = c.type === 'stdio' ? { command: c.command, args: c.args, ...(Object.keys(c.env || {}).length ? { env: c.env } : {}) }
      : c.type === 'sse' ? { url: c.url, ...(Object.keys(c.headers || {}).length ? { headers: c.headers } : {}) }
      : { httpUrl: c.url, ...(Object.keys(c.headers || {}).length ? { headers: c.headers } : {}) };
    writeJson(file, s);
    return ['只会在受信任的目录中加载 MCP（第一次在某个目录运行时会询问是否信任）'];
  },
  async remove(name) {
    const s = readJson(file);
    if (s.mcpServers) delete s.mcpServers[name];
    writeJson(file, s);
  },
});

const ADAPTERS = {
  claude: {
    label: 'Claude Code', configPath: '~/.claude.json（用户级）',
    async list() {
      const s = readJson(P.claude);
      return Object.entries(s.mcpServers || {}).map(([name, c]) => ({ name, ...fromClaudeLike(c) }));
    },
    async add(name, c) {
      const json = c.type === 'stdio'
        ? { type: 'stdio', command: c.command, args: c.args, env: c.env || {} }
        : { type: c.type, url: c.url, ...(Object.keys(c.headers || {}).length ? { headers: c.headers } : {}) };
      // 已存在时先删再加，等同于覆盖
      await run(['claude', 'mcp', 'remove', '-s', 'user', name]);
      ok(await run(['claude', 'mcp', 'add-json', '-s', 'user', name, JSON.stringify(json)]), '添加到 Claude Code ');
    },
    async remove(name) { ok(await run(['claude', 'mcp', 'remove', '-s', 'user', name]), '从 Claude Code 移除'); },
    loginArgv: (name) => ['claude', 'mcp', 'login', name],
  },
  codex: {
    label: 'Codex', configPath: '~/.codex/config.toml',
    async list() {
      const r = await run(['codex', 'mcp', 'list', '--json'], { timeout: 30000 });
      if (r.code !== 0) throw new Error(r.out.split('\n')[0]);
      const arr = JSON.parse(r.out.slice(r.out.indexOf('[')));
      return arr.map((x) => {
        const t = x.transport || {};
        return t.type === 'stdio'
          ? { name: x.name, type: 'stdio', command: t.command, args: t.args || [], env: t.env || {}, disabled: x.enabled === false }
          : { name: x.name, type: 'http', url: t.url, headers: {}, disabled: x.enabled === false };
      });
    },
    async add(name, c, ctx) {
      await run(['codex', 'mcp', 'remove', name]);
      const argv = ['codex', 'mcp', 'add', name];
      const notes = [];
      if (c.type === 'stdio') {
        for (const [k, v] of Object.entries(c.env || {})) argv.push('--env', `${k}=${v}`);
        argv.push('--', c.command, ...c.args);
      } else {
        argv.push('--url', c.url);
        // Codex 只支持从环境变量读取 Bearer Token：存进 Noe 的全局环境变量，由 Noe 启动 Codex 时注入
        const auth = Object.entries(c.headers || {}).find(([k]) => k.toLowerCase() === 'authorization');
        if (auth) {
          const envName = 'NOE_MCP_' + name.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_TOKEN';
          ctx.setEnv(envName, auth[1].replace(/^Bearer\s+/i, ''));
          argv.push('--bearer-token-env-var', envName);
          notes.push(`Token 保存在 Noe 中，只有从 Noe 启动的 Codex 能使用（环境变量 ${envName}）`);
        }
        const others = Object.keys(c.headers || {}).filter((k) => k.toLowerCase() !== 'authorization');
        if (others.length) notes.push(`Codex 不支持自定义请求头，已忽略：${others.join(', ')}`);
      }
      ok(await run(argv), '添加到 Codex ');
      return notes;
    },
    async remove(name) { ok(await run(['codex', 'mcp', 'remove', name]), '从 Codex 移除'); },
    loginArgv: (name) => ['codex', 'mcp', 'login', name],
  },
  gemini: { label: 'Gemini CLI', configPath: '~/.gemini/settings.json', ...geminiAdapter(P.gemini) },
  qwen: { label: 'Qwen Code', configPath: '~/.qwen/settings.json', ...geminiAdapter(P.qwen) },
  opencode: {
    label: 'OpenCode', configPath: '~/.config/opencode/opencode.json',
    async list() {
      const s = readJson(P.opencode);
      return Object.entries(s.mcp || {}).map(([name, c]) => c.type === 'remote'
        ? { name, type: 'http', url: c.url, headers: c.headers || {}, disabled: c.enabled === false }
        : { name, type: 'stdio', command: (c.command || [])[0], args: (c.command || []).slice(1), env: c.environment || {}, disabled: c.enabled === false });
    },
    async add(name, c) {
      const s = readJson(P.opencode, { $schema: 'https://opencode.ai/config.json' });
      s.mcp ||= {};
      s.mcp[name] = c.type === 'stdio'
        ? { type: 'local', command: [c.command, ...c.args], ...(Object.keys(c.env || {}).length ? { environment: c.env } : {}), enabled: true }
        : { type: 'remote', url: c.url, ...(Object.keys(c.headers || {}).length ? { headers: c.headers } : {}), enabled: true };
      writeJson(P.opencode, s);
    },
    async remove(name) {
      const s = readJson(P.opencode);
      if (s.mcp) delete s.mcp[name];
      writeJson(P.opencode, s);
    },
  },
};

const mcpAgents = () => Object.keys(ADAPTERS);

/** 汇总所有已安装 CLI 的 MCP 配置：{ [agentId]: { ok, servers, error } } */
async function listAll(installed) {
  const res = {};
  await Promise.all(mcpAgents().filter((id) => installed(id)).map(async (id) => {
    try {
      const servers = await ADAPTERS[id].list();
      // ChatGPT 桌面版给 Codex 注入的内置服务器，只能在 ChatGPT 环境里运行，不适合同步到别的工具
      for (const sv of servers) if (/ChatGPT\.app|CODEX_MCP_NODE_PATH/.test([sv.command, ...(sv.args || [])].join(' '))) sv.builtin = true;
      res[id] = { ok: true, servers };
    }
    catch (e) { res[id] = { ok: false, servers: [], error: e.message }; }
  }));
  return res;
}

// ---------- 模板与导入 ----------
function fillTemplate(entry, values, ctx) {
  const v = { WORKSPACE: ctx.workspace, HOME };
  const sub = (str) => String(str).replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? '');
  for (const p of entry.params || []) {
    const val = String(values[p.key] ?? '').trim();
    v[p.key] = val || (p.default ? sub(p.default) : '');
    if (p.required && !v[p.key]) throw new Error(`请填写「${p.label}」`);
  }
  // 可选参数留空时，去掉引用它的 env / header
  const empty = (str) => { const ks = [...String(str).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]); return ks.length > 0 && ks.every((k) => !v[k]); };
  const dict = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, val]) => !empty(val)).map(([k, val]) => [k, sub(val)]));
  const c = entry.config;
  return c.type === 'stdio'
    ? { type: 'stdio', command: c.command, args: (c.args || []).map(sub), env: dict(c.env) }
    : { type: c.type, url: sub(c.url), headers: dict(c.headers) };
}

/** 解析用户粘贴的配置：支持 {mcpServers:{...}}、{mcp:{...}}（OpenCode）、{name:{...}} 和单个服务器对象 */
function parseImport(text) {
  let j;
  try { j = JSON.parse(String(text).trim().replace(/,\s*([}\]])/g, '$1')); }
  catch (e) { throw new Error('不是合法的 JSON：' + e.message); }
  let map = j.mcpServers || j.servers || j.mcp || j;
  if (map.command || map.url || map.httpUrl) map = { 'imported-server': map };
  const out = [];
  for (const [name, c] of Object.entries(map)) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'local' && Array.isArray(c.command)) out.push({ name, type: 'stdio', command: c.command[0], args: c.command.slice(1), env: c.environment || {} });
    else if (c.type === 'remote') out.push({ name, type: 'http', url: c.url, headers: c.headers || {} });
    else if (c.command || c.url || c.httpUrl || c.serverUrl) out.push({ name, ...fromClaudeLike({ ...c, url: c.url || c.serverUrl }) });
  }
  if (!out.length) throw new Error('没有找到 MCP 服务器配置');
  return out;
}

function normalize(c) {
  const name = String(c.name || '').trim();
  if (!/^[\w.-]+$/.test(name)) throw new Error('名称只能包含字母、数字、下划线、点和短横线');
  if (c.type === 'stdio') {
    if (!c.command) throw new Error('请填写启动命令');
    return { name, type: 'stdio', command: String(c.command).trim(), args: (c.args || []).map(String), env: c.env || {} };
  }
  if (!/^https?:\/\//.test(c.url || '')) throw new Error('请填写正确的 URL');
  return { name, type: c.type === 'sse' ? 'sse' : 'http', url: c.url.trim(), headers: c.headers || {} };
}

// ---------- 插件 ----------
async function claudePlugins() {
  const [mk, pl] = await Promise.all([
    run(['claude', 'plugin', 'marketplace', 'list', '--json'], { timeout: 60000 }),
    run(['claude', 'plugin', 'list', '--available', '--json'], { timeout: 120000 }),
  ]);
  const parse = (r) => { try { return JSON.parse(r.out.slice(r.out.search(/[[{]/))); } catch { return null; } };
  const markets = parse(mk) || [];
  const plugins = parse(pl) || { installed: [], available: [] };
  return {
    markets: markets.map((m) => ({ name: m.name, source: m.repo || m.url || m.path || m.source })),
    installed: (plugins.installed || []).map((p) => ({ id: p.id, version: p.version, scope: p.scope, enabled: p.enabled !== false })),
    available: (plugins.available || []).map((p) => ({ id: p.pluginId, name: p.name, desc: p.description || '', market: p.marketplaceName, installs: p.installCount || 0 })),
  };
}
async function codexPlugins() {
  const r = await run(['codex', 'plugin', 'list', '--json', '--available'], { timeout: 120000 });
  if (r.code !== 0) throw new Error(r.out.split('\n')[0]);
  const d = JSON.parse(r.out.slice(r.out.indexOf('{')));
  const map = (p) => ({ id: p.pluginId, name: p.name, market: p.marketplaceName, version: p.version, enabled: p.enabled });
  return { installed: (d.installed || []).map(map), available: (d.available || []).filter((p) => !p.installed).map(map) };
}
function geminiExtensions() {
  const dir = path.join(HOME, '.gemini', 'extensions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).map((n) => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, n, 'gemini-extension.json'), 'utf8'));
      return { name: m.name || n, version: m.version || '', desc: m.description || '', mcp: Object.keys(m.mcpServers || {}) };
    } catch { return null; }
  }).filter(Boolean);
}

module.exports = { ADAPTERS, mcpAgents, listAll, fillTemplate, parseImport, normalize, run, ok, claudePlugins, codexPlugins, geminiExtensions };
