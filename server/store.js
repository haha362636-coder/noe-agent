// 简单的 JSON 持久化：~/.noe-agent/data.json（权限 600，内含 API Key）
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.NOE_HOME || path.join(os.homedir(), '.noe-agent');
const FILE = path.join(DIR, 'data.json');

const defaults = () => ({
  settings: {
    workspace: path.join(os.homedir(), 'NoeAgent', 'workspace'),
    maxChain: 3,          // 群聊里 AI 互相 @ 的最大接力轮数
    autoApprove: false,   // 是否让 CLI 跳过所有权限确认（危险）
    historyLimit: 20,     // 群聊里带给 AI 的最近消息条数
    notify: true,         // AI 回复完成时发系统通知
    askCwd: true,         // 新会话第一次发消息前先选择工作目录
    recentDirs: [],       // 最近使用的工作目录
  },
  providers: [],          // 模型厂商 { id, preset, name, color, apiKey, urls: {anthropic, openai, gemini}, models: [], smallModel, note }
  agentConfig: {},        // { [agentId]: { mode: 'official'|'provider', providerId, model, extraEnv } }
  agentMeta: {},          // { [agentId]: { slash: [] } } 运行中发现的信息，如 Claude 的 / 命令列表
  customAgents: [],       // 用户自定义的 CLI
  mcpEnv: {},             // 供 CLI 读取的 MCP 密钥环境变量
  chats: [],              // { id, type: 'dm'|'group', name, members, cwd, sessions, pinned, createdAt }
  messages: {},           // { [chatId]: Message[] }
});

let data = null;
let timer = null;

function load() {
  if (data) return data;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data = { ...defaults(), ...raw };
    data.settings = { ...defaults().settings, ...raw.settings };
  } catch {
    data = defaults();
  }
  // 旧版本的配置迁移：每个工具单独填的 Key 转成一个模型厂商；没有 mode 的视为官方登录
  const OLD = {
    claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'anthropic', 'https://api.anthropic.com'],
    codex: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'openai', 'https://api.openai.com/v1'],
    qwen: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'openai', ''],
    deepseek: ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'openai', 'https://api.deepseek.com/v1'],
    gemini: ['GEMINI_API_KEY', '', 'gemini', 'https://generativelanguage.googleapis.com'],
  };
  for (const [id, cfg] of Object.entries(data.agentConfig)) {
    const o = OLD[id];
    const key = o && cfg.env?.[o[0]];
    if (key && !cfg.mode) {
      const pid = 'p-migrated-' + id;
      data.providers.push({
        id: pid, preset: 'custom', name: `${id} 原有配置`, color: '#64748b', apiKey: key,
        urls: { [o[2]]: cfg.env[o[1]] || o[3] }, models: cfg.model ? [cfg.model] : [], smallModel: '', note: '', createdAt: Date.now(),
      });
      Object.assign(cfg, { mode: 'provider', providerId: pid });
    }
    cfg.mode ||= 'official';
    delete cfg.env;
  }
  // 上次异常退出时仍在“生成中”的消息标记为中断
  for (const list of Object.values(data.messages)) {
    for (const m of list) if (m.status === 'streaming') m.status = 'stopped';
  }
  return data;
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

function flush() {
  clearTimeout(timer);
  if (!data) return;
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

module.exports = { load, save, flush, DIR };
