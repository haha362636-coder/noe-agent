// 常用 MCP 服务器目录
// config 中的 {{KEY}} 会被参数替换；可选参数留空时，含有它的 env / header 会被去掉
// auth: 'oauth' 表示首次使用需要在 CLI 里授权（Noe 提供一键打开授权终端）

const CATALOG = [
  {
    id: 'filesystem', name: '文件系统', en: 'Filesystem', category: '开发', color: '#0ea5e9', icon: 'folder',
    desc: '读写、搜索指定目录下的文件，适合让不擅长文件操作的 AI 也能处理本地文件。',
    config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{{DIR}}'] },
    params: [{ key: 'DIR', label: '允许访问的目录', default: '{{WORKSPACE}}', required: true }],
    requires: 'node', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'context7', name: 'Context7 文档', en: 'Context7', category: '开发', color: '#10b981', icon: 'book',
    desc: '实时查询各类库和框架的最新官方文档与示例代码，减少 AI 写过时 API 的情况。',
    config: { type: 'http', url: 'https://mcp.context7.com/mcp', headers: { CONTEXT7_API_KEY: '{{KEY}}' } },
    params: [{ key: 'KEY', label: 'API Key（可选，提高额度）', secret: true }],
    homepage: 'https://context7.com',
  },
  {
    id: 'deepwiki', name: 'DeepWiki', en: 'DeepWiki', category: '开发', color: '#6366f1', icon: 'book',
    desc: '读取任意 GitHub 开源仓库的结构化文档并提问，免费、无需 Key。',
    config: { type: 'http', url: 'https://mcp.deepwiki.com/mcp' },
    homepage: 'https://deepwiki.com',
  },
  {
    id: 'github', name: 'GitHub', en: 'GitHub', category: '开发', color: '#24292f', icon: 'git',
    desc: '管理仓库、Issue、Pull Request、Actions，官方远程服务。',
    config: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer {{TOKEN}}' } },
    params: [{ key: 'TOKEN', label: 'GitHub Personal Access Token', secret: true, required: true, help: 'https://github.com/settings/personal-access-tokens' }],
    homepage: 'https://github.com/github/github-mcp-server',
  },
  {
    id: 'git', name: 'Git', en: 'Git', category: '开发', color: '#f05032', icon: 'git',
    desc: '查看提交历史、diff、分支，并执行常用 Git 操作。',
    config: { type: 'stdio', command: 'uvx', args: ['mcp-server-git'] },
    requires: 'uv', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'playwright', name: 'Playwright 浏览器', en: 'Playwright', category: '浏览器', color: '#2ead33', icon: 'globe',
    desc: '让 AI 打开网页、点击、填表、截图，做端到端测试和网页自动化。',
    config: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    requires: 'node', homepage: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'chrome-devtools', name: 'Chrome DevTools', en: 'Chrome DevTools', category: '浏览器', color: '#4285f4', icon: 'globe',
    desc: '控制 Chrome 并读取控制台、网络请求和性能数据，调试前端页面。',
    config: { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
    requires: 'node', homepage: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
  },
  {
    id: 'fetch', name: '网页抓取', en: 'Fetch', category: '浏览器', color: '#64748b', icon: 'download',
    desc: '抓取网页并转换成 Markdown，供 AI 阅读。',
    config: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
    requires: 'uv', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'tavily', name: 'Tavily 搜索', en: 'Tavily', category: '搜索', color: '#8b5cf6', icon: 'search',
    desc: '为 AI 优化的联网搜索与网页提取。',
    config: { type: 'stdio', command: 'npx', args: ['-y', 'tavily-mcp@latest'], env: { TAVILY_API_KEY: '{{KEY}}' } },
    params: [{ key: 'KEY', label: 'Tavily API Key', secret: true, required: true, help: 'https://app.tavily.com' }],
    requires: 'node', homepage: 'https://github.com/tavily-ai/tavily-mcp',
  },
  {
    id: 'exa', name: 'Exa 搜索', en: 'Exa', category: '搜索', color: '#1e40af', icon: 'search',
    desc: '语义化的网页与代码搜索，远程服务。',
    config: { type: 'http', url: 'https://mcp.exa.ai/mcp' },
    homepage: 'https://exa.ai',
  },
  {
    id: 'brave-search', name: 'Brave 搜索', en: 'Brave Search', category: '搜索', color: '#fb542b', icon: 'search',
    desc: '使用 Brave Search API 联网搜索网页和本地信息。',
    config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '{{KEY}}' } },
    params: [{ key: 'KEY', label: 'Brave API Key', secret: true, required: true, help: 'https://brave.com/search/api/' }],
    requires: 'node', homepage: 'https://brave.com/search/api/',
  },
  {
    id: 'firecrawl', name: 'Firecrawl 爬虫', en: 'Firecrawl', category: '搜索', color: '#ff6a00', icon: 'download',
    desc: '整站爬取、结构化提取网页数据。',
    config: { type: 'stdio', command: 'npx', args: ['-y', 'firecrawl-mcp'], env: { FIRECRAWL_API_KEY: '{{KEY}}' } },
    params: [{ key: 'KEY', label: 'Firecrawl API Key', secret: true, required: true, help: 'https://www.firecrawl.dev' }],
    requires: 'node', homepage: 'https://github.com/firecrawl/firecrawl-mcp-server',
  },
  {
    id: 'amap', name: '高德地图', en: 'AMap', category: '生活', color: '#1677ff', icon: 'map',
    desc: '地理编码、路线规划、周边搜索、天气查询等高德地图能力。',
    config: { type: 'http', url: 'https://mcp.amap.com/mcp?key={{KEY}}' },
    params: [{ key: 'KEY', label: '高德 Web 服务 Key', secret: true, required: true, help: 'https://console.amap.com/dev/key/app' }],
    homepage: 'https://lbs.amap.com/api/mcp-server/summary',
  },
  {
    id: 'memory', name: '长期记忆', en: 'Memory', category: '效率', color: '#ec4899', icon: 'brain',
    desc: '基于知识图谱的持久记忆，让 AI 记住项目和你的偏好。',
    config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    requires: 'node', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking', name: '分步思考', en: 'Sequential Thinking', category: '效率', color: '#f59e0b', icon: 'layers',
    desc: '帮助模型把复杂问题拆成步骤，逐步推理和修正。',
    config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
    requires: 'node', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'time', name: '时间与时区', en: 'Time', category: '效率', color: '#0891b2', icon: 'clock',
    desc: '获取当前时间、时区换算。',
    config: { type: 'stdio', command: 'uvx', args: ['mcp-server-time', '--local-timezone={{TZ}}'] },
    params: [{ key: 'TZ', label: '本地时区', default: 'Asia/Shanghai', required: true }],
    requires: 'uv', homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
  },
  {
    id: 'notion', name: 'Notion', en: 'Notion', category: '效率', color: '#111111', icon: 'book', auth: 'oauth',
    desc: '读写 Notion 页面与数据库，官方远程服务，首次使用需授权。',
    config: { type: 'http', url: 'https://mcp.notion.com/mcp' },
    homepage: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'figma', name: 'Figma 设计稿', en: 'Figma', category: '设计', color: '#a259ff', icon: 'layers',
    desc: '读取 Figma 桌面版 Dev Mode 中选中的设计稿，生成代码。需开启 Dev Mode MCP。',
    config: { type: 'http', url: 'http://127.0.0.1:3845/mcp' },
    homepage: 'https://help.figma.com/hc/en-us/articles/32132100833559',
  },
  {
    id: 'sentry', name: 'Sentry', en: 'Sentry', category: '运维', color: '#362d59', icon: 'alert', auth: 'oauth',
    desc: '查询线上错误、堆栈与发布信息，首次使用需授权。',
    config: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
    homepage: 'https://docs.sentry.io/product/sentry-mcp/',
  },
  {
    id: 'supabase', name: 'Supabase', en: 'Supabase', category: '运维', color: '#3ecf8e', icon: 'database', auth: 'oauth',
    desc: '管理 Supabase 项目、数据库表、执行 SQL，首次使用需授权。',
    config: { type: 'http', url: 'https://mcp.supabase.com/mcp' },
    homepage: 'https://supabase.com/docs/guides/getting-started/mcp',
  },
];

