// CDP profile v264: 拖动滑条点 (节点) 帧率实测 + CPU 热点定位
// 用户反馈: soulten「移動滑條點的時候剩下100fps」。
// 场景: 2000 物件谱面 (同 v245 注入), 选中一个可见滑条, 拖其控制点画圆 3s,
//   测 fps / frameBusy / __perfRender + CPU Profiler top selfTime。
// 运行: node verifier/v264/profile-nodedrag.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9436;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v264-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run',
  ...(process.env.PROFILE_SW ? ['--disable-gpu'] : []),
  '--window-size=1440,900',
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
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

async function cpuProfile(label, ms, during) {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 200 });
  await send('Profiler.start');
  const t0 = Date.now();
  if (during) await during();
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  const r = await send('Profiler.stop');
  const prof = r.result?.profile;
  if (!prof) throw new Error('Profiler.stop 无返回');
  const byNode = new Map();
  for (const n of prof.nodes) byNode.set(n.id, n);
  const hits = new Map();
  (prof.samples ?? []).forEach((id, i) => {
    const n = byNode.get(id); if (!n) return;
    const dt = (prof.timeDeltas?.[i] ?? 1000) / 1000;
    const cf = n.callFrame;
    const file = (cf.url || '').split('/').pop()?.split('?')[0] || '(anon)';
    const key = `${cf.functionName || '(anon)'} @ ${file}:${cf.lineNumber + 1}`;
    const e = hits.get(key) ?? { self: 0 };
    e.self += dt; hits.set(key, e);
  });
  const top = [...hits.entries()].sort((a, b) => b[1].self - a[1].self).slice(0, 20)
    .map(([k, v]) => ({ fn: k, ms: +v.self.toFixed(1) }));
  console.log(`-- CPU top (${label}) --`);
  for (const t of top) console.log(`   ${String(t.ms).padStart(8)}ms  ${t.fn}`);
  return top;
}

const MEASURE_JS = (ms) => `(async () => new Promise(resolve => {
  const deltas = [], busy = [];
  const ch = new MessageChannel();
  let frameStart = 0, last = 0;
  ch.port1.onmessage = () => { busy.push(performance.now() - frameStart); };
  const t0 = performance.now();
  const tick = (ts) => {
    if (last) deltas.push(ts - last);
    last = ts; frameStart = performance.now();
    ch.port2.postMessage(0);
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
    else {
      const s = a => [...a].sort((x, y) => x - y);
      const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
      const avg = a => a.length ? a.reduce((v, s2) => v + s2, 0) / a.length : 0;
      const pr = window.__perfRender || [];
      resolve({
        frames: deltas.length, fps: +(1000 / avg(deltas)).toFixed(1),
        frameP95: +q(s(deltas), 0.95).toFixed(2),
        busyAvg: +avg(busy).toFixed(2), busyP95: +q(s(busy), 0.95).toFixed(2),
        renderAvg: +avg(pr).toFixed(2), renderP95: +q(s(pr), 0.95).toFixed(2),
      });
    }
  };
  window.__perfRender = [];
  requestAnimationFrame(tick);
}))()`;

try {
  await send('Runtime.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false)) break;
    await sleep(500);
  }
  console.log('== 注入 2000 物件谱面 (滑条多控制点)');
  const info = await evalJs(`(() => {
    const store = window.__osuStore;
    store.pause && store.pause();
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const ts = base.hitObjects.find(o => o.type === 'slider');
    const red = base.timingPoints.find(p => p.uninherited);
    const objs = [];
    for (let i = 0; i < 2000; i++) {
      const t = 5000 + i * 300;
      const x = 100 + (i * 37) % 312, y = 80 + (i * 53) % 224;
      if (i % 2 === 0) objs.push({ ...tc, id: 1000000 + i, time: t, x, y, endTime: t });
      else objs.push({
        ...ts, id: 1000000 + i, time: t, x, y,
        curvePoints: [
          { x: x + 50, y: y - 45 }, { x: x + 95, y: y + 10 }, { x: x + 95, y: y + 10 },
          { x: x + 140, y: y + 55 }, { x: x + 60, y: y + 90 },
        ],
        curveType: 'B', slides: 1, length: 260, endTime: t + 280,
      });
    }
    const bm = { ...base, hitObjects: objs, timingPoints: [red] };
    store.load(bm, store.audioUrl);
    return { objects: objs.length };
  })()`);
  console.log('  injected:', JSON.stringify(info));

  // 选中一个可见滑条并返回其头部控制点坐标
  const setup = await evalJs(`(() => {
    const store = window.__osuStore;
    store.tool = 'select';
    store.seek(60000);
    const t = store.currentTime;
    const vis = store.beatmap.hitObjects.filter(o => o.type === 'slider' && o.time - 1200 <= t && (o.endTime ?? o.time) + 800 >= t);
    const so = vis[Math.floor(vis.length / 2)];
    if (!so) return null;
    store.selected = new Set([so.id]);
    store.emitSelection();
    return { id: so.id, x: so.x, y: so.y, visible: vis.length };
  })()`);
  if (!setup) throw new Error('找不到可见滑条');
  console.log('  拖动目标:', JSON.stringify(setup));
  await sleep(800);

  console.log('== 场景: 单滑条节点拖动画圆 3s (nodeDragRef 路径)');
  await evalJs(`(() => {
    const c = document.querySelector('canvas.cursor-crosshair');
    const pt = window.__osuToClient(${setup.x}, ${setup.y});
    c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: pt.x, clientY: pt.y }));
    let i = 0;
    window.__ndIv = setInterval(() => {
      i++;
      const x = pt.x + Math.cos(i / 10) * 55, y = pt.y + Math.sin(i / 10) * 55;
      c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y }));
    }, 4);
    return true;
  })()`);
  await cpuProfile('节点拖动', 3400, async () => { const r = await evalJs(MEASURE_JS(3000)); console.log('  指标:', JSON.stringify(r)); });
  await evalJs(`(() => {
    clearInterval(window.__ndIv);
    const c = document.querySelector('canvas.cursor-crosshair');
    c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 }));
    return true;
  })()`);

  console.log('== 对照: 静止 1.5s');
  await evalJs(MEASURE_JS(1500)).then(r => console.log('  指标:', JSON.stringify(r)));
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(1200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 残留临时目录无害 */ }
}
console.log('\nV264_PROFILE_DONE');
