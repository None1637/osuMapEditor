// 一次性探针: Chrome 在不同采样率下 decodeAudioData 的延迟裁剪行为
// 44.1k 文件; 期望: 若 48k 解码不裁剪 → 首瞬态右移 1105 samples@48k = 23.02ms
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9436;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-dbg-sr-'));
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', APP_URL], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
  } catch { }
  if (!target) await sleep(500);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => { const id = ++msgId; return new Promise(res => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

try {
  const r = await evalJs(`
    (async () => {
      const ab = await (await fetch('/dbg-audio.mp3')).arrayBuffer();
      const out = {};
      // 设备默认采样率 (app 实际使用的 AudioContext)
      try { const ac = new AudioContext(); out.deviceSampleRate = ac.sampleRate; await ac.close(); } catch (e) { out.deviceSampleRate = 'err'; }
      for (const sr of [44100, 48000]) {
        const ctx = new OfflineAudioContext(1, 1, sr);
        const buf = await ctx.decodeAudioData(ab.slice(0));
        const d = buf.getChannelData(0);
        let first = -1;
        for (let i = 0; i < buf.length; i++) if (Math.abs(d[i]) > 0.06) { first = i; break; }
        // 前 3000 采样的最大绝对值 (检测前导静音长度)
        let headMax = 0;
        for (let i = 0; i < Math.min(3000, buf.length); i++) headMax = Math.max(headMax, Math.abs(d[i]));
        out['sr' + sr] = {
          length: buf.length,
          firstMs: +(first / sr * 1000).toFixed(2),
          firstSample: first,
          headMax3000: +headMax.toFixed(5),
        };
      }
      return JSON.stringify(out);
    })()
  `);
  console.log(r);
} finally {
  try { edge.kill(); } catch { }
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { }
}
