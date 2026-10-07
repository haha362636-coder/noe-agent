// 服务端多语言：系统消息、错误提示、发给 AI 的提示词跟随设置里的界面语言。
// 和前端共用 public/locales/<lang>.json 词典，键是中文原文，查不到就用中文。
const fs = require('fs');
const path = require('path');

const LOCALES = path.join(__dirname, '..', 'public', 'locales');
const dicts = { zh: {} };
let getLang = () => '';

function load(id) {
  if (dicts[id]) return dicts[id];
  try { dicts[id] = JSON.parse(fs.readFileSync(path.join(LOCALES, id + '.json'), 'utf8')); } catch { dicts[id] = {}; }
  return dicts[id];
}

/** 没设置过语言时按系统语言猜（Electron 会通过 NOE_LOCALE 传入系统界面语言） */
function systemLang() {
  const loc = process.env.NOE_LOCALE || process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^zh/i.test(loc) ? 'zh' : 'en';
}

function lang() {
  const l = getLang();
  return l && (l === 'zh' || fs.existsSync(path.join(LOCALES, l + '.json'))) ? l : systemLang();
}

function fill(s, vars) {
  if (!vars) return s;
  return s
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_, k, one, many) => (Number(vars[k]) === 1 ? one : many))
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
}

function t(s, vars) {
  const l = lang();
  const out = l === 'zh' ? s : load(l)[s] ?? s;
  return fill(out, vars);
}

/** 中文用顿号分隔列表，英文用逗号 */
const join = (list) => list.join(lang() === 'zh' ? '、' : ', ');

module.exports = { t, join, lang, systemLang, use: (fn) => { getLang = fn; } };
