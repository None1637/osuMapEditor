// 一次性探针: Chrome decodeAudioData 是否裁剪该 mp3 的 Xing/LAME 延迟
// 对照 ffmpeg 裁剪解码: 首瞬态 0ms, 17027396 samples (386.1088s)
// Chrome 未裁剪 → 首瞬态 ≈ sample 1105 (25.06ms), length ≈ 17027396+1105
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9436;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-dbg-trim-'));
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
      const resp = await fetch('/dbg-audio.mp3');
      if (!resp.ok) return 'fetch failed: ' + resp.status;
      const ab = await resp.arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buf = await ctx.decodeAudioData(ab);
      const d = buf.getChannelData(0);
      const n = buf.length;
      let first = -1;
      for (let i = 0; i < n; i++) if (Math.abs(d[i]) > 0.06) { first = i; break; }
      let maxHead = 0;
      for (let i = 0; i < 100; i++) maxHead = Math.max(maxHead, Math.abs(d[i]));
      let maxAt1105 = 0;
      for (let i = 1105; i < 1300; i++) maxAt1105 = Math.max(maxAt1105, Math.abs(d[i]));
      return JSON.stringify({
        sr: buf.sampleRate, length: n, dur: +(n / buf.sampleRate).toFixed(6),
        firstOverThresh: first, firstMs: +(first / buf.sampleRate * 1000).toFixed(2),
        maxHead100: +maxHead.toFixed(5), maxAt1105_1300: +maxAt1105.toFixed(4),
      });
    })()
  `);
  console.log('Chrome 解码:', r);
  console.log('ffmpeg 对照: length=17027396 dur=386.108753 首瞬态=0ms');
} finally {
  try { edge.kill(); } catch { }
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { }
}
