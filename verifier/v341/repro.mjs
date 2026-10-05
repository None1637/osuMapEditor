// v341 复现: 全选物件掉帧到 1fps — Electron production, 2000 物件谱面, Ctrl+A 全选后测帧率+分段耗时
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9438;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('找不到页面目标'); electron.kill(); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

const MEASURE_JS = (ms) => `(async () => new Promise(resolve => {
  const deltas = [];
  let last = 0;
  const t0 = performance.now();
  const tick = (ts) => {
    if (last) deltas.push(ts - last);
    last = ts;
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
    else {
      const avg = a => a.length ? +(a.reduce((v, s) => v + s, 0) / a.length).toFixed(2) : 0;
      resolve({ frames: deltas.length, fps: +(1000 / avg(deltas)).toFixed(1),
        renderAvg: avg(window.__perfRender), scene: avg(window.__perfScene), sel: avg(window.__perfSel),
        tlA: avg(window.__perfTlA), tlB: avg(window.__perfTlB), move: avg(window.__perfMove) });
    }
  };
  window.__perfRender = []; window.__perfScene = []; window.__perfSel = []; window.__perfTlA = []; window.__perfTlB = []; window.__perfMove = [];
  requestAnimationFrame(tick);
}))()`;

async function cpuProfile(label, ms) {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 500 });
  await send('Profiler.start');
  await sleep(ms);
  const r = await send('Profiler.stop');
  const prof = r.result?.profile;
  const byNode = new Map();
  for (const n of prof.nodes) byNode.set(n.id, n);
  const hits = new Map();
  (prof.samples ?? []).forEach((id, i) => {
    const n = byNode.get(id); if (!n) return;
    const dt = (prof.timeDeltas?.[i] ?? 1000) / 1000;
    const cf = n.callFrame;
    const file = (cf.url || '').split('/').pop()?.split('?')[0] || '(anon)';
    const key = `${cf.functionName || '(anon)'} @ ${file}:${cf.lineNumber + 1}`;
    hits.set(key, (hits.get(key) ?? 0) + dt);
  });
  console.log(`-- CPU top (${label}) --`);
  for (const [k, v] of [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(`   ${v.toFixed(1).padStart(8)}ms  ${k}`);
}

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)').catch(() => false);
  }
  if (!ready) throw new Error('未就绪');

  // 2000 物件谱面 (同 v245 全选场景: 物件分布在整曲, 当前窗可见 ~7 个)
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const ts = base.hitObjects.find(o => o.type === 'slider');
    const red = base.timingPoints.find(p => p.uninherited);
    const objs = [];
    for (let i = 0; i < 2000; i++) {
      const t = 5000 + i * 300;
      const x = 100 + (i * 37) % 312, y = 80 + (i * 53) % 224;
      if (i % 2 === 0) objs.push({ ...tc, id: 1000000 + i, time: t, x, y, endTime: t });
      else objs.push({ ...ts, id: 1000000 + i, time: t, x, y,
        curvePoints: [{ x: x + 60, y: y - 40 }, { x: x + 120, y: y }, { x: x + 120, y: y + 60 }],
        curveType: 'B', slides: 1, length: 190, endTime: t + 280 });
    }
    store.load({ ...base, hitObjects: objs, timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(60000);
  })()`);
  await sleep(800);

  console.log('== 未选中基线 ==');
  console.log('  base:', JSON.stringify(await evalJs(MEASURE_JS(2000))));

  console.log('== 全选 2000 物件 ==');
  await evalJs('window.__osuStore.select(window.__osuStore.beatmap.hitObjects.map(o => o.id))');
  await sleep(300);
  const m = evalJs(MEASURE_JS(2500));
  await cpuProfile('全选后静止', 2600);
  console.log('  selAll:', JSON.stringify(await m));

  // ---- 密集可见场景 (1000 物件同屏) + 全选 ----
  console.log('== 密集场景全选 ==');
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const ts = base.hitObjects.find(o => o.type === 'slider');
    const objs = [];
    for (let i = 0; i < 1000; i++) {
      const t = 59800 + (i % 40) * 10;
      const x = 20 + (i * 37) % 472, y = 20 + (i * 53) % 344;
      if (i % 2 === 0) objs.push({ ...tc, id: 2000000 + i, time: t, x, y, endTime: t });
      else objs.push({ ...ts, id: 2000000 + i, time: t, x, y,
        curvePoints: [{ x: Math.min(500, x + 40), y: y + 30 }], curveType: 'L', slides: 1, length: 60, endTime: t + 100 });
    }
    store.load({ ...base, hitObjects: objs }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(60000);
  })()`);
  await sleep(500);
  console.log('  dense base:', JSON.stringify(await evalJs(MEASURE_JS(2000))));
  await evalJs('window.__osuStore.select(window.__osuStore.beatmap.hitObjects.map(o => o.id))');
  await sleep(300);
  const m2 = evalJs(MEASURE_JS(2500));
  await cpuProfile('密集全选静止', 2600);
  console.log('  dense selAll:', JSON.stringify(await m2));

  // ---- 密集全选后拖动 (全选 1000 物件一起拖) ----
  console.log('== 密集全选后拖动 ==');
  const toPage = (ox, oy) => evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(${ox}, ${oy}); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  // 找一个被选中物件的堆叠后可视位置 (直接在画布中心点选一个)
  const pC = await toPage(256, 192);
  const hitId = await evalJs(`(() => {
    // 找可视中心最近的已选物件
    const s = window.__osuStore;
    let best = null, bd = 1e9;
    for (const o of s.beatmap.hitObjects) {
      const d = Math.hypot(o.x - 256, o.y - 192);
      if (d < bd) { bd = d; best = o; }
    }
    const r = document.querySelector('canvas').getBoundingClientRect();
    const p = window.__osuToCanvas(best.x, best.y);
    return { x: r.left + p.x, y: r.top + p.y };
  })()`);
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0, buttons: type === 'mouseReleased' ? 0 : 1,
  });
  await mouse('mousePressed', hitId.x, hitId.y);
  const m3 = evalJs(MEASURE_JS(2500));
  const prof = cpuProfile('全选拖动', 2600);
  {
    const t0 = Date.now(); let i = 0;
    while (Date.now() - t0 < 2400) {
      const k = (i % 20) / 10, f = k <= 1 ? k : 2 - k; // 0→1→0 三角波
      await mouse('mouseMoved', hitId.x + 120 * f - 60, hitId.y + 80 * f - 40);
      if (i === 30) console.log('  midDragState:', JSON.stringify(await evalJs('window.__dragState')));
      i++; await sleep(4);
    }
  }
  await prof;
  console.log('  dragAll:', JSON.stringify(await m3));
  console.log('  dragPath:', await evalJs('window.__dragPath'));
  console.log('  dragState:', JSON.stringify(await evalJs('window.__dragState')));
  await mouse('mouseReleased', pC.x, pC.y);

  // ---- 关掉 limitToPlayfield 再拖一次 (排除界外钳制分歧) ----
  console.log('== 关 limitToPlayfield 拖动 ==');
  await evalJs('window.__osuStore.setLimitToPlayfield ? window.__osuStore.setLimitToPlayfield(false) : (window.__osuStore.limitToPlayfield = false)');
  await mouse('mousePressed', hitId.x, hitId.y);
  const m4 = evalJs(MEASURE_JS(2500));
  {
    const t0 = Date.now(); let i = 0;
    while (Date.now() - t0 < 2400) {
      const k = (i % 20) / 10, f = k <= 1 ? k : 2 - k;
      await mouse('mouseMoved', hitId.x + 90 * f - 45, hitId.y + 60 * f - 30);
      if (i === 30) console.log('  midDragState:', JSON.stringify(await evalJs('window.__dragState')));
      i++; await sleep(4);
    }
  }
  console.log('  dragAllNoLimit:', JSON.stringify(await m4));
  console.log('  dragPath:', await evalJs('window.__dragPath'));
  await mouse('mouseReleased', pC.x, pC.y);
} finally {
  electron.kill();
}
process.exit(0);
