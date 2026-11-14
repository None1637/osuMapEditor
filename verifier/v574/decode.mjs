// v574: 用应用同类AudioContext解码18首工作区音频副本；PCM通过本地POST写盘，关闭临时服务器与Edge。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'source-manifest.json'), 'utf8'));
const records = new Map(manifest.samples.map(sample => [sample.id, sample]));
const decodedRoot = path.join(root, 'decoded');
fs.mkdirSync(decodedRoot, { recursive: true });
const profile = path.join(root, '.browser-profile');
fs.mkdirSync(profile, { recursive: true });
const EDGE = 'C:\\Program Files (x86)\\Microsoft Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

const pendingWrites = new Map();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<html><body>v574 decoder</body></html>');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/audio') {
    const record = records.get(url.searchParams.get('id'));
    if (!record) { res.writeHead(404); res.end(); return; }
    const extension = path.extname(record.workspaceAudioPath).toLowerCase();
    res.setHeader('Content-Type', extension === '.ogg' ? 'audio/ogg' : extension === '.wav' ? 'audio/wav' : 'audio/mpeg');
    res.setHeader('Content-Length', fs.statSync(record.workspaceAudioPath).size);
    fs.createReadStream(record.workspaceAudioPath).pipe(res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/pcm') {
    const id = url.searchParams.get('id'), channel = Number(url.searchParams.get('channel'));
    const record = records.get(id);
    if (!record || !Number.isInteger(channel) || channel < 0 || channel > 8) { res.writeHead(400); res.end(); return; }
    const directory = path.join(decodedRoot, id);
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, `ch${channel}.f32`);
    const output = fs.createWriteStream(destination);
    const key = `${id}/${channel}`;
    const completion = new Promise((resolve, reject) => {
      output.once('finish', () => resolve(fs.statSync(destination).size));
      output.once('error', reject);
      req.once('error', reject);
    });
    pendingWrites.set(key, completion);
    req.pipe(output);
    completion.then(size => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, bytes: size }));
    }).catch(error => { res.writeHead(500); res.end(String(error)); });
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
const httpPort = server.address().port;
const debugPort = await freePort();
const browserExecutable = path.join(root, '../../node_modules/electron/dist/electron.exe');
const browserDriver = path.join(root, 'decoder-driver.cjs');
const browserEnvironment = { ...process.env };
delete browserEnvironment.ELECTRON_RUN_AS_NODE;
const edge = spawn(browserExecutable, [
  browserDriver, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-extensions', `http://127.0.0.1:${httpPort}/`,
], { stdio: 'ignore', env: browserEnvironment });
let ws;
try {
  let target;
  for (let attempt = 0; attempt < 120 && !target; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      target = targets.find(item => item.type === 'page' && item.url.includes(`:${httpPort}/`));
    } catch { /* Edge仍在启动 */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('Edge调试页面启动超时');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let messageId = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  };
  function evaluate(expression, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`浏览器解码超时 ${timeoutMs}ms`)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  }
  const summaries = [];
  for (const sample of manifest.samples) {
    const expression = `(async () => {
      try {
        const response = await fetch('/audio?id=${sample.id}');
        if (!response.ok) throw new Error('audio HTTP ' + response.status);
        const bytes = await response.arrayBuffer();
        const context = new AudioContext({ sampleRate: 11025 });
        const buffer = await context.decodeAudioData(bytes);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const write = await fetch('/pcm?id=${sample.id}&channel=' + channel, { method: 'POST', body: buffer.getChannelData(channel) });
          if (!write.ok) throw new Error('PCM HTTP ' + write.status);
        }
        const result = { sampleRate: buffer.sampleRate, length: buffer.length, numberOfChannels: buffer.numberOfChannels, durationMs: buffer.duration * 1000 };
        await context.close();
        return result;
      } catch (error) { return { error: String(error), stack: error && error.stack }; }
    })()`;
    const result = await evaluate(expression);
    const value = result?.result?.value;
    if (!value || value.error) throw new Error(`${sample.id} 解码失败: ${JSON.stringify(value ?? result)}`);
    const directory = path.join(decodedRoot, sample.id);
    const sizes = [];
    for (let channel = 0; channel < value.numberOfChannels; channel++) {
      const key = `${sample.id}/${channel}`;
      const size = await pendingWrites.get(key);
      sizes.push(size);
      if (size !== value.length * 4) throw new Error(`${key} PCM字节数不符: ${size} != ${value.length * 4}`);
      pendingWrites.delete(key);
    }
    const metadata = { source: sample.workspaceAudioPath, ...value, pcmBytesPerChannel: sizes };
    fs.writeFileSync(path.join(directory, 'meta.json'), JSON.stringify(metadata, null, 2));
    summaries.push({ id: sample.id, ...value });
    console.log(JSON.stringify({ id: sample.id, sampleRate: value.sampleRate, channels: value.numberOfChannels, durationMs: value.durationMs }));
  }
  fs.writeFileSync(path.join(root, 'decode-summary.json'), JSON.stringify({
    version: 'v574-browser-audio-context-decode-v1', sampleRateRequested: 11025,
    decoder: 'Headless Microsoft Edge AudioContext.decodeAudioData; application-like browser decode path',
    samples: summaries,
  }, null, 2));
  console.log(`V574_DECODE_WRITTEN samples=${summaries.length}`);
} finally {
  if (ws) ws.close();
  edge.kill();
  await new Promise(resolve => server.close(resolve));
}
