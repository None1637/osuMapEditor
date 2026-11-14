// v540: 用 Electron/Web Audio 解码真实 fixture，与应用 decodeAudioData 路径一致；输出仅落在本目录。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const fixtureRoot = path.join(root, 'fixtures');
const outputRoot = path.join(root, 'decoded');
fs.mkdirSync(outputRoot, { recursive: true });

function mp3Files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? mp3Files(full) : entry.name.toLowerCase().endsWith('.mp3') ? [full] : [];
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
  });
  await win.loadURL('data:text/html,<html><body>v540 decoder</body></html>');
  for (const file of mp3Files(fixtureRoot)) {
    const name = path.basename(path.dirname(file));
    const outDir = path.join(outputRoot, name);
    fs.mkdirSync(outDir, { recursive: true });
    const metadata = await win.webContents.executeJavaScript(`(async () => {
      const fs = require('node:fs');
      const bytes = fs.readFileSync(${JSON.stringify(file)});
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(arrayBuffer);
      const sampleRate = 11025;
      const length = Math.ceil(decoded.duration * sampleRate);
      const offline = new OfflineAudioContext(decoded.numberOfChannels, length, sampleRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
        const pcm = rendered.getChannelData(ch);
        fs.writeFileSync(${JSON.stringify(outDir)} + '/ch' + ch + '.f32', Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      }
      await context.close();
      return { sampleRate, length, numberOfChannels: rendered.numberOfChannels, durationMs: rendered.duration * 1000 };
    })()`, true);
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ source: file, ...metadata }, null, 2));
    console.log(JSON.stringify({ name, ...metadata }));
  }
  win.destroy();
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
