// audio-probe 本地自检: http 服务 (probe.html + 测试 mp3) + 无头 Edge CDP 轮询结果。
// 运行: node verifier/tools/run-probe-test.mjs [mp3路径]
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mp3 = process.argv[2] || 'F:/Backup/D/osu!/Songs/beatmap-639217845366573336-audio/audio.mp3';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/audio.mp3')) { res.setHeader('Content-Type', 'audio/mpeg'); fs.createReadStream(mp3).pipe(res); }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); fs.createReadStream(path.join(root, 'verifier/tools/audio-probe.html')).pipe(res); }
});
await new Promise(r => srv.listen(7721, r));

const PORT = 9441;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-probe-'));
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'http://127.0.0.1:7721/probe.html?src=/audio.mp3'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const ts = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = ts.find(t => t.type === 'page' && t.url.includes('probe.html'));
  } catch { }
  if (!target) await sleep(500);
}
if (!target) { console.error('EDGE_CONNECT_FAILED'); edge.kill(); srv.close(); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const evaluate = (expr) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result?.result?.value));
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
});

let text = '';
for (let i = 0; i < 60; i++) {
  text = await evaluate(`document.getElementById('out').innerText`) || '';
  if (/SHA-256|解码失败|出错/.test(text)) break;
  await sleep(1000);
}
console.log(text);
edge.kill(); srv.close();
process.exit(/SHA-256/.test(text) ? 0 : 1);
