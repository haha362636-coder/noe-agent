// Markdown 渲染：marked + 代码高亮 + XSS 过滤 + @ 高亮
import { S, esc, agentById } from './core.js';

const { marked, DOMPurify, hljs } = window.Vendor;

marked.use({
  gfm: true, breaks: true,
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').split(/\s/)[0];
      let html;
      try { html = language && hljs.getLanguage(language) ? hljs.highlight(text, { language }).value : hljs.highlightAuto(text).value; }
      catch { html = esc(text); }
      return `<div class="code"><div class="code-head"><span>${esc(language || 'code')}</span><button class="code-copy" data-copy>复制</button></div><pre><code class="hljs">${html}</code></pre></div>`;
    },
    link(token) {
      const inner = this.parser.parseInline(token.tokens);
      // 外部链接交给浏览器；相对路径 / 本地文件交给 Noe 按会话工作目录打开（否则会解析成 Noe 自己的地址）
      if (/^(https?:|mailto:)/i.test(token.href)) return `<a href="${esc(token.href)}" target="_blank" rel="noopener">${inner}</a>`;
      if (token.href.startsWith('#')) return inner;
      return `<a href="#" class="file-link" data-open-path="${esc(token.href)}" title="用默认程序打开">${inner}</a>`;
    },
    codespan({ text }) {
      const raw = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      return looksLikePath(raw) ? `<code class="path" data-open-path="${esc(raw)}" title="点击打开">${text}</code>` : `<code>${text}</code>`;
    },
  },
});

// 像文件路径的文本：绝对路径、~/、./、../，或带常见扩展名的文件名
const EXT = 'html?|css|js|mjs|cjs|jsx|ts|tsx|json|md|txt|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|vue|svelte|sh|zsh|ya?ml|toml|ini|env|sql|csv|xlsx?|docx?|pptx?|pdf|png|jpe?g|gif|svg|webp|ico|mp3|mp4|mov|wav|zip|ipynb|lock|xml|log';
const PATH_RE = new RegExp(`^(?:~?/|\\.{1,2}/)?[\\w@.\\-\\u4e00-\\u9fa5]+(?:/[\\w@.\\-\\u4e00-\\u9fa5]+)*/?$`);
export function looksLikePath(s) {
  s = String(s).trim();
  if (!s || s.length > 300 || /\s/.test(s) || /^https?:/i.test(s)) return false;
  if (/^(~\/|\/(Users|home|tmp|private|var|opt|Volumes)\/|\.{1,2}\/)/.test(s)) return PATH_RE.test(s);
  return new RegExp(`^[\\w@.\\-\\u4e00-\\u9fa5/]+\\.(${EXT})$`, 'i').test(s) && !/^\d+(\.\d+)+$/.test(s);
}
const ABS_PATH_IN_TEXT = /((?:~|\/(?:Users|home|tmp|private|Volumes))\/[^\s`'"<>，。；：、）)\]]+)/g;

export function md(src) {
  const html = DOMPurify.sanitize(marked.parse(String(src || '')), { ADD_ATTR: ['target', 'data-copy', 'data-open-path'] });
  return mentionify(html);
}

// 只替换文本节点里的 @，不碰代码块
export function mentionify(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if ((n.nodeValue.includes('@') || /[~/]/.test(n.nodeValue)) && !n.parentElement?.closest('pre, code, a')) nodes.push(n);
  }
  for (const n of nodes) {
    const span = document.createElement('span');
    // 正文里出现的绝对路径也变成可点击
    span.innerHTML = renderMentions(esc(n.nodeValue)).replace(ABS_PATH_IN_TEXT, (p) => `<a href="#" class="file-link" data-open-path="${p}" title="用默认程序打开">${p}</a>`);
    n.replaceWith(...span.childNodes);
  }
  return tpl.innerHTML;
}

export function renderMentions(s) {
  return s.replace(/@([\w一-龥-]+)/g, (all, id) => {
    const a = agentById(id.toLowerCase()) || S.agents.find((x) => x.name.replace(/\s+/g, '').toLowerCase() === id.toLowerCase());
    if (a) return `<span class="mention" style="--c:${a.color}">${all}</span>`;
    if (['all', '所有人', '全体'].includes(id)) return `<span class="mention">${all}</span>`;
    return all;
  });
}
