// Electron 外壳：启动本地服务并打开窗口
const { app, BrowserWindow, shell } = require('electron');
const server = require('../server/index');

let win;
let portPromise;

async function createWindow() {
  // 只启动一次服务；端口被占用时退回随机端口
  portPromise ||= server.start(17860).catch(() => server.start(0));
  const port = await portPromise;
  const origin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: 'Noe Agent',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f6f7f9',
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(`${origin}/?app=1`);
  // 外部链接用系统浏览器打开；指向 Noe 自身的链接（通常是 AI 回复里的相对路径）一律拦下，避免窗口被带走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(origin + '/?') || url === origin + '/') return;
    e.preventDefault();
    if (!url.startsWith(origin)) shell.openExternal(url);
  });
}

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => server.shutdown());
