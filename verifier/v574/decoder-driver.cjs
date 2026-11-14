// 隐藏的Electron渲染进程，仅用于v574本地音频解码；由decode.mjs启动并关闭。
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const url = process.argv[process.argv.length - 1];
  const window = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, sandbox: true },
  });
  await window.loadURL(url);
});
