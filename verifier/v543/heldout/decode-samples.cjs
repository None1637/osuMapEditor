// v543-heldout: 分批用 Electron/Web Audio 解码冻结样本；单曲失败只记录，不替换样本。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const numberArg = (name, fallback) => {
  const item = args.find(arg => arg.startsWith(`--${name}=`));
  return item ? Number(item.slice(name.length + 3)) : fallback;
};
const start = Math.max(0, numberArg('start', 0));
const limit = Math.max(1, numberArg('limit', 10));
const selected = manifest.samples.slice(start, start + limit);
const decodedRoot = path.join(root, 'decoded');
const statusRoot = path.join(root, 'decode-status');
fs.mkdirSync(decodedRoot, { recursive: true });
fs.mkdirSync(statusRoot, { recursive: true });

function writeStatus(sample, status, extra = {}) {
  const record = { id: sample.id, status, ...extra };
  fs.writeFileSync(path.join(statusRoot, `${sample.id}.json`), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
  });
  await win.loadURL('data:text/html,<html><body>v543-heldout frozen-sample decoder</body></html>');
  for (const sample of selected) {
    const outDir = path.join(decodedRoot, sample.id);
    const metaPath = path.join(outDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      writeStatus(sample, 'decoded', { durationMs: meta.durationMs, reused: true });
      continue;
    }
    if (sample.audioCopyStatus !== 'copied' || !sample.localAudioFile) {
      writeStatus(sample, 'audio_unavailable', { audioCopyStatus: sample.audioCopyStatus, error: sample.audioCopyError });
      continue;
    }
    if (!sample.decodeSupported) {
      writeStatus(sample, 'unsupported_format', { extension: sample.audioExtension });
      continue;
    }
    const input = path.join(root, 'samples', sample.id, sample.localAudioFile);
    fs.mkdirSync(outDir, { recursive: true });
    try {
      const metadata = await win.webContents.executeJavaScript(`(async () => {
        const fs = require('node:fs');
        const bytes = fs.readFileSync(${JSON.stringify(input)});
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const context = new AudioContext();
        try {
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
          return { sampleRate, length, numberOfChannels: rendered.numberOfChannels, durationMs: rendered.duration * 1000 };
        } finally {
          await context.close();
        }
      })()`, true);
      fs.writeFileSync(metaPath, JSON.stringify({ source: input, ...metadata }, null, 2));
      writeStatus(sample, 'decoded', { durationMs: metadata.durationMs });
    } catch (error) {
      writeStatus(sample, 'decode_error', { error: String(error) });
    }
  }
  win.destroy();
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
