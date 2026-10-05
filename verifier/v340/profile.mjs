// CDP profile v340: 框选/拖曳帧数低定位 (soulten: 框选到物件后一直拖曳帧数很低; 选滑条点拖曳稳240; 拿滑条甩也低)
//   场景 (各 ~3.5s, CPU profile + 帧率/帧忙时/renderPlayfield 耗时):
//   A0 框选空区拖拽 (对照组, 选区不变)
//   A1 物件框选拖拽经过可见物件 (选区每帧变)
//   B1 Alt 节点框选拖拽同区 (用户说稳 240 — 对照)
//   C1 拖滑条身体甩动 (用户说低)
// 运行: node verifier/v340/profile.mjs   (需要 3000 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:3000/';
const DEBUG_PORT = 9434;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v340-'));
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
// 页面坐标换算
async function osuToPage(ox, oy) {
  return evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(${ox}, ${oy}); return { x: r.left + p.x, y: r.top + p.y }; })()`);
}
// 往复拖拽 (duration ms, 每 16ms 一步)
async function wiggleDrag(from, to, ms, opts = {}) {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms) {
    const k = (i % 40) / 20; // 0→2 三角波
    const f = k <= 1 ? k : 2 - k;
    await mouse('mouseMoved', from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f, opts);
    i++;
    await sleep(4); // CDP 往返 ≈ 每步 ~10-20ms, 接近真实鼠标频率
  }
}

try {
  await send('Runtime.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false)) break;
    await sleep(500);
  }

  // 注入 2000 物件谱面 (同 v245; 当前时间窗内 ~7 个可见)
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

  const pEmpty = await osuToPage(20, 20);   // 空白起点
  const pAll = await osuToPage(448, 320);   // 罩住可见区
  const pMid = await osuToPage(256, 192);
  const resetSel = () => evalJs('window.__osuStore.select([]); window.__osuStore.setSelectedNodes([]);');

  // ---- A0: 空区框选拖拽 (对照) ----
  console.log('== A0: 空区框选拖拽 (选区恒空)');
  await resetSel();
  await mouse('mousePressed', pEmpty.x, pEmpty.y);
  await cpuProfile('A0 空区框选', 3400, async () => {
    const m = evalJs(MEASURE_JS(3000));
    await wiggleDrag(pEmpty, await osuToPage(120, 70), 3000);
    const a0 = await m;
    console.log('  A0:', JSON.stringify(a0));
  });
  await mouse('mouseReleased', pEmpty.x, pEmpty.y);
  await sleep(200);

  // ---- A1: 物件框选拖拽经过可见物件 ----
  console.log('== A1: 物件框选拖拽 (选区每帧变)');
  await resetSel();
  await mouse('mousePressed', pEmpty.x, pEmpty.y);
  await mouse('mouseMoved', pAll.x, pAll.y);
  await cpuProfile('A1 物件框选', 3400, async () => {
    const m = evalJs(MEASURE_JS(3000));
    await wiggleDrag(pAll, pMid, 3000);
    const a1 = await m;
    console.log('  A1:', JSON.stringify(a1));
  });
  await mouse('mouseReleased', pMid.x, pMid.y);
  await sleep(200);

  // ---- B1: Alt 节点框选拖拽 ----
  console.log('== B1: Alt 节点框选拖拽');
  await resetSel();
  await keyAlt(true);
  await mouse('mousePressed', pEmpty.x, pEmpty.y, { alt: true });
  await mouse('mouseMoved', pAll.x, pAll.y, { alt: true });
  await cpuProfile('B1 节点框选', 3400, async () => {
    const m = evalJs(MEASURE_JS(3000));
    await wiggleDrag(pAll, pMid, 3000, { alt: true });
    const b1 = await m;
    console.log('  B1:', JSON.stringify(b1));
  });
  await mouse('mouseReleased', pMid.x, pMid.y, { alt: true });
  await keyAlt(false);
  await sleep(200);

  // ---- C1: 拖滑条身体甩动 ----
  console.log('== C1: 拖滑条甩动');
  await resetSel();
  // 找一个当前可见滑条头位置
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
    const c1 = await m;
    console.log('  C1:', JSON.stringify(c1));
  });
  await mouse('mouseReleased', pMid.x, pMid.y);
} finally {
  edge.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}
process.exit(0);
