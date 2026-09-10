// v246 探针2: 场景E (100物件/秒播放) 的 drawImage 光栅面积分布 — 判定瓶颈是 draw call 数还是像素面积
// 用法: node verifier/v246/area-probe.mjs (需 7100 dev server)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9437;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-area-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run',
  '--window-size=2560,1440', '--force-device-scale-factor=1.5',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('EDGE_CONNECT_FAILED'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

try {
  await send('Runtime.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false)) break;
    await sleep(500);
  }
  // 探针: drawImage 按 (画布|栈顶) 聚合 次数/目标像素面积; arc/fill/stroke 计数
  await evalJs(`(() => {
    const proto = CanvasRenderingContext2D.prototype;
    window.__stats = new Map();
    const add = (key, area) => { const e = window.__stats.get(key) ?? { n: 0, px: 0 }; e.n++; e.px += area; window.__stats.set(key, e); };
    const od = proto.drawImage;
    proto.drawImage = function (...a) {
      let dw = 0, dh = 0;
      if (a.length >= 5) { dw = Math.abs(a[a.length - 2]); dh = Math.abs(a[a.length - 1]); }
      else if (a.length >= 3) { dw = a[0].width; dh = a[0].height; }
      const st = (new Error().stack.split('\\n')[2] || '').replace(/https?:\\/\\/[^/]+\\//, '').replace(/\\?[^:)]*/g, '');
      add('drawImage|' + this.canvas.width + 'x' + this.canvas.height + '|' + st.trim(), dw * dh);
      return od.apply(this, a);
    };
    return 'patched';
  })()`);
  // 场景E 谱面
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const red = base.timingPoints.find(p => p.uninherited);
    const ho = [];
    for (let i = 0; i < 3000; i++) {
      const t = 3000 + i * 10;
      const x = 60 + (i * 47) % 392, y = 60 + (i * 31) % 264;
      ho.push({ ...tc, id: 3000000 + i, time: t, x, y, endTime: t });
    }
    store.load({ ...base, hitObjects: ho, timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.selected = new Set(); store.emitSelection();
    store.seek(10000); store.play();
    return ho.length;
  })()`);
  await sleep(4000);
  const stats = await evalJs(`(() => { window.__osuStore.pause(); return [...window.__stats.entries()]
    .map(([k, v]) => ({ k, n: v.n, mp: +(v.px / 1e6).toFixed(1) }))
    .sort((a, b) => b.mp - a.mp).slice(0, 14); })()`);
  console.log('面积单位: 百万像素 (4s 累计); n = 调用次数');
  for (const s of stats) console.log(String(s.mp).padStart(9), 'Mpx', String(s.n).padStart(7), s.k.slice(0, 130));
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(1200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
