// v560: 直接以 44100 Hz 单声道解码 E3 冻结开发歌曲，不触碰独立确认集。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const v541 = path.join(root, '../v541');
const config = JSON.parse(fs.readFileSync(path.join(root, 'experiment.json'), 'utf8'));
const confirmation = JSON.parse(fs.readFileSync(path.join(root, '../v559/confirmation-selection.json'), 'utf8'));
const reserved = new Set(confirmation.samples.map(item => item.id));
if (config.sampleIds.some(id => reserved.has(id))) throw new Error('E3 不得解码独立确认集');
const manifest = JSON.parse(fs.readFileSync(path.join(v541, 'manifest.json'), 'utf8'));
const selected = config.sampleIds.map(id => {
  const sample = manifest.samples.find(item => item.id === id);
  if (!sample || sample.audioCopyStatus !== 'copied' || !sample.decodeSupported) throw new Error(`${id} 音频不可用`);
  return sample;
});
const decodedRoot = path.join(root, 'decoded');
fs.mkdirSync(decodedRoot, { recursive: true });
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
  });
  await win.loadURL('data:text/html,<html><body>v560 DDC onset decoder</body></html>');
  for (const sample of selected) {
    const outDir = path.join(decodedRoot, sample.id);
    const metaPath = path.join(outDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.sampleRate !== config.audio.offlineSampleRate || meta.numberOfChannels !== 1) throw new Error(`${sample.id} 旧解码参数不一致`);
      console.log(JSON.stringify({ id: sample.id, reused: true, durationMs: meta.durationMs }));
      continue;
    }
    const input = path.join(v541, 'samples', sample.id, sample.localAudioFile);
    fs.mkdirSync(outDir, { recursive: true });
    const metadata = await win.webContents.executeJavaScript(`(async () => {
      const fs = require('node:fs');
      const bytes = fs.readFileSync(${JSON.stringify(input)});
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const context = new AudioContext();
      try {
        const decoded = await context.decodeAudioData(arrayBuffer);
        const sampleRate = ${config.audio.offlineSampleRate};
        const length = Math.ceil(decoded.duration * sampleRate);
        const offline = new OfflineAudioContext(1, length, sampleRate);
        const source = offline.createBufferSource();
        source.buffer = decoded;
        source.connect(offline.destination);
        source.start();
        const rendered = await offline.startRendering();
        const pcm = rendered.getChannelData(0);
        fs.writeFileSync(${JSON.stringify(path.join(outDir, 'mono.f32'))}, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        return { sampleRate, length, numberOfChannels: 1, durationMs: rendered.duration * 1000 };
      } finally {
        await context.close();
      }
    })()`, true);
    const pcm = fs.readFileSync(path.join(outDir, 'mono.f32'));
    const record = {
      id: sample.id,
      source: input,
      sourceSha256: sha256(fs.readFileSync(input)),
      pcmSha256: sha256(pcm),
      ...metadata,
    };
    fs.writeFileSync(metaPath, JSON.stringify(record, null, 2));
    console.log(JSON.stringify({ id: sample.id, reused: false, durationMs: record.durationMs, samples: record.length }));
  }
  win.destroy();
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
