// AI CLI 注册表 + 运行适配器
// 每个 agent 描述：如何安装、支持哪些 API 协议、如何登录、如何以无头模式运行并解析输出。
const { spawn, execFile } = require('child_process');
const { baseEnv, which } = require('./env');
const { trimSlash } = require('./providers');

// Claude Code 里只能在交互界面用的 / 命令：自动转到内置终端执行
const CLAUDE_INTERACTIVE = new Set(['login', 'logout', 'config', 'settings', 'mcp', 'permissions', 'allowed-tools', 'resume', 'doctor', 'theme', 'agents',
  'hooks', 'ide', 'memory', 'terminal-setup', 'vim', 'add-dir', 'bug', 'feedback', 'export', 'privacy-settings', 'upgrade', 'usage', 'plugin', 'plugins',
  'install-github-app', 'output-style', 'statusline', 'todos', 'rewind', 'release-notes', 'exit', 'fast', 'effort', 'remote-control', 'sandbox', 'tasks']);

const BUILTIN = [
  {
    id: 'claude', name: 'Claude Code', vendor: 'Anthropic', color: '#d97757', avatar: 'C',
    bin: 'claude', pkg: '@anthropic-ai/claude-code',
    desc: 'Anthropic 官方编码智能体，擅长读写代码、重构与多步任务。',
    homepage: 'https://docs.claude.com/en/docs/claude-code/overview',
    protocols: ['anthropic'], officialLabel: 'Claude 账号登录（订阅 / Console）',
    loginCmd: ['claude', 'auth', 'login'], logoutCmd: ['claude', 'auth', 'logout'],
    mode: 'claude', resumable: true, slash: 'claude',
  },
  {
    id: 'codex', name: 'Codex', vendor: 'OpenAI', color: '#10a37f', avatar: 'X',
    bin: 'codex', pkg: '@openai/codex',
    desc: 'OpenAI 的终端编码智能体，支持沙箱内执行命令和修改文件。',
    homepage: 'https://developers.openai.com/codex/cli',
    protocols: ['openai'], officialLabel: 'ChatGPT 账号登录',
    protocolNote: 'Codex 只支持 OpenAI Responses 接口，厂商需兼容 /v1/responses',
    loginCmd: ['codex', 'login'], logoutCmd: ['codex', 'logout'],
    mode: 'codex', resumable: true, slash: 'terminal',
  },
  {
    id: 'deepseek', name: 'DeepSeek Harness', vendor: 'DeepSeek', color: '#4d6bfe', avatar: 'D',
    bin: 'dsh', pkg: '@deepseek-ai/dsh',
    desc: 'DeepSeek 官方智能体框架 dsh，以 headless 模式运行任务。',
    homepage: 'https://www.npmjs.com/package/@deepseek-ai/dsh',
    protocols: ['openai'], officialLabel: '使用环境变量 DEEPSEEK_API_KEY', noModel: true,
    mode: 'text', args: (p) => ['--profile', 'headless', p], slash: 'terminal',
    interactive: () => ['dsh', '--profile', 'web'],
  },
  {
    id: 'gemini', name: 'Gemini CLI', vendor: 'Google', color: '#4285f4', avatar: 'G',
    bin: 'gemini', pkg: '@google/gemini-cli',
    desc: 'Google 的开源终端智能体，超长上下文。',
    homepage: 'https://github.com/google-gemini/gemini-cli',
    protocols: ['gemini'], officialLabel: 'Google 账号登录',
    loginCmd: ['gemini'],
    mode: 'text', slash: 'terminal',
    args: (p, { model, autoApprove }) => [...(model ? ['-m', model] : []), ...(autoApprove ? ['--yolo'] : []), '-p', p],
  },
  {
    id: 'qwen', name: 'Qwen Code', vendor: '阿里通义', color: '#615ced', avatar: 'Q',
    bin: 'qwen', pkg: '@qwen-code/qwen-code',
    desc: '通义千问编码智能体，支持任意 OpenAI 兼容接口。',
    homepage: 'https://github.com/QwenLM/qwen-code',
    protocols: ['openai'], officialLabel: 'Qwen OAuth 登录',
    loginCmd: ['qwen'],
    mode: 'text', slash: 'terminal',
    args: (p, { model, autoApprove }) => [...(model ? ['-m', model] : []), ...(autoApprove ? ['--yolo'] : []), '-p', p],
  },
  {
    id: 'opencode', name: 'OpenCode', vendor: 'SST', color: '#f59e0b', avatar: 'O',
    bin: 'opencode', pkg: 'opencode-ai',
    desc: '开源终端智能体，可接入 75+ 模型供应商。',
    homepage: 'https://opencode.ai',
    protocols: ['openai'], officialLabel: 'opencode auth 登录的账号',
    loginCmd: ['opencode', 'auth', 'login'], logoutCmd: ['opencode', 'auth', 'logout'],
    mode: 'text', slash: 'terminal',
    args: (p, { model }) => ['run', ...(model ? ['-m', model] : []), p],
  },
];

