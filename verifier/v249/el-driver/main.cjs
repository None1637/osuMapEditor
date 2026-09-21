// v249 CDP 探针用 Electron 驱动壳: 以指定窗口尺寸加载 dev server (真实目标内核 Chromium 150 —
// 无头 Edge 119 的 getBoundingClientRect 不反映 CSS zoom, 无法用于本验证)
const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: parseInt(process.env.WIN_W || '1280', 10),
    height: parseInt(process.env.WIN_H || '720', 10),
    autoHideMenuBar: true,
  });
  win.loadURL(process.env.APP_URL || 'http://localhost:7100/');
});
