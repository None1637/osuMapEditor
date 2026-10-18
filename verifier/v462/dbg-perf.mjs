// v462 实测: 密集谱面 (1500 物件) + 选中滑条, Alt 框选拖动期间 renderPlayfield 耗时采样
// 对照修复前: 每次 mousemove emit → version bump → 选中装饰层逐帧重建 (滑条路径采样) + React 重渲染
import { fileURLToPath } from 'url';
import path from 'path';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9496;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
    } catch { /* not ready */ }
    if (!target) await sleep(500);
  }
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
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  await normalizeEnv(evalJs);
  await sleep(500);
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const red = base.timingPoints.find(p => p.uninherited);
    const t = Math.round(red.time + red.beatLength * 4);
    const objs = [];
    for (let i = 0; i < 1500; i++) // 密集: 每 5ms 一个单点, 摆满游玩区
      objs.push({ id: 500000 + i, type: 'circle', x: 40 + (i % 16) * 30, y: 40 + ((i / 16) | 0) % 12 * 30,
        time: t + i * 5, newCombo: false, comboSkip: 0, hitSound: 0 });
    objs.push({ id: 462001, type: 'slider', x: 100, y: 100, time: t, newCombo: false, comboSkip: 0, hitSound: 0,
      curveType: 'B', curvePoints: [{ x: 200, y: 40 }, { x: 300, y: 100 }, { x: 200, y: 160 }], slides: 1, length: 320 });
    store.load({ ...base, hitObjects: objs }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(t + 5); // 视野内大量物件 + 滑条锚点可交互
    store.clearSelection(); store.setSelectedNodes([]);
    store.select([462001]);
  })()`);
  await sleep(1500); // 星数重算落定
  const r = await evalJs(`(async () => {
    const store = window.__osuStore;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    window.__perfRender = [];
    const c = document.querySelector('canvas.cursor-crosshair');
    const p0 = window.__osuToClient(20, 20), p1 = window.__osuToClient(500, 360);
    c.dispatchEvent(new MouseEvent('mousedown', { clientX: p0.x, clientY: p0.y, button: 0, altKey: true, bubbles: true, cancelable: true }));
    await sleep(50);
    const t0 = performance.now();
    let frames0 = 0;
    const count = () => { frames0++; if (performance.now() - t0 < 9999) requestAnimationFrame(count); };
    requestAnimationFrame(count);
    for (let i = 1; i <= 24; i++) {
      const px = p0.x + (p1.x - p0.x) * i / 24, py = p0.y + (p1.y - p0.y) * i / 24;
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: px, clientY: py, altKey: true, bubbles: true }));
      await sleep(33);
    }
    const wall = performance.now() - t0;
    c.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
    const pf = window.__perfRender.slice(3); // 去头几帧预热
    pf.sort((a, b) => a - b);
    const avg = pf.reduce((s, v) => s + v, 0) / pf.length;
    return { frames: frames0, wall: Math.round(wall), renderAvgMs: +avg.toFixed(2), renderP95Ms: +pf[Math.floor(pf.length * 0.95)].toFixed(2), nodes: store.nodeSelectionCount };
  })()`);
  console.log(`框选 24 步 / 墙面 ${r.wall}ms → rAF 帧数 ${r.frames} (≈${Math.round(r.frames / (r.wall / 1000))}fps), renderPlayfield avg ${r.renderAvgMs}ms p95 ${r.renderP95Ms}ms, 框到节点 ${r.nodes}`);
  ws.close();
} finally {
  await killIsolated(electron, profile);
}