function installCmd(a) { return a.installCmd || (a.pkg ? `npm install -g ${a.pkg}@latest` : ''); }
function uninstallCmd(a) { return a.uninstallCmd || (a.pkg ? `npm uninstall -g ${a.pkg}` : ''); }

// 自定义 agent：{ id, name, bin, argsTemplate: 'run {prompt}', installCmd, color }
function fromCustom(c) {
  const tpl = (c.argsTemplate || '{prompt}').trim().split(/\s+/);
  return {
    id: c.id, name: c.name, vendor: '自定义', color: c.color || '#64748b', avatar: (c.name || '?')[0].toUpperCase(),
    bin: c.bin, installCmd: c.installCmd || '', desc: c.desc || `自定义命令：${c.bin} ${c.argsTemplate || ''}`,
    protocols: [], custom: true, mode: 'text', noModel: true, slash: 'terminal', officialLabel: '使用自身配置',
    args: (p) => tpl.map((t) => (t === '{prompt}' ? p : t.replace('{prompt}', p))),
  };
}

function parseExtraEnv(text) {
  const env = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const tomlStr = (s) => JSON.stringify(String(s));

/**
 * 把「官方登录 / 某个厂商 + 模型」翻译成具体 CLI 的环境变量和参数。
 * 返回 { env, preArgs, model, providerName }
 */
function resolveAuth(agent, cfg = {}, provider) {
  const env = baseEnv(parseExtraEnv(cfg.extraEnv));
  const preArgs = [];
  const useProvider = cfg.mode === 'provider' && provider;
  const model = (cfg.model || '').trim();

  if (agent.id === 'claude') {
    // 官方登录时清掉可能残留在 shell 里的第三方配置，确保走账号登录
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL']) {
      if (useProvider || !parseExtraEnv(cfg.extraEnv)[k]) delete env[k];
    }
    if (useProvider) {
      const base = trimSlash(provider.urls?.anthropic);
      if (base) env.ANTHROPIC_BASE_URL = base;
      if (/api\.anthropic\.com/.test(base)) env.ANTHROPIC_API_KEY = provider.apiKey;
      else {
        env.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
        const m = model || provider.models?.[0];
        if (m) { env.ANTHROPIC_MODEL = m; env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.smallModel || m; env.ANTHROPIC_SMALL_FAST_MODEL = provider.smallModel || m; }
      }
    }
  } else if (agent.id === 'codex') {
    if (useProvider) {
      env.NOE_PROVIDER_KEY = provider.apiKey;
      preArgs.push('-c', 'model_provider="noe"', '-c',
        `model_providers.noe={ name = ${tomlStr(provider.name)}, base_url = ${tomlStr(trimSlash(provider.urls?.openai))}, env_key = "NOE_PROVIDER_KEY", wire_api = "responses" }`);
    }
  } else if (agent.id === 'deepseek') {
    if (useProvider) {
      env.DEEPSEEK_API_KEY = provider.apiKey;
      const base = trimSlash(provider.urls?.openai).replace(/\/v1$/, '');
      if (base) env.DEEPSEEK_BASE_URL = base;
    }
  } else if (agent.id === 'gemini') {
    if (useProvider) {
      env.GEMINI_API_KEY = provider.apiKey;
      const base = trimSlash(provider.urls?.gemini);
      if (base && !/generativelanguage\.googleapis\.com/.test(base)) env.GOOGLE_GEMINI_BASE_URL = base;
    }
  } else if (agent.id === 'qwen') {
    if (useProvider) {
      env.OPENAI_API_KEY = provider.apiKey;
      env.OPENAI_BASE_URL = trimSlash(provider.urls?.openai);
      if (model || provider.models?.[0]) env.OPENAI_MODEL = model || provider.models[0];
    }
  } else if (agent.id === 'opencode') {
    if (useProvider) {
      const m = model || provider.models?.[0] || 'default';
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        provider: { noe: { npm: '@ai-sdk/openai-compatible', name: provider.name, options: { baseURL: trimSlash(provider.urls?.openai), apiKey: provider.apiKey }, models: Object.fromEntries((provider.models?.length ? provider.models : [m]).map((x) => [x, { name: x }])) } },
      });
      return { env, preArgs, model: `noe/${m}`, providerName: provider.name };
    }
  }
  return { env, preArgs, model: useProvider ? (model || provider.models?.[0] || '') : model, providerName: useProvider ? provider.name : null };
}

