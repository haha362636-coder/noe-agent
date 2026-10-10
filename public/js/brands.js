// 品牌图标：AI CLI、模型厂商、模型的官方 logo（来自 @lobehub/icons-static-svg，放在 public/brand/）
// full：图标本身就是带底色的应用图标，铺满头像；mono：单色图标，跟随文字颜色（深色模式下自动变白）
const LOGOS = {
  claudecode: { file: 'claudecode-color.svg' },
  claude: { file: 'claude-color.svg' },
  codex: { file: 'codex-color.svg', full: true },
  deepseek: { file: 'deepseek-color.svg' },
  geminicli: { file: 'geminicli-color.svg', full: true },
  gemini: { file: 'gemini-color.svg' },
  qwen: { file: 'qwen-color.svg' },
  opencode: { file: 'opencode.svg', mono: true },
  anthropic: { file: 'anthropic.svg', mono: true },
  openai: { file: 'openai.svg', mono: true },
  zhipu: { file: 'zhipu-color.svg' },
  kimi: { file: 'kimi-color.svg' },
  moonshot: { file: 'moonshot.svg', mono: true },
  bailian: { file: 'bailian-color.svg' },
  minimax: { file: 'minimax-color.svg' },
  openrouter: { file: 'openrouter.svg', mono: true },
  siliconcloud: { file: 'siliconcloud-color.svg' },
};

/** AI CLI → logo */
const AGENT_LOGO = { claude: 'claudecode', codex: 'codex', deepseek: 'deepseek', gemini: 'geminicli', qwen: 'qwen', opencode: 'opencode' };

/** 厂商预设 → logo */
const PROVIDER_LOGO = {
  anthropic: 'claude', openai: 'openai', deepseek: 'deepseek', zhipu: 'zhipu', kimi: 'kimi', bailian: 'bailian',
  minimax: 'minimax', openrouter: 'openrouter', siliconflow: 'siliconcloud', gemini: 'gemini',
};

/** 按名称 / 模型 ID / 地址里的关键词猜 logo（自定义厂商、自定义 CLI、模型列表用） */
const GUESS = [
  [/claude|anthropic|opus|sonnet|haiku|fable/i, 'claude'],
  [/codex/i, 'codex'],
  [/gpt|openai|o\d-|chatgpt/i, 'openai'],
  [/deepseek/i, 'deepseek'],
  [/gemini|google/i, 'gemini'],
  [/qwen|通义|dashscope|aliyun/i, 'qwen'],
  [/百炼|bailian/i, 'bailian'],
  [/glm|zhipu|智谱|bigmodel|z\.ai/i, 'zhipu'],
  [/kimi|moonshot|月之暗面/i, 'kimi'],
  [/minimax/i, 'minimax'],
  [/openrouter/i, 'openrouter'],
  [/silicon|硅基/i, 'siliconcloud'],
  [/opencode/i, 'opencode'],
];
const guess = (...texts) => {
  const s = texts.filter(Boolean).join(' ');
  return s ? GUESS.find(([re]) => re.test(s))?.[1] || null : null;
};

export const agentLogo = (a) => (a ? AGENT_LOGO[a.id] || guess(a.name, a.bin) : null);
export const providerLogo = (p) => (p ? PROVIDER_LOGO[p.preset] || guess(p.name, ...Object.values(p.urls || {})) : null);
export const modelLogo = (id) => guess(id);

/** logo 本体（放在头像 / 图块里面） */
export function logoImg(key) {
  const l = LOGOS[key];
  if (!l) return '';
  // 遮罩图片的地址写在行内样式里，按页面地址解析（写进 CSS 变量会按 css/ 目录解析）
  if (l.mono) return `<i class="bl mono" style="-webkit-mask-image:url(brand/${l.file});mask-image:url(brand/${l.file})"></i>`;
  return `<img class="bl ${l.full ? 'full' : ''}" src="brand/${l.file}" alt="" draggable="false">`;
}
export const isFull = (key) => !!LOGOS[key]?.full;

/** 带底的 logo 图块；没有 logo 时显示首字母 */
export function logoTile(key, size = 36, fallback = '?', cls = '') {
  if (!LOGOS[key]) return `<span class="logo-tile letter ${cls}" style="--s:${size}px">${fallback}</span>`;
  return `<span class="logo-tile ${isFull(key) ? 'full' : ''} ${cls}" style="--s:${size}px">${logoImg(key)}</span>`;
}
