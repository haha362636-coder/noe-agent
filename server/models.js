// 模型目录：各 CLI 官方登录时可选的模型、思考强度，以及 /model 模糊匹配
// Codex 的列表实时读取 `codex debug models`，其余为内置目录（2026-10 更新）
const { run } = require('./extensions');
const { which } = require('./env');

const EFFORT_LABEL = { low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大', ultra: '极限' };

const STATIC = {
  claude: {
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    models: [
      { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', desc: 'Anthropic 目前最强的模型，适合最难的推理和长时间自主任务', tags: ['最强'], price: '$10 / $50' },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', desc: '当前 Opus，编码与智能体任务的主力，性价比高', tags: ['推荐', '最新'], price: '$4 / $20' },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', desc: '速度快、能力强，适合日常编码', tags: ['快速'], price: '$2 / $10' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', desc: '最快最便宜，适合简单任务', tags: ['便宜'], price: '$1 / $5' },
      { id: 'claude-fable-5', name: 'Claude Fable 5', desc: '上一代 Fable', tags: ['旧版'] },
      { id: 'claude-opus-5', name: 'Claude Opus 5', desc: '上一代 Opus', tags: ['旧版'] },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', desc: '上一代 Sonnet', tags: ['旧版'] },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', desc: '4.x 系列最后一版 Opus', tags: ['旧版'] },
    ],
  },
  codex: {
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    // 读取失败时的兜底列表
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', desc: '最新主力模型，编码和日常工作', tags: ['推荐', '最新'] },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', desc: 'OpenAI 最强模型，复杂推理、编码与研究', tags: ['最强'] },
      { id: 'gpt-6-sol', name: 'GPT-6 Sol', desc: '中档模型，速度与能力平衡' },
      { id: 'gpt-6-luna', name: 'GPT-6 Luna', desc: '小模型，快且便宜', tags: ['便宜'] },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', desc: '上一代', tags: ['旧版'] },
      { id: 'gpt-5.5', name: 'GPT-5.5', desc: '上一代', tags: ['旧版'] },
    ],
  },
  gemini: {
    efforts: [],
    models: [
      { id: 'auto', name: '自动选择', desc: '由 Gemini CLI 按任务自动在 Pro / Flash 之间切换' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', desc: '最新、最聪明的 Flash，长程编码和智能体任务', tags: ['推荐', '最新'] },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', desc: '当前 Pro 系列，复杂推理', tags: ['最强'] },
      { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', desc: '上一版 Flash' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', desc: '稳定版 Flash' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', desc: '最快最便宜', tags: ['便宜'] },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: '旧版', tags: ['旧版'] },
    ],
  },
  qwen: {
    efforts: [],
    models: [
      { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', desc: 'Qwen OAuth 登录默认的编码模型', tags: ['推荐'] },
      { id: 'qwen3.7-max', name: 'Qwen3.7 Max', desc: '通义旗舰（需对应账号权限）', tags: ['最强'] },
      { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', desc: '通义主力模型' },
    ],
  },
  opencode: {
    efforts: [],
    models: [
      { id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5', desc: '需在 opencode auth 中登录 Anthropic' },
      { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', desc: '需在 opencode auth 中登录 OpenAI' },
      { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', desc: '需在 opencode auth 中登录 Google' },
    ],
  },
};

// 厂商模型的友好名称与说明（按模型 ID 匹配）
const KNOWN = {
  'deepseek-v4-pro': { name: 'DeepSeek V4 Pro', desc: 'DeepSeek 最强模型', tags: ['最强'] },
  'deepseek-v4-flash': { name: 'DeepSeek V4 Flash', desc: '快速、便宜', tags: ['快速'] },
  'glm-5.3': { name: 'GLM-5.3', desc: '智谱最新旗舰', tags: ['最新'] },
  'glm-5.3-flash': { name: 'GLM-5.3 Flash', desc: '智谱快速版', tags: ['快速'] },
  'kimi-k3': { name: 'Kimi K3', desc: '月之暗面旗舰，1M 上下文', tags: ['最新'] },
  'MiniMax-M3': { name: 'MiniMax M3', desc: 'MiniMax 最新模型', tags: ['最新'] },
  'qwen3.7-max': { name: 'Qwen3.7 Max', desc: '通义旗舰', tags: ['最强'] },
  'qwen3.7-plus': { name: 'Qwen3.7 Plus', desc: '通义主力' },
  'qwen3-coder-plus': { name: 'Qwen3 Coder Plus', desc: '通义编码模型' },
};
for (const a of Object.values(STATIC)) for (const m of a.models) KNOWN[m.id] ||= { name: m.name, desc: m.desc, tags: m.tags };

// ---------- Codex 实时目录 ----------
let codexCache = null;
async function codexModels() {
  if (codexCache && Date.now() - codexCache.t < 10 * 60e3) return codexCache.v;
  if (!which('codex')) return null;
  const r = await run(['codex', 'debug', 'models'], { timeout: 30000 });
  if (r.code !== 0) return null;
  try {
    const d = JSON.parse(r.out.slice(r.out.indexOf('{')));
    const list = (d.models || []).filter((m) => m.visibility !== 'hide')
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((m, i) => ({
        id: m.slug, name: m.display_name || m.slug, desc: m.description || '',
        tags: i === 0 ? ['推荐', '最新'] : /astra/i.test(m.slug) ? ['最强'] : /luna/i.test(m.slug) ? ['便宜'] : /^gpt-5/.test(m.slug) ? ['旧版'] : [],
        efforts: (m.supported_reasoning_levels || []).map((x) => x.effort),
        defaultEffort: m.default_reasoning_level,
      }));
    codexCache = { t: Date.now(), v: list };
    return list;
  } catch { return null; }
}

/** 返回每个 agent 官方登录下的模型目录 */
async function catalog() {
  const out = {};
  for (const [id, a] of Object.entries(STATIC)) out[id] = { efforts: a.efforts, models: a.models, live: false };
  const live = await codexModels().catch(() => null);
  if (live?.length) {
    out.codex.models = live;
    out.codex.efforts = [...new Set(live.flatMap((m) => m.efforts))].filter((e) => EFFORT_LABEL[e]);
    out.codex.live = true;
  }
  return { agents: out, known: KNOWN, effortLabel: EFFORT_LABEL };
}

// ---------- /model 模糊匹配 ----------
const squash = (s) => String(s).toLowerCase().replace(/[\s._\-/]+/g, '');

/** 在候选模型里找最匹配的：完全相等 > 前缀 > 包含；返回 { match, others } */
function resolveModel(query, candidates) {
  const q = squash(query);
  if (!q) return { match: null, others: [] };
  const scored = [];
  for (const m of candidates) {
    const keys = [m.id, m.name].filter(Boolean).map(squash);
    let score = 0;
    for (const k of keys) {
      if (k === q) score = Math.max(score, 100);
      else if (k.endsWith(q) || k.startsWith(q)) score = Math.max(score, 60 - k.length / 10);
      else if (k.includes(q)) score = Math.max(score, 40 - k.length / 10);
    }
    // “opus” 这种只给系列名的，优先推荐 / 最新的
    if (score && m.tags?.some((t) => t === '推荐' || t === '最新')) score += 5;
    if (score && m.tags?.includes('旧版')) score -= 10;
    if (score) scored.push([score, m]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return { match: scored[0]?.[1] || null, others: scored.slice(1, 5).map((x) => x[1]) };
}

module.exports = { catalog, resolveModel, EFFORT_LABEL, KNOWN };