/** 该 agent 能用这个厂商吗（至少有一个协议地址匹配） */
function supports(agent, provider) {
  return (agent.protocols || []).some((p) => trimSlash(provider.urls?.[p]));
}

// 查询官方登录状态（仅部分 CLI 支持非交互查询）
function authStatus(agent) {
  return new Promise((resolve) => {
    const bin = which(agent.bin);
    if (!bin) return resolve(null);
    if (agent.id === 'claude') {
      execFile(bin, ['auth', 'status', '--json'], { env: baseEnv(), timeout: 15000 }, (err, out) => {
        try {
          const j = JSON.parse(out);
          resolve({ loggedIn: !!j.loggedIn, detail: j.loggedIn ? [j.authMethod, j.email || j.account?.email].filter(Boolean).join(' · ') : '未登录' });
        } catch { resolve(null); }
      });
    } else if (agent.id === 'codex') {
      execFile(bin, ['login', 'status'], { env: baseEnv(), timeout: 15000 }, (err, out, errOut) => {
        const t = String(out || errOut || '').trim();
        const line = t.split('\n')[0] || '';
        resolve({ loggedIn: !err && !/not logged in/i.test(t), detail: line.replace(/^logged in using (an? )?/i, '').replace(/^ChatGPT$/i, 'ChatGPT 账号') || (err ? '未登录' : '') });
      });
    } else resolve(null);
  });
}

/** 内置终端里运行的交互式命令 */
function interactiveArgv(agent, { sessionId, initial, preArgs = [], model, effort } = {}) {
  if (agent.id === 'claude') return ['claude', ...(sessionId ? ['--resume', sessionId] : []), ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []), ...(initial ? [initial] : [])];
  if (agent.id === 'codex') return ['codex', ...preArgs, ...(model ? ['-m', model] : []), ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []), ...(sessionId ? ['resume', sessionId] : [])];
  if (agent.interactive) return agent.interactive();
  if (agent.id === 'opencode') return ['opencode', ...(model ? ['-m', model] : [])];
  return [agent.bin, ...(model && !agent.noModel ? ['-m', model] : [])];
}

/**
 * 运行一次 agent（无头模式）。
 * onEvent({type:'text', delta}) / ({type:'step', step}) / ({type:'session', id}) / ({type:'meta', meta})
 * 返回 { proc, done: Promise<{ text, sessionId, error, meta }> }
 */
