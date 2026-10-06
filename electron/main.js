// Electron 外壳：启动本地服务并打开窗口
const { app, BrowserWindow, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');

// 只允许运行一个实例：两个实例会各起一个服务，同时写 ~/.noe-agent/data.json 导致数据互相覆盖
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const server = require('../server/index');
  const { DIR } = require('../server/store');
  const STATE = path.join(DIR, 'window.json');

  let win;
  let portPromise;

  // 记住窗口大小和位置
  function loadBounds() {
    try {
      const b = JSON.parse(fs.readFileSync(STATE, 'utf8'));
      // 显示器拔掉后坐标可能落在屏幕外，这时只保留尺寸
      const visible = screen.getAllDisplays().some(({ workArea: w }) => b.x >= w.x - 50 && b.y >= w.y - 50 && b.x < w.x + w.width - 100 && b.y < w.y + w.height - 100);
      return visible ? b : { width: b.width, height: b.height };
    } catch { return { width: 1280, height: 820 }; }
  }
  function saveBounds() {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* 忽略 */ }
  }

  async function createWindow() {
    // 只启动一次服务；端口被占用时退回随机端口
    portPromise ||= server.start(17860).catch(() => server.start(0));
    const port = await portPromise;
    const origin = `http://127.0.0.1:${port}`;
    const bounds = loadBounds();
    win = new BrowserWindow({
      ...bounds, minWidth: 900, minHeight: 600,
      title: 'Noe Agent',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      backgroundColor: '#f6f7f9',
      show: false,
      webPreferences: { contextIsolation: true },
    });
    if (bounds.maximized) win.maximize();
    win.once('ready-to-show', () => win.show());
    win.loadURL(`${origin}/?app=1`);
    let t = null;
    const persist = () => { clearTimeout(t); t = setTimeout(saveBounds, 400); };
    win.on('resize', persist);
    win.on('move', persist);
    win.on('close', saveBounds);
    // 外部链接用系统浏览器打开；指向 Noe 自身的链接（通常是 AI 回复里的相对路径）一律拦下，避免窗口被带走
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith(origin) && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (url.startsWith(origin + '/?') || url === origin + '/') return;
      e.preventDefault();
      if (!url.startsWith(origin) && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
    });
  }

  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  });
  app.whenReady().then(createWindow);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => server.shutdown());
}
