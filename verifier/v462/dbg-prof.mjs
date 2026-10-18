// v462 调试: CDP Profiler 抓框选期间热点函数 (自耗时 Top 20)
import { fileURLToPath } from 'url';
import path from 'path';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 9493;
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
    for (let i = 0; i < 1500; i++)
      objs.push({ id: 500000 + i, type: 'circle', x: 40 + (i % 16) * 30, y: 40 + ((i / 16) | 0) % 12 * 30,
        time: t + i * 5, newCombo: false, comboSkip: 0, hitSound: 0 });
    objs.push({ id: 462001, type: 'slider', x: 100, y: 100, time: t, newCombo: false, comboSkip: 0, hitSound: 0,
      curveType: 'B', curvePoints: [{ x: 200, y: 40 }, { x: 300, y: 100 }, { x: 200, y: 160 }], slides: 1, length: 320 });
    store.load({ ...base, hitObjects: objs }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(t + 5);
    store.clearSelection(); store.setSelectedNodes([]);
    store.select([462001]);
  })()`);
  await sleep(1500);

  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 200 });
  await send('Profiler.start');
  await evalJs(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const c = document.querySelector('canvas.cursor-crosshair');
    const p0 = window.__osuToClient(20, 20), p1 = window.__osuToClient(500, 360);
    c.dispatchEvent(new MouseEvent('mousedown', { clientX: p0.x, clientY: p0.y, button: 0, altKey: true, bubbles: true, cancelable: true }));
    await sleep(50);
    for (let i = 1; i <= 24; i++) {
      const px = p0.x + (p1.x - p0.x) * i / 24, py = p0.y + (p1.y - p0.y) * i / 24;
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: px, clientY: py, altKey: true, bubbles: true }));
      await sleep(33);
    }
    c.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
    await sleep(300);
  })()`);
  const stopRes = await send('Profiler.stop');
  const prof = stopRes.result?.profile;

  // 汇总自耗时: hitCount × interval → 按函数汇总
  const nodes = new Map(prof.nodes.map(n => [n.id, n]));
  const self = new Map();
  for (const n of prof.nodes) {
    if (!n.hitCount) continue;
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} @${f.url.split('/').pop()}:${f.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + n.hitCount * 200 / 1000);
  }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const total = [...self.values()].reduce((s, v) => s + v, 0);
  console.log(`采样总量 ≈${Math.round(total)}ms`);
  for (const [k, v] of top) console.log(`  ${Math.round(v)}ms  ${k}`);
  ws.close();
} finally {
  await killIsolated(electron, profile);
}
