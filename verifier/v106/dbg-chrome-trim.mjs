// 一次性实测: Chrome decodeAudioData 对真实 mp3 是否裁剪编码延迟 (经 dev server /api/local-fs 取文件)
import { spawn } from 'child_process';
import fs from 'fs'; import path from 'path'; import os from 'os';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-dbg3-'));
const REL = "1357624 sabi - true DJ MAG top ranker's song Zenpen (katagiri Remix)/audio.mp3";
const edge = spawn(EDGE, ['--headless=new','--remote-debugging-port=9432',`--user-data-dir=${profile}`,'--no-first-run','--disable-gpu','--autoplay-policy=no-user-gesture-required','http://127.0.0.1:7100/'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) {
  try { const ts = await (await fetch('http://127.0.0.1:9432/json')).json(); target = ts.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:7100/')); } catch {}
  if (!target) await sleep(500);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params={}) => { const id = ++msgId; return new Promise(r => { pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0,300); return r.result?.result?.value; };
try {
  await send('Runtime.enable');
  await sleep(2000);
  console.log(await evalJs(`
    (async () => {
      const rel = ${JSON.stringify(REL)};
      const r = await fetch('/api/local-fs/file?root=songs&rel=' + encodeURIComponent(rel));
      if (!r.ok) return 'fetch failed: ' + r.status;
      const ab = await r.arrayBuffer();
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(ab);
      const d = buf.getChannelData(0);
      let first = -1;
      for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.1) { first = i; break; }
      let headMax = 0;
      for (let i = 0; i < 2000; i++) headMax = Math.max(headMax, Math.abs(d[i]));
      return JSON.stringify({ length: buf.length, sr: buf.sampleRate, sec: (buf.length/buf.sampleRate).toFixed(6), firstTransient: first, firstMs: (first/buf.sampleRate*1000).toFixed(2), headMax });
    })()
  `));
} finally { try { edge.kill(); } catch {} await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {} }
