// CDP 框选 + 多选变换端到端: 真实浏览器驱动鼠标框选 -> 旋转变换 -> undo 还原
// 运行: node verifier/v17/cdp-transform.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9338;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-transform-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      const page = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
      if (page) return page;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('Edge CDP 未就绪');
}

const target = await getTarget();
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
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

// osu 坐标 -> client 坐标 (v28 起直接用 app 暴露的 __osuToClient, 与渲染同一变换)
const HELPERS = `
  window.__osu2client = (px, py) => window.__osuToClient(px, py);
  window.__fire = (type, px, py, opts = {}) => {
    const c = document.querySelector('canvas.cursor-crosshair');
    const p = window.__osu2client(px, py);
    c.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, button: 0, shiftKey: !!opts.shift, ...opts }));
  };
`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3500);
  await evalJs(HELPERS + `'ok'`);

  // ---- 1. 框选: 从 (0,0) 拖到 (300,384), 应选中左半区全部物件 (不限时间) ----
  const expected = await evalJs(`(async () => { const m = await import('/src/osu/transform.ts'); return JSON.stringify(m.objectsInRect(window.__osuStore.beatmap.hitObjects, { minX: 0, minY: 0, maxX: 300, maxY: 384 })); })()`);
  await evalJs(`window.__fire('mousedown', 2, 2)`);
  for (let i = 1; i <= 5; i++) await evalJs(`window.__fire('mousemove', ${2 + i * 60}, ${2 + i * 76})`);
  await evalJs(`window.__fire('mouseup', 300, 382)`);
  await sleep(200);
  const got = await evalJs(`JSON.stringify([...window.__osuStore.selected].sort((a,b)=>a-b))`);
  const exp = JSON.stringify(JSON.parse(expected).sort((a, b) => a - b));
  assert(got === exp && JSON.parse(got).length >= 2, `框选命中 ${JSON.parse(got).length} 个物件, 与 objectsInRect 一致`);

  // ---- 2. Shift 追加框选: 右下角区域 (起点 (500,380) 远离任何可见物件, 框住 (384,288)) ----
  const before = JSON.parse(got).length;
  await evalJs(`window.__fire('mousedown', 500, 380, { shift: true })`);
  await evalJs(`window.__fire('mousemove', 440, 330, { shift: true })`);
  await evalJs(`window.__fire('mousemove', 380, 285, { shift: true })`);
  await evalJs(`window.__fire('mouseup', 380, 285, { shift: true })`);
  await sleep(200);
  const after = await evalJs(`window.__osuStore.selected.size`);
  assert(after > before, `Shift 框选追加后选区 ${before} -> ${after}`);

  // ---- 3. 多选旋转 + undo 还原 ----
  const snap = await evalJs(`JSON.stringify(window.__osuStore.beatmap.hitObjects.filter(o => window.__osuStore.selected.has(o.id)).map(o => ({ id: o.id, type: o.type, x: o.x, y: o.y, cp: o.curvePoints })))`);
  await evalJs(`window.__osuStore.rotateSelected(90)`);
  await sleep(150);
  const rotated = await evalJs(`JSON.stringify(window.__osuStore.beatmap.hitObjects.filter(o => window.__osuStore.selected.has(o.id)).map(o => ({ id: o.id, type: o.type, x: o.x, y: o.y, cp: o.curvePoints })))`);
  const a = JSON.parse(snap), b = JSON.parse(rotated);
  const moved = a.filter((o, i) => o.x !== b[i].x || o.y !== b[i].y).length;
  const spinners = a.filter(o => o.type === 'spinner').length;
  // 转盘位置固定不变换, 另留 1 个可能恰在旋转中心的物件的余量
  assert(moved >= a.length - spinners - 1, `旋转后 ${moved}/${a.length} 个物件坐标变化 (转盘 ${spinners} 个不参与)`);
  const sliderA = a.find(o => o.cp && o.cp.length);
  if (sliderA) {
    const sliderB = b.find(o => o.id === sliderA.id);
    const cpMoved = sliderA.cp.some((p, i) => p.x !== sliderB.cp[i].x || p.y !== sliderB.cp[i].y);
    assert(cpMoved, '滑条控制点随选区整体旋转 (不变形)');
  }
  await evalJs(`window.__osuStore.undo()`);
  await sleep(150);
  const restored = await evalJs(`JSON.stringify(window.__osuStore.beatmap.hitObjects.filter(o => window.__osuStore.selected.has(o.id) || ${snap}.some(s => s.id === o.id)).map(o => ({ id: o.id, x: o.x, y: o.y, cp: o.curvePoints })))`);
  const c = JSON.parse(restored);
  const allBack = a.every(o => { const r = c.find(x => x.id === o.id); return r && r.x === o.x && r.y === o.y; });
  assert(allBack, 'undo 完整还原选区坐标');

  // ---- 4. 镜像/缩放不报错且有效果 ----
  await evalJs(`window.__osuStore.flipSelected('h'); window.__osuStore.scaleSelected(1.1);`);
  await sleep(150);
  assert(exceptions.length === 0, '镜像/缩放执行无异常');

  // ---- 5. 点击空白 (无拖动) 清空选区 ----
  await evalJs(`window.__fire('mousedown', 511, 5)`);
  await evalJs(`window.__fire('mouseup', 511, 5)`);
  await sleep(150);
  const cleared = await evalJs(`window.__osuStore.selected.size`);
  assert(cleared === 0, '点击空白清空选区');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');

  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v17-transform.json'), JSON.stringify({ selected: JSON.parse(got), snap: a, rotated: b }, null, 2));
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V17_CDP_TRANSFORM_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V17_CDP_TRANSFORM_PASSED');