// Gemini CLI 扩展推荐（来自官方 gemini-cli-extensions 组织）
const GEMINI_EXTENSIONS = [
  { name: 'workspace', title: 'Google Workspace', desc: '读写 Gmail、Docs、Sheets、Drive、日历', url: 'https://github.com/gemini-cli-extensions/workspace' },
  { name: 'nanobanana', title: 'Nano Banana', desc: '在终端里生成和编辑图片', url: 'https://github.com/gemini-cli-extensions/nanobanana' },
  { name: 'security', title: 'Security', desc: '分析代码改动中的安全漏洞', url: 'https://github.com/gemini-cli-extensions/security' },
  { name: 'code-review', title: 'Code Review', desc: '对改动做代码评审', url: 'https://github.com/gemini-cli-extensions/code-review' },
  { name: 'conductor', title: 'Conductor', desc: '先写规格再实现的上下文驱动开发流程', url: 'https://github.com/gemini-cli-extensions/conductor' },
  { name: 'flutter', title: 'Flutter', desc: 'Flutter / Dart 开发辅助', url: 'https://github.com/gemini-cli-extensions/flutter' },
  { name: 'firebase', title: 'Firebase', desc: '管理 Firebase 项目与服务', url: 'https://github.com/gemini-cli-extensions/firebase' },
  { name: 'cloud-run', title: 'Cloud Run', desc: '把应用部署到 Google Cloud Run', url: 'https://github.com/gemini-cli-extensions/cloud-run' },
];

const CLAUDE_MARKETPLACES = [
  { name: 'claude-plugins-official', source: 'anthropics/claude-plugins-official', title: 'Anthropic 官方插件目录', desc: '300+ 官方与合作伙伴插件（GitHub、Figma、代码评审、语言服务器等）' },
];

module.exports = { CATALOG, GEMINI_EXTENSIONS, CLAUDE_MARKETPLACES };