function runAgent(agent, { prompt, cwd, sessionId, cfg = {}, provider, settings = {}, onEvent }) {
  const autoApprove = !!settings.autoApprove;
  const { env, preArgs, model, providerName } = resolveAuth(agent, cfg, provider);
  const effort = (cfg.effort || '').trim();
  const meta = { model: model || '', provider: providerName || '官方登录', effort };

  let args;
  if (agent.mode === 'claude') {
    args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', autoApprove ? 'bypassPermissions' : 'acceptEdits'];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (sessionId) args.push('--resume', sessionId);
  } else if (agent.mode === 'codex') {
    // 用 -c 写沙箱配置：新版 Codex 移除了 --full-auto，-c 在各版本和 resume 子命令里都通用
    args = ['exec', ...preArgs, '--json', '--skip-git-repo-check'];
    args.push(...(autoApprove ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"']));
    if (model) args.push('-m', model);
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
    if (sessionId) args.push('resume', sessionId, prompt);
    else args.push('-C', cwd, prompt);
  } else {
    args = agent.args(prompt, { model: agent.noModel ? '' : model, autoApprove });
  }

  const bin = which(agent.bin) || agent.bin;
  const started = Date.now();
  const proc = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

  let text = '';
  let gotDelta = false;
  let newSession = sessionId || null;
  let stderr = '';
  let errorMsg = null;
  let authAbort = false;
  const emitText = (delta) => { if (!delta) return; text += delta; onEvent({ type: 'text', delta }); };
  const step = (title, detail, kind = 'tool') => onEvent({ type: 'step', step: { title, detail: clip(detail, 4000), kind } });

  const handleLine = (line) => {
    if (agent.mode === 'text') { emitText(stripAnsi(line) + '\n'); return; }
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (agent.mode === 'claude') handleClaude(ev); else handleCodex(ev);
  };

  function handleClaude(ev) {
    if (ev.session_id && ev.session_id !== newSession) { newSession = ev.session_id; onEvent({ type: 'session', id: newSession }); }
    if (ev.type === 'system' && ev.subtype === 'api_retry') {
      // 认证错误重试也不会成功，直接结束，避免用户干等几分钟
      if ([401, 403].includes(ev.error_status)) {
        errorMsg = `认证失败（HTTP ${ev.error_status}）：API Key 无效、已过期，或账号未登录`;
        authAbort = true;
        proc.kill('SIGTERM');
      } else step(`API 请求失败（${ev.error_status || ev.error}），第 ${ev.attempt}/${ev.max_retries} 次重试`, '', 'error');
    } else if (ev.type === 'system' && ev.subtype === 'init') {
      if (ev.model) meta.model = ev.model;
      if (Array.isArray(ev.slash_commands)) onEvent({ type: 'slash', list: ev.slash_commands });
    } else if (ev.type === 'stream_event') {
      const d = ev.event;
      if (d?.type === 'content_block_delta' && d.delta?.type === 'text_delta') { gotDelta = true; emitText(d.delta.text); }
      if (d?.type === 'message_start' && text && !text.endsWith('\n\n')) emitText('\n\n');
    } else if (ev.type === 'assistant') {
      for (const block of ev.message?.content || []) {
        if (block.type === 'tool_use') step(toolTitle(block.name, block.input), JSON.stringify(block.input, null, 2));
        else if (block.type === 'thinking' && block.thinking) step('思考', block.thinking, 'think');
        else if (block.type === 'text' && !gotDelta) emitText(block.text);
      }
    } else if (ev.type === 'user') {
      for (const block of ev.message?.content || []) {
        if (block.type === 'tool_result') {
          const c = Array.isArray(block.content) ? block.content.map((x) => x.text || '').join('\n') : block.content;
          step(block.is_error ? '工具返回错误' : '工具返回', c, block.is_error ? 'error' : 'result');
        }
      }
    } else if (ev.type === 'result') {
      Object.assign(meta, {
        durationMs: ev.duration_ms, cost: ev.total_cost_usd, turns: ev.num_turns,
        inTok: (ev.usage?.input_tokens || 0) + (ev.usage?.cache_read_input_tokens || 0) + (ev.usage?.cache_creation_input_tokens || 0),
        outTok: ev.usage?.output_tokens,
      });
      if (ev.is_error) errorMsg = ev.result || ev.subtype || '执行出错';
      else if (!text.trim() && ev.result) emitText(ev.result);
    }
  }

  function handleCodex(ev) {
    if (ev.type === 'thread.started' && ev.thread_id) { newSession = ev.thread_id; onEvent({ type: 'session', id: newSession }); }
    const item = ev.item;
    if (ev.type === 'item.completed' && item) {
      if (item.type === 'agent_message') emitText((text ? '\n\n' : '') + (item.text || ''));
      else if (item.type === 'reasoning') step('思考', item.text, 'think');
      else if (item.type === 'command_execution') step(`$ ${item.command}`, item.aggregated_output, item.exit_code ? 'error' : 'tool');
      else if (item.type === 'file_change') step('修改文件', (item.changes || []).map((c) => `${c.kind} ${c.path}`).join('\n'));
      else if (item.type === 'mcp_tool_call') step(`MCP ${item.server}.${item.tool}`, JSON.stringify(item.arguments || {}, null, 2));
      else if (item.type === 'web_search') step(`搜索 ${item.query}`, '');
      else if (item.type === 'todo_list') step('计划', (item.items || []).map((t) => `${t.completed ? '✓' : '○'} ${t.text}`).join('\n'));
      else if (item.type === 'error') errorMsg = item.message;
    } else if (ev.type === 'turn.completed' && ev.usage) {
      meta.inTok = (meta.inTok || 0) + (ev.usage.input_tokens || 0);
      meta.outTok = (meta.outTok || 0) + (ev.usage.output_tokens || 0);
    } else if (ev.type === 'turn.failed' || ev.type === 'error') {
      errorMsg = ev.error?.message || ev.message || '执行出错';
    }
  }

  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
  });
  proc.stderr.on('data', (c) => { stderr += c.toString(); if (stderr.length > 20000) stderr = stderr.slice(-20000); });

  const done = new Promise((resolve) => {
    const finish = (r) => { meta.durationMs ||= Date.now() - started; resolve({ ...r, meta }); };
    proc.on('error', (e) => {
      finish({ text, sessionId: newSession, error: e.code === 'ENOENT' ? `未找到命令 ${agent.bin}，请先在「工具」页面一键安装` : e.message });
    });
    proc.on('close', (code, signal) => {
      if (buf.trim()) handleLine(buf);
      if (agent.mode === 'text') text = text.replace(/\n+$/, '');
      if (signal && authAbort) return finish({ text, sessionId: newSession, error: errorMsg });
      if (signal) return finish({ text, sessionId: newSession, stopped: true });
      if (code !== 0 && !errorMsg) errorMsg = clip(stripAnsi(stderr).trim(), 2000) || `进程退出码 ${code}`;
      if (code === 0 && !text.trim() && !errorMsg && stderr.trim()) emitText(stripAnsi(stderr).trim());
      finish({ text, sessionId: newSession, error: errorMsg });
    });
  });

  return { proc, done };
}

function toolTitle(name, input = {}) {
  const target = input.file_path || input.path || input.command || input.pattern || input.url || input.description || '';
  return `${name}${target ? ' · ' + clip(String(target), 80) : ''}`;
}
function clip(s, n) { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) + ' …' : s; }
function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, ''); }

module.exports = { BUILTIN, CLAUDE_INTERACTIVE, fromCustom, installCmd, uninstallCmd, runAgent, resolveAuth, supports, authStatus, interactiveArgv, stripAnsi };
