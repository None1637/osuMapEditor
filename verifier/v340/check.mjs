// CDP check v340 (Electron / production): 密集谱面 (1000 物件同屏) 下框选/拖曳的渲染耗时
//   修复前: renderPlayfield 每帧 ~20ms (逐物件全量重画 + 选中装饰 shadowBlur/全幅离屏合成), ~20fps
//   修复后: 静态场景层命中 (每帧 1 次 drawImage) + 装饰 sprite 缓存 — renderAvg 应 < 2ms
//   另验证静态层键稳定 (框选/拖拽期间 __sceneDbg.rebuilds <= 2: 进场一次 + 落盘一次)
// 运行: npm run build 后 node verifier/v340/check.mjs  (会短暂弹出编辑器窗口)
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9437;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('找不到 Electron 页面目标'); electron.kill(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown')
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? ''));
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
const mouse = (type, x, y, alt = false) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0,
  buttons: type === 'mouseReleased' ? 0 : 1, modifiers: alt ? 1 : 0,
});

const MEASURE_JS = (ms) => `(async () => new Promise(resolve => {
  const t0 = performance.now();
  const tick = () => {
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
    else {
      const a = window.__perfRender || [];
      const avg = a.length ? a.reduce((v, s) => v + s, 0) / a.length : 0;
      const s = [...a].sort((x, y) => x - y);
      resolve({ renderAvg: +avg.toFixed(2), renderP95: +(a.length ? s[Math.floor(a.length * 0.95)] : 0).toFixed(2) });
    }
  };
  window.__perfRender = [];
  requestAnimationFrame(tick);
}))()`;

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)').catch(() => false);
  }
  if (!ready) throw new Error('Electron 应用未就绪');

  // 密集可见场景: 1000 物件全部落在当前时间可见窗口
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
    window.__sceneDbg = { rebuilds: 0, prevKey: '', diff: '' };
  })()`);
  await sleep(500);
  const toPage = (ox, oy) => evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(${ox}, ${oy}); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  const wiggle = async (a, b, ms) => {
    const t0 = Date.now(); let i = 0;
    while (Date.now() - t0 < ms) {
      const k = (i % 20) / 10, f = k <= 1 ? k : 2 - k;
      await mouse('mouseMoved', a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      i++; await sleep(4);
    }
  };
  const pEmpty = await toPage(20, 20), pAll = await toPage(448, 320), pMid = await toPage(256, 192);

  // ---- 物件框选/拖拽 (pEmpty 处有物件, 落下即拖拽; 路径覆盖大半个游玩区) ----
  await evalJs('window.__osuStore.select([]); window.__osuStore.setSelectedNodes([]); window.__sceneDbg.rebuilds = 0;');
  await mouse('mousePressed', pEmpty.x, pEmpty.y);
  await mouse('mouseMoved', pAll.x, pAll.y);
  const m1 = evalJs(MEASURE_JS(1500));
  await wiggle(pAll, pMid, 1500);
  const d1 = await m1;
  await mouse('mouseReleased', pMid.x, pMid.y);
  console.log('  拖拽 render:', JSON.stringify(d1));
  assert(d1.renderAvg < 2 && d1.renderP95 < 6, `拖拽 renderPlayfield 耗时 (avg=${d1.renderAvg}ms p95=${d1.renderP95}ms, 修复前 ~20ms)`);
  let rb = JSON.parse(await evalJs('JSON.stringify(window.__sceneDbg)')).rebuilds;
  assert(rb <= 2, `拖拽期间静态层重建次数 <= 2 (实际 ${rb})`);
  await sleep(200);

  // ---- Alt 节点框选 ----
  await evalJs('window.__osuStore.select([]); window.__osuStore.setSelectedNodes([]); window.__sceneDbg.rebuilds = 0;');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 1 });
  await mouse('mousePressed', pEmpty.x, pEmpty.y, true);
  await mouse('mouseMoved', pAll.x, pAll.y, true);
  const m2 = evalJs(MEASURE_JS(1500));
  await wiggle(pAll, pMid, 1500);
  const d2 = await m2;
  await mouse('mouseReleased', pMid.x, pMid.y, true);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 0 });
  console.log('  节点框选 render:', JSON.stringify(d2));
  assert(d2.renderAvg < 2 && d2.renderP95 < 6, `节点框选 renderPlayfield 耗时 (avg=${d2.renderAvg}ms p95=${d2.renderP95}ms)`);
  rb = JSON.parse(await evalJs('JSON.stringify(window.__sceneDbg)')).rebuilds;
  assert(rb <= 2, `节点框选期间静态层重建次数 <= 2 (实际 ${rb})`);

  // ---- 视觉正确性兜底: 静态层命中时物件仍可见 (画布中心区域非纯背景色) ----
  const px = await evalJs(`(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(Math.floor(c.width / 2) - 40, Math.floor(c.height / 2) - 40, 80, 80).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
    return lit;
  })()`);
  assert(px > 50, `静态层命中后物件仍渲染 (中心亮像素 ${px})`);

  if (exceptions.length) { failures++; console.error('  FAIL: 页面异常:', exceptions.slice(0, 3)); }
} finally {
  electron.kill();
}
console.log(failures ? `\n${failures} 个断言失败` : '\ncheck v340 全部通过');
process.exit(failures ? 1 : 0);
