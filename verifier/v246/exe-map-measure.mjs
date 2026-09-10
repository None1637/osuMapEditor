// v246 exe 实测: 启动打包 exe (Electron), 经 __osuMenuCmd 打开用户反馈的谱面, 测编辑器帧率
// 用法: node verifier/v246/exe-map-measure.mjs
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXE = path.join(root, 'release', 'osu! Map Editor 0.1.2.exe');
const DEBUG_PORT = 9441;
const FOLDER = 'beatmap-639217845366573336-audio';
const FILE = 'cygnus - Book of Dark Magic (None1637) [Magic].osu';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const exe = spawn(EXE, [`--remote-debugging-port=${DEBUG_PORT}`], { stdio: 'ignore' });

let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('EXE_CONNECT_FAILED'); process.exit(2); }
console.log('page:', target.url); // 7100 被 vite 占用时应为随机端口 = exe 内嵌 dist
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
      resolve({ frames: deltas.length, fps: +(1000 / avg(deltas)).toFixed(1),
        frameP95: +q(s(deltas), 0.95).toFixed(2),
        busyAvg: +avg(busy).toFixed(2), busyP95: +q(s(busy), 0.95).toFixed(2),
        renderAvg: +avg(pr).toFixed(2), renderP95: +q(s(pr), 0.95).toFixed(2) });
    }
  };
  window.__perfRender = [];
  requestAnimationFrame(tick);
}))()`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.bringToFront'); // 确保窗口前台 (遮挡会暂停渲染)
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!window.__osuMenuCmd').catch(() => false)) break;
    await sleep(500);
  }
  console.log('== 打开谱面:', FOLDER + '/' + FILE);
  const opened = await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: ${JSON.stringify(FOLDER)}, file: ${JSON.stringify(FILE)} })
    .then(() => !!window.__osuStore.beatmap).catch(e => 'ERR ' + e)`);
  console.log('  opened:', opened);
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!window.__osuStore.audioBuffer').catch(() => false)) break;
    await sleep(500);
  }
  const info = await evalJs(`(() => { const bm = window.__osuStore.beatmap; return bm ? {
    objects: bm.hitObjects.length, points: bm.timingPoints.length,
    len: Math.round(window.__osuStore.songLength()),
    cs: bm.difficulty.cs, ar: bm.difficulty.ar,
    dpr: window.devicePixelRatio, win: window.innerWidth + 'x' + window.innerHeight,
  } : null; })()`);
  console.log('  beatmap:', JSON.stringify(info));

  console.log('== 静止 (seek 到物件密集处)');
  await evalJs(`(() => { const s = window.__osuStore; s.pause();
    const ts = s.beatmap.hitObjects.map(o => o.time).sort((a,b)=>a-b);
    s.seek(ts[Math.floor(ts.length/2)]); return 1; })()`);
  await sleep(1200);
  console.log('  静止:', JSON.stringify(await evalJs(MEASURE_JS(3000))));

  console.log('== 播放');
  await evalJs('window.__osuStore.play()');
  await sleep(500);
  console.log('  播放:', JSON.stringify(await evalJs(MEASURE_JS(4000))));
  await evalJs('window.__osuStore.pause()');

  // 合成 300 物件小谱面 (对照 headless 场景D — 同代码同密度, 只差运行容器)
  console.log('== 合成 300 物件谱面播放 (对照场景D)');
  await evalJs(`(() => {
    const store = window.__osuStore;
    store.pause();
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
  await sleep(800);
  await evalJs('window.__osuStore.play()');
  await sleep(500);
  console.log('  D对照:', JSON.stringify(await evalJs(MEASURE_JS(4000))));
  await evalJs('window.__osuStore.pause()');
} finally {
  try { exe.kill(); } catch { /* noop */ }
}
process.exit(0);
