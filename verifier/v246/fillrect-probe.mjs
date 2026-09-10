// v246 探针: 定位每帧 fillRect/clearRect/drawImage/arc 的调用来源 (按调用栈聚合次数与 self 耗时)
// 用法: node verifier/v246/fillrect-probe.mjs (需 7100 dev server)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9435;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-fr-'));
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
  // 装探针: 包装 fillRect/clearRect/drawImage/arc, 按 (方法|画布尺寸|栈顶两帧) 聚合
  await evalJs(`(() => {
    const proto = CanvasRenderingContext2D.prototype;
    window.__frStats = new Map();
    for (const name of ['fillRect', 'clearRect', 'drawImage', 'arc', 'fillText', 'fill', 'stroke']) {
      const orig = proto[name];
      proto[name] = function (...args) {
        const t0 = performance.now();
        const r = orig.apply(this, args);
        const dt = performance.now() - t0;
        const st = new Error().stack.split('\\n').slice(2, 4).join('<').replace(/https?:\\/\\/[^/]+\\//g, '').replace(/\\?[^:)]*/g, '');
        const key = name + '|' + this.canvas.width + 'x' + this.canvas.height + '|' + st;
        const e = window.__frStats.get(key) ?? { n: 0, ms: 0 };
        e.n++; e.ms += dt;
        window.__frStats.set(key, e);
        return r;
      };
    }
    return 'patched';
  })()`);
  // 换成 300 物件小谱面 (场景C 配置), 静止在 20000ms
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const ts0 = base.hitObjects.find(o => o.type === 'slider') ?? tc;
    const ho = [];
    for (let i = 0; i < 300; i++) {
      const t = 3000 + i * 500;
      const x = 100 + (i * 37) % 312, y = 80 + (i * 53) % 224;
      if (i % 3 === 2) ho.push({ ...ts0, id: 2000000 + i, time: t, x, y, endTime: t + 400 });
      else ho.push({ ...tc, id: 2000000 + i, time: t, x, y, endTime: t });
    }
    const red = base.timingPoints.find(p => p.uninherited);
    store.load({ ...base, hitObjects: ho, timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.selected = new Set(); store.emitSelection();
    store.seek(20000);
    return ho.length;
  })()`);
  await sleep(4000);
  const stats = await evalJs(`[...window.__frStats.entries()].map(([k, v]) => ({ k, n: v.n, ms: +v.ms.toFixed(1), per4s: +(v.n/4).toFixed(0)+'/s' }))
    .sort((a, b) => b.ms - a.ms).slice(0, 18)`);
  for (const s of stats) console.log(String(s.ms).padStart(8), String(s.n).padStart(6), s.k.slice(0, 150));
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(1200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
