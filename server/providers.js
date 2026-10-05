// 模型厂商（API 供应商）：预设、连通性测试、模型列表
// 预设模型于 2026-10 更新；各厂商模型更新很快，可在界面上「从厂商拉取列表」或「同步预设模型」
// 一个厂商可以同时提供多种协议的地址：anthropic（给 Claude Code）、openai（给 Codex / Qwen / OpenCode / DeepSeek Harness）、gemini（给 Gemini CLI）

const PRESETS = [
  {
    preset: 'anthropic', name: 'Anthropic 官方 API', color: '#d97757', site: 'https://console.anthropic.com/settings/keys',
    urls: { anthropic: 'https://api.anthropic.com' },
    models: ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
  },
  {
    preset: 'openai', name: 'OpenAI 官方 API', color: '#10a37f', site: 'https://platform.openai.com/api-keys',
    urls: { openai: 'https://api.openai.com/v1' },
    models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'],
  },
  {
    preset: 'deepseek', name: 'DeepSeek', color: '#4d6bfe', site: 'https://platform.deepseek.com/api_keys',
    urls: { anthropic: 'https://api.deepseek.com/anthropic', openai: 'https://api.deepseek.com/v1' },
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  {
    preset: 'zhipu', name: '智谱 GLM', color: '#3859ff', site: 'https://open.bigmodel.cn/usercenter/apikeys',
    urls: { anthropic: 'https://open.bigmodel.cn/api/anthropic', openai: 'https://open.bigmodel.cn/api/paas/v4' },
    models: ['glm-5.3', 'glm-5.3-flash'],
  },
  {
    preset: 'kimi', name: 'Kimi（月之暗面）', color: '#111827', site: 'https://platform.moonshot.cn/console/api-keys',
    urls: { anthropic: 'https://api.moonshot.cn/anthropic', openai: 'https://api.moonshot.cn/v1' },
    models: ['kimi-k3'],
  },
  {
    preset: 'bailian', name: '阿里云百炼（通义千问）', color: '#615ced', site: 'https://bailian.console.aliyun.com/?apiKey=1',
    urls: { anthropic: 'https://dashscope.aliyuncs.com/apps/anthropic', openai: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    models: ['qwen3.7-max', 'qwen3.7-plus', 'qwen3-coder-plus'],
  },
  {
    preset: 'minimax', name: 'MiniMax', color: '#e5484d', site: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    urls: { anthropic: 'https://api.minimaxi.com/anthropic', openai: 'https://api.minimaxi.com/v1' },
    models: ['MiniMax-M3'],
  },
  {
    preset: 'openrouter', name: 'OpenRouter', color: '#6467f2', site: 'https://openrouter.ai/keys',
    urls: { openai: 'https://openrouter.ai/api/v1' },
    models: ['anthropic/claude-opus-5.5', 'openai/gpt-6.1-sol', 'google/gemini-3.8-flash', 'deepseek/deepseek-v4-pro'],
  },
  {
    preset: 'siliconflow', name: '硅基流动', color: '#7c3aed', site: 'https://cloud.siliconflow.cn/account/ak',
    urls: { openai: 'https://api.siliconflow.cn/v1' },
    models: ['deepseek-ai/DeepSeek-V4-Pro', 'moonshotai/Kimi-K3', 'zai-org/GLM-5.3'],
  },
  {
    preset: 'gemini', name: 'Google Gemini', color: '#4285f4', site: 'https://aistudio.google.com/apikey',
    urls: { gemini: 'https://generativelanguage.googleapis.com' },
    models: ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.7-flash'],
  },
  {
    preset: 'custom', name: '自定义厂商', color: '#64748b', site: '',
    urls: { anthropic: '', openai: '' }, models: [],
  },
];

const PROTOCOLS = {
  anthropic: 'Anthropic 协议',
  openai: 'OpenAI 协议',
  gemini: 'Gemini 协议',
};

const trimSlash = (u) => String(u || '').trim().replace(/\/+$/, '');

async function timed(fn) {
  const t = Date.now();
  try { const r = await fn(); return { ok: true, ms: Date.now() - t, ...r }; }
  catch (e) { return { ok: false, ms: Date.now() - t, error: e.message }; }
}

async function req(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || json?.error || text.slice(0, 300);
      throw new Error(`HTTP ${res.status}：${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    return json ?? text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时（30 秒）');
    throw e;
  } finally { clearTimeout(timer); }
}

const anthropicHeaders = (key) => ({ 'content-type': 'application/json', 'x-api-key': key, authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' });
const openaiHeaders = (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` });

// 用一条极短的请求测试每个协议的地址 + Key + 模型是否可用
async function testProvider(p, model) {
  const m = model || p.models?.[0];
  const results = [];
  if (!p.apiKey) return [{ protocol: '-', ok: false, error: '还没有填写 API Key' }];
  if (!m) return [{ protocol: '-', ok: false, error: '请至少添加一个模型' }];
  const u = p.urls || {};
  if (trimSlash(u.anthropic)) {
    results.push({ protocol: 'anthropic', ...(await timed(async () => {
      const r = await req(`${trimSlash(u.anthropic)}/v1/messages`, { method: 'POST', headers: anthropicHeaders(p.apiKey), body: JSON.stringify({ model: m, max_tokens: 16, messages: [{ role: 'user', content: '只回复 OK' }] }) });
      return { reply: (r?.content || []).map((c) => c.text || '').join('').slice(0, 60) };
    })) });
  }
  if (trimSlash(u.openai)) {
    results.push({ protocol: 'openai', ...(await timed(async () => {
      const r = await req(`${trimSlash(u.openai)}/chat/completions`, { method: 'POST', headers: openaiHeaders(p.apiKey), body: JSON.stringify({ model: m, max_tokens: 16, messages: [{ role: 'user', content: '只回复 OK' }] }) });
      return { reply: String(r?.choices?.[0]?.message?.content || '').slice(0, 60) };
    })) });
  }
  if (trimSlash(u.gemini)) {
    results.push({ protocol: 'gemini', ...(await timed(async () => {
      const r = await req(`${trimSlash(u.gemini)}/v1beta/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': p.apiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: '只回复 OK' }] }] }) });
      return { reply: String(r?.candidates?.[0]?.content?.parts?.[0]?.text || '').slice(0, 60) };
    })) });
  }
  if (!results.length) return [{ protocol: '-', ok: false, error: '至少填写一个协议地址' }];
  return results;
}

// 拉取厂商的模型列表（按 openai → anthropic → gemini 顺序尝试）
async function listModels(p) {
  const u = p.urls || {};
  const errors = [];
  if (trimSlash(u.openai)) {
    try { const r = await req(`${trimSlash(u.openai)}/models`, { headers: openaiHeaders(p.apiKey) }); return (r.data || []).map((x) => x.id).filter(Boolean).sort(); }
    catch (e) { errors.push('OpenAI：' + e.message); }
  }
  if (trimSlash(u.anthropic)) {
    try { const r = await req(`${trimSlash(u.anthropic)}/v1/models?limit=100`, { headers: anthropicHeaders(p.apiKey) }); return (r.data || []).map((x) => x.id).filter(Boolean); }
    catch (e) { errors.push('Anthropic：' + e.message); }
  }
  if (trimSlash(u.gemini)) {
    try { const r = await req(`${trimSlash(u.gemini)}/v1beta/models`, { headers: { 'x-goog-api-key': p.apiKey } }); return (r.models || []).map((x) => String(x.name).replace(/^models\//, '')); }
    catch (e) { errors.push('Gemini：' + e.message); }
  }
  throw new Error(errors.join('；') || '没有可用的协议地址');
}

module.exports = { PRESETS, PROTOCOLS, testProvider, listModels, trimSlash };
