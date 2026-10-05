// CDP profile v340 (Electron / production 构建): dev server 版 React 开销掩盖差异, 用 Electron 跑 dist 重测
//   场景同 profile.mjs: A0 空区框选 / A1 物件框选 / B1 Alt 节点框选 / C1 拖滑条甩动
// 运行: npm run build 后 node verifier/v340/profile-electron.mjs  (会短暂弹出编辑器窗口)
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9435;

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
if (!target) { console.error('找不到 Electron 页面目标'); electron.kill(); process.exit(2); }
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
    hits.set(key, (hits.get(key) ?? 0) + dt);
  });
  const top = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log(`-- CPU top (${label}) --`);
  for (const [k, v] of top) console.log(`   ${v.toFixed(1).padStart(8)}ms  ${k}`);
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
        busyAvg: +avg(busy).toFixed(2), busyP95: +q(s(busy), 0.95).toFixed(2),
        renderAvg: +avg(pr).toFixed(2), renderP95: +q(s(pr), 0.95).toFixed(2),
      });
    }
  };
  window.__perfRender = [];
  requestAnimationFrame(tick);
}))()`;

const MOD_ALT = 1;
async function mouse(type, x, y, opts = {}) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0,
    buttons: type === 'mouseReleased' ? 0 : 1, modifiers: opts.alt ? MOD_ALT : 0,
  });
}
async function keyAlt(down) {
  await send('Input.dispatchKeyEvent', {
    type: down ? 'rawKeyDown' : 'keyUp', key: 'Alt', code: 'AltLeft',
    windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: down ? MOD_ALT : 0,
  });
}
async function osuToPage(ox, oy) {
  return evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(${ox}, ${oy}); return { x: r.left + p.x, y: r.top + p.y }; })()`);
}
async function wiggleDrag(from, to, ms, opts = {}) {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms) {
    const k = (i % 40) / 20;
    const f = k <= 1 ? k : 2 - k;
    await mouse('mouseMoved', from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f, opts);
    i++;
    await sleep(4);
  }
}

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)').catch(() => false);
  }
  if (!ready) throw new Error('Electron 应用未就绪');

  // 注入 2000 物件谱面 (同 profile.mjs)
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
      else objs.push({
        ...ts, id: 1000000 + i, time: t, x, y,
        curvePoints: [{ x: x + 60, y: y - 40 }, { x: x + 120, y: y }, { x: x + 120, y: y + 60 }],
        curveType: 'B', slides: 1, length: 190, endTime: t + 280,
      });
    }
    store.load({ ...base, hitObjects: objs, timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(60000);
  })()`);
  await sleep(800);

  const pEmpty = await osuToPage(20, 20);
  const pAll = await osuToPage(448, 320);
  const pMid = await osuToPage(256, 192);
  const resetSel = () => evalJs('window.__osuStore.select([]); window.__osuStore.setSelectedNodes([]);');

  console.log('== A0: 空区框选拖拽 (对照, 选区恒空)');
  await resetSel();
  await mouse('mousePressed', pEmpty.x, pEmpty.y);
  await cpuProfile('A0 空区框选', 3400, async () => {
    const m = evalJs(MEASURE_JS(3000));
    await wiggleDrag(pEmpty, await osuToPage(120, 70), 3000);
    console.log('  A0:', JSON.stringify(await m));
  });
  await mouse('mouseReleased', pEmpty.x, pEmpty.y);
  await sleep(200);

  console.log('== A1: 物件框选拖拽 (选区每帧变)');
  await resetSel();
  await mouse('mousePressed', pEmpty.x, pEmpty.y);
  await mouse('mouseMoved', pAll.x, pAll.y);
  await cpuProfile('A1 物件框选', 3400, async () => {
    const m = evalJs(MEASURE_JS(3000));
    await wiggleDrag(pAll, pMid, 3000);
    console.log('  A1:', JSON.stringify(await m));
  });
  await mouse('mouseReleased', pMid.x, pMid.y);
  await sleep(200);

  console.log('== B1: Alt 节点框选拖拽 (用户称稳240)');
  await resetSel();
  await keyAlt(true);
  await mouse('mousePressed', pEmpty.x, pEmpty.y, { alt: true });
  await mouse('mouseMoved', pAll.x, pAll.y, { alt: true });
  await cpuProfile('B1 节点框选', 3400, async () => {
    const m = evalJs(MEASURE_JS(3000));
    await wiggleDrag(pAll, pMid, 3000, { alt: true });
    console.log('  B1:', JSON.stringify(await m));
  });
  await mouse('mouseReleased', pMid.x, pMid.y, { alt: true });
  await keyAlt(false);
  await sleep(200);

  console.log('== C1: 拖滑条甩动 (用户称低)');
  await resetSel();
  const head = await evalJs(`(() => {
    const s = window.__osuStore;
    const v = s.beatmap.hitObjects.filter(o => Math.abs(o.time - s.currentTime) < 2000);
    const sl = v.find(o => o.type === 'slider') ?? v[0];
    const r = document.querySelector('canvas').getBoundingClientRect();
    const p = window.__osuToCanvas(sl.x, sl.y);
    return { x: r.left + p.x, y: r.top + p.y, id: sl.id };
  })()`);
  await mouse('mousePressed', head.x, head.y);
  await cpuProfile('C1 拖滑条', 3400, async () => {
    const m = evalJs(MEASURE_JS(3000));
    await wiggleDrag(head, pMid, 3000);
    console.log('  C1:', JSON.stringify(await m));
  });
  await mouse('mouseReleased', pMid.x, pMid.y);
  await sleep(200);

  // ---- 密集可见场景: 1000 物件全部堆在当前时间可见窗口内 (模拟用户实图) ----
  console.log('== 切换密集可见场景 (1000 物件同屏)');
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const ts = base.hitObjects.find(o => o.type === 'slider');
    const objs = [];
    for (let i = 0; i < 1000; i++) {
      const t = 59800 + (i % 40) * 10; // 全部落在 59800..60190, currentTime 60000 全可见
      const x = 20 + (i * 37) % 472, y = 20 + (i * 53) % 344;
      if (i % 2 === 0) objs.push({ ...tc, id: 2000000 + i, time: t, x, y, endTime: t });
      else objs.push({
        ...ts, id: 2000000 + i, time: t, x, y,
        curvePoints: [{ x: Math.min(500, x + 40), y: y + 30 }],
        curveType: 'L', slides: 1, length: 60, endTime: t + 100,
      });
    }
    store.load({ ...base, hitObjects: objs }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(60000);
  })()`);
  await sleep(800);

  // 分段耗时读取 (渲染器 __perfSub / 时间轴 __perfTlA/__perfTlB)
  const subStats = () => evalJs(`(() => {
    const avg = a => a && a.length ? +(a.reduce((v, s) => v + s, 0) / a.length).toFixed(2) : 0;
    const r = { scene: avg(window.__perfScene), sel: avg(window.__perfSel),
      tlA: avg(window.__perfTlA), tlB: avg(window.__perfTlB) };
    window.__perfScene = []; window.__perfSel = []; window.__perfTlA = []; window.__perfTlB = [];
    return JSON.stringify(r);
  })()`);

  console.log('== E0: 密集场静止 (无输入, 对照底噪)');
  {
    const m = evalJs(MEASURE_JS(2000));
    await sleep(2100);
    console.log('  E0:', JSON.stringify(await m), 'sub:', await subStats());
  }

  console.log('== D1: 密集场物件框选拖拽 (~1000 物件进出选区)');
  await resetSel();
  await evalJs('window.__sceneDbg = { rebuilds: 0, prevKey: "", diff: "" }');
  await mouse('mousePressed', pEmpty.x, pEmpty.y);
  await mouse('mouseMoved', pAll.x, pAll.y);
  await cpuProfile('D1 密集物件框选', 3400, async () => {
    const m = evalJs(MEASURE_JS(3000));
    await wiggleDrag(pAll, pMid, 3000);
    console.log('  D1:', JSON.stringify(await m), 'sub:', await subStats(),
      'dbg:', await evalJs('JSON.stringify(window.__sceneDbg)'));
  });
  await mouse('mouseReleased', pMid.x, pMid.y);
  await sleep(200);

  console.log('== D2: 密集场拖滑条甩动 (~1000 物件同屏)');
  await resetSel();
  const head2 = await evalJs(`(() => {
    const s = window.__osuStore;
    const sl = s.beatmap.hitObjects.find(o => o.type === 'slider');
    const r = document.querySelector('canvas').getBoundingClientRect();
    const p = window.__osuToCanvas(sl.x, sl.y);
    return { x: r.left + p.x, y: r.top + p.y, id: sl.id };
  })()`);
  await mouse('mousePressed', head2.x, head2.y);
  await cpuProfile('D2 密集拖滑条', 3400, async () => {
    const m = evalJs(MEASURE_JS(3000));
    await wiggleDrag(head2, pMid, 3000);
    console.log('  D2:', JSON.stringify(await m), 'sub:', await subStats());
  });
  await mouse('mouseReleased', pMid.x, pMid.y);

  console.log('== D3: 密集场 Alt 节点框选拖拽 (对照)');
  await resetSel();
  await keyAlt(true);
  await mouse('mousePressed', pEmpty.x, pEmpty.y, { alt: true });
  await mouse('mouseMoved', pAll.x, pAll.y, { alt: true });
  await cpuProfile('D3 密集节点框选', 3400, async () => {
    const m = evalJs(MEASURE_JS(3000));
    await wiggleDrag(pAll, pMid, 3000, { alt: true });
    console.log('  D3:', JSON.stringify(await m), 'sub:', await subStats());
  });
  await mouse('mouseReleased', pMid.x, pMid.y, { alt: true });
  await keyAlt(false);
} finally {
  electron.kill();
}
process.exit(0);
