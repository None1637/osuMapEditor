// CDP v250 端到端: 多选拖动时选中标记 (装饰层) 跟随物件
// 回归背景: v245 选中装饰层缓存键 = dataVersion, 拖动中原地改坐标只走 emitSelection (bump version,
// 不 bump dataVersion) → 装饰层/选中框停在原位。修复: 键改用 getVersion。
// 步骤: 选两个孤立单点 → 拖 (+100,+70) → 新头位置必须有亮色选中装饰, 旧位置必须没有。
// 运行: node verifier/v250/cdp-v250.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9435;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v250-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
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
// 页面内像素探针: dev px 处 7x7 邻域亮色像素数 (选中装饰 hitcircleselect 白环/辉光)
const PROBE = `
  const cv = document.querySelector('canvas');
  const g = cv.getContext('2d');
  const probe = (x, y) => {
    const d = g.getImageData(Math.round(x) - 3, Math.round(y) - 3, 7, 7).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) bright++;
    return bright;
  };
`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient && window.__osuToCanvas)').catch(() => false)) break;
    await sleep(500);
  }
  await sleep(500);

  // 选一对时间上接近 (同框可见)、空间上孤立 (新旧位置 90 osu px 内无其他物件) 的单点
  const setup = await evalJs(`(() => {
    const store = window.__osuStore;
    store.pause && store.pause();
    const bm = store.beatmap;
    const cs = bm.hitObjects.filter(o => o.type === 'circle');
    let best = null;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      if (Math.abs(a.time - b.time) > 400) continue;
      const pts = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x + 100, y: a.y + 70 }, { x: b.x + 100, y: b.y + 70 }];
      let iso = true;
      for (const o of bm.hitObjects) {
        if (o === a || o === b) continue;
        if (Math.abs(o.time - a.time) > 1200) continue;
        for (const p of pts) if (Math.hypot(o.x - p.x, o.y - p.y) < 90) { iso = false; break; }
        if (!iso) break;
      }
      if (iso) { best = [a, b]; break; }
    }
    if (!best) return null;
    const [a, b] = best;
    store.seek(a.time - 50);
    store.selected = new Set([a.id, b.id]);
    store.emitSelection();
    return { a: { id: a.id, x: a.x, y: a.y }, b: { id: b.id, x: b.x, y: b.y } };
  })()`);
  assert(setup !== null, '找到孤立单点对并选中');
  if (!setup) throw new Error('无合适物件对');
  console.log('  选中:', JSON.stringify(setup));
  await sleep(500);

  const before = await evalJs(`(() => { ${PROBE}
    const pt = window.__osuToCanvas(${setup.a.x}, ${setup.a.y});
    return { decorAtHead: probe(pt.x, pt.y) }; })()`);
  assert(before.decorAtHead > 0, `拖动前头部有选中装饰 (亮像素 ${before.decorAtHead})`);

  console.log('== 拖动 (+100,+70 视觉 px)');
  // 与 v26 同款: 直接向 canvas 派发 MouseEvent (CDP Input.dispatchMouseEvent 在此场景不触发 canvas 拖拽)
  const moved = await evalJs(`(() => {
    const c = document.querySelector('canvas.cursor-crosshair');
    const ev = (type, cx, cy, btn) => c.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: btn || 0, clientX: cx, clientY: cy }));
    const p0 = window.__osuToClient(${setup.a.x}, ${setup.a.y});
    ev('mousedown', p0.x, p0.y, 0);
    ev('mousemove', p0.x + 50, p0.y + 35, 0);
    ev('mousemove', p0.x + 100, p0.y + 70, 0);
    ev('mouseup', p0.x + 100, p0.y + 70, 0);
    const a = window.__osuStore.beatmap.hitObjects.find(o => o.id === ${setup.a.id});
    return { x: a.x, y: a.y, canvasDraggingEnded: !window.__osuStore.canvasDragging };
  })()`);
  await sleep(500);
  const adx = moved.x - setup.a.x, ady = moved.y - setup.a.y;
  assert(Math.abs(adx) + Math.abs(ady) > 10, `物件确实移动了 (${adx},${ady})`);

  const after = await evalJs(`(() => { ${PROBE}
    const oldPt = window.__osuToCanvas(${setup.a.x}, ${setup.a.y});
    const newPt = window.__osuToCanvas(${moved.x}, ${moved.y});
    return { atOld: probe(oldPt.x, oldPt.y), atNew: probe(newPt.x, newPt.y) }; })()`);
  console.log('  装饰探针:', JSON.stringify(after));
  assert(after.atNew > 0, `新位置有选中装饰 (亮像素 ${after.atNew}) — 装饰层跟随拖动`);
  assert(after.atOld === 0, `旧位置无残留装饰 (亮像素 ${after.atOld})`);
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(1200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 残留临时目录无害 */ }
}
if (failures) { console.error(`\nVERIFIER_V250_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V250_CDP_PASSED');
