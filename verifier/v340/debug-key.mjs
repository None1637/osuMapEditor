// v340 调试: 密集场景拖滑条时静态层键为何逐帧漂移
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9436;
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

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)').catch(() => false);
  }
  if (!ready) throw new Error('未就绪');
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
  const head = await evalJs(`(() => {
    const s = window.__osuStore;
    const sl = s.beatmap.hitObjects.find(o => o.type === 'slider');
    const r = document.querySelector('canvas').getBoundingClientRect();
    const p = window.__osuToCanvas(sl.x, sl.y);
    return { x: r.left + p.x, y: r.top + p.y };
  })()`);
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0, buttons: type === 'mouseReleased' ? 0 : 1,
  });
  // 物件框选 wiggle (复现 D1)
  const toPage = (ox, oy) => evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(${ox}, ${oy}); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  const pEmpty = await toPage(20, 20), pAll = await toPage(448, 320), pMid = await toPage(256, 192);
  await mouse('mousePressed', pEmpty.x, pEmpty.y);
  await mouse('mouseMoved', pAll.x, pAll.y);
  for (let i = 0; i < 30; i++) {
    const f = (i % 20) / 10, k = f <= 1 ? f : 2 - f;
    await mouse('mouseMoved', pAll.x + (pMid.x - pAll.x) * k, pAll.y + (pMid.y - pAll.y) * k);
    await sleep(16);
  }
  await mouse('mouseReleased', pMid.x, pMid.y);
  const dbg = await evalJs('JSON.stringify(window.__sceneDbg)');
  const st = await evalJs('JSON.stringify({ playing: window.__osuStore.playing, time: window.__osuStore.currentTime, sel: window.__osuStore.selected.size })');
  console.log('dbg:', dbg);
  console.log('state:', st);
} finally {
  electron.kill();
}
process.exit(0);
