// 一次性: 无头 Edge 解码指定 mp3, 测指定时刻附近瞬态能量起点 + 片头非静音点。
// 运行: node verifier/tools/measure-onset.mjs <mp3路径> [中心ms] [半窗ms]
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';

const mp3 = process.argv[2];
const C = Number(process.argv[3] || 460607);
const HW = Number(process.argv[4] || 3000);
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/audio.mp3')) { res.setHeader('Content-Type', 'audio/mpeg'); fs.createReadStream(mp3).pipe(res); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<html><body>onset probe</body></html>'); }
});
await new Promise(r => srv.listen(7722, r));

const PORT = 9443;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-onset-'));
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', 'http://127.0.0.1:7722/'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const ts = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    target = ts.find(t => t.type === 'page');
  } catch { }
  if (!target) await sleep(500);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const evaluate = (expression) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
});

const expr = `(async () => {
  try {
    const bytes = await (await fetch('http://127.0.0.1:7722/audio.mp3')).arrayBuffer();
    const actx = new AudioContext();
    const buf = await actx.decodeAudioData(bytes);
    const sr = buf.sampleRate;
    const d0 = buf.getChannelData(0);
    const d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d0;
    let fns = -1;
    for (let i = 0; i < d0.length; i++) if (Math.abs(d0[i]) > 1e-4 || Math.abs(d1[i]) > 1e-4) { fns = i; break; }
    const c = ${C}, hw = ${HW};
    const rows = [];
    for (let t = c - hw; t < c + hw; t += 25) {
      let sum = 0, cnt = 0;
      const a = Math.max(0, Math.round(t / 1000 * sr)), b = Math.min(d0.length, Math.round((t + 25) / 1000 * sr));
      for (let i = a; i < b; i++) { sum += d0[i] * d0[i] + d1[i] * d1[i]; cnt++; }
      rows.push([t, Math.sqrt(sum / Math.max(1, cnt * 2))]);
    }
    let jump = -9999;
    for (let i = 10; i < rows.length - 5; i++) {
      const before = rows.slice(i - 5, i).reduce((s, r) => s + r[1], 0) / 5;
      const after = rows.slice(i, i + 5).reduce((s, r) => s + r[1], 0) / 5;
      if (after > Math.max(0.08, before * 4)) { jump = rows[i][0]; break; }
    }
    const near = rows.filter(r => r[0] >= c - 300 && r[0] <= c + 400).map(r => r[0] + ':' + r[1].toFixed(3)).join(' ');
    return JSON.stringify({ sr, durMs: Math.round(buf.duration * 100000) / 100, fnsMs: Math.round(fns / sr * 100000) / 100, jump, near });
  } catch (e) { return 'ERROR: ' + e; }
})()`;

const r = await evaluate(expr);
console.log(JSON.stringify(r, null, 1).slice(0, 3000));
edge.kill(); srv.close();
process.exit(0);
