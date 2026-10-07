// 多语言：界面文案以简体中文为键，其他语言从 locales/<lang>.json 查表，查不到就显示中文原文。
// 文案里的 {name} 会被替换成参数；{n|single|plural} 按 n 是否为 1 选单复数（英文用）。
// 新增一种语言：在 public/locales/ 放一份同样结构的 JSON，再在 LANGS 里登记即可（服务端共用同一份词典）。
export const LANGS = [
  { id: 'zh', name: '简体中文', short: '中' },
  { id: 'en', name: 'English', short: 'EN' },
];

let lang = 'zh';
let dict = {};

export const getLang = () => lang;

/** 系统语言是中文就用中文，否则用英文 */
export const detectLang = () => (/^zh/i.test(navigator.language || '') ? 'zh' : 'en');

export async function setLang(id) {
  lang = LANGS.some((l) => l.id === id) ? id : 'zh';
  dict = {};
  if (lang !== 'zh') {
    try { dict = await (await fetch(`locales/${lang}.json`, { cache: 'no-cache' })).json(); } catch { dict = {}; }
  }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
  try { localStorage.setItem('noe.lang', lang); } catch { /* 忽略 */ }
  return lang;
}

export function fill(s, vars) {
  if (!vars) return s;
  return s
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_, k, one, many) => (Number(vars[k]) === 1 ? one : many))
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
}

/** 翻译一段中文文案；参数里的值原样插入，需要转义的由调用方先转义 */
export function t(s, vars) {
  if (s == null || s === '') return s ?? '';
  const out = lang === 'zh' ? s : dict[s] ?? s;
  return fill(out, vars);
}

/** 静态 HTML：data-i18n（文本）、data-i18n-title、data-i18n-ph（placeholder），值就是中文原文 */
export function translateDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
}
