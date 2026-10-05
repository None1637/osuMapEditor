// CDP check v341 (Electron / production): 全选大选区拖动的渲染耗时
//   修复前: 全选 1000 物件拖动 renderPlayfield ~20ms/帧 + 选中装饰层逐帧重建 ~40ms/帧 + mousemove 未节流 → ~2fps (用户实测 1fps)
//   修复后: 平移拖拽层 + 装饰层位移 blit (dragPath=translate) + 拖拽 rAF 节流 — renderAvg 应 < 4ms
//   另验证: 按住未拖动 (moved=false) 时不走排除重建; 拖拽中 __dragState.uniform=true
// 运行: npm run build 后 node verifier/v341/check.mjs  (会短暂弹出编辑器窗口)
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9441;
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
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0,
  buttons: type === 'mouseReleased' ? 0 : 1,
});

const MEASURE_JS = (ms) => `(async () => new Promise(resolve => {
  const t0 = performance.now();
  const tick = () => {
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
    else {
      const avg = a => a.length ? +(a.reduce((v, s) => v + s, 0) / a.length).toFixed(2) : 0;
      resolve({ renderAvg: avg(window.__perfRender), scene: avg(window.__perfScene), sel: avg(window.__perfSel) });
    }
  };
  window.__perfRender = []; window.__perfScene = []; window.__perfSel = [];
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

  // 密集可见场景: 1000 物件全部落在当前时间可见窗口 (全选拖动最坏情况)
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
  const toPage = (ox, oy) => evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(${ox}, ${oy}); return { x: r.left + p.x, y: r.top + p.y }; })()`);

  // 全选 1000 物件
  await evalJs('window.__osuStore.select(window.__osuStore.beatmap.hitObjects.map(o => o.id))');
  await sleep(300);
  const m0 = evalJs(MEASURE_JS(1500));
  await sleep(1600);
  const d0 = await m0;
  console.log('  全选静止:', JSON.stringify(d0));
  assert(d0.renderAvg < 1.5, `全选静止 renderPlayfield (avg=${d0.renderAvg}ms)`);

  // 找一个距游玩区中心最近的物件作为拖拽落手点
  const hit = await evalJs(`(() => {
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

  // 按下但未拖动: 不应走排除重建 (dragPath 不应出现 live-exclude/translate)
  await evalJs('window.__dragPath = undefined');
  await mouse('mousePressed', hit.x, hit.y);
  await sleep(400);
  const pathIdle = await evalJs('window.__dragPath ?? "none"');
  assert(pathIdle === 'none', `按住未拖动不进排除/平移层 (实际 ${pathIdle})`);

  // 全选拖动 (三角波往返 ±60/±40 布局 px)
  const m1 = evalJs(MEASURE_JS(1800));
  let midState = null;
  {
    const t0 = Date.now(); let i = 0;
    while (Date.now() - t0 < 1700) {
      const k = (i % 20) / 10, f = k <= 1 ? k : 2 - k;
      await mouse('mouseMoved', hit.x + 120 * f - 60, hit.y + 80 * f - 40);
      if (i === 30) midState = await evalJs('window.__dragState');
      i++; await sleep(4);
    }
  }
  const d1 = await m1;
  await mouse('mouseReleased', hit.x, hit.y);
  const pathDrag = await evalJs('window.__dragPath ?? "none"');
  console.log('  全选拖动:', JSON.stringify(d1), 'dragPath:', pathDrag, 'midState:', JSON.stringify(midState));
  assert(midState && midState.moved === true && midState.uniform === true, `拖拽状态 moved+uniform (实际 ${JSON.stringify(midState)})`);
  assert(pathDrag === 'translate', `平移拖拽层命中 (实际 ${pathDrag})`);
  assert(d1.renderAvg < 4 && d1.sel < 2, `全选拖动 renderPlayfield (render=${d1.renderAvg}ms sel=${d1.sel}ms, 修复前 20ms+/40ms+)`);

  if (exceptions.length) { failures++; console.error('  FAIL: 页面异常:', exceptions.slice(0, 3)); }
} finally {
  electron.kill();
}
console.log(failures ? `\n${failures} 个断言失败` : '\ncheck v341 全部通过');
process.exit(failures ? 1 : 0);
