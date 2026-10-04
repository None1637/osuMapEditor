// v313 CDP 复现: 节点包围框拉伸手柄 (bc) 向下拖到 UI 下方 (画布底 +120px), 验证缩放跟随且节点可出游玩区。
// 需 7100 dev server。运行: node verifier/v313/probe-nodescale.mjs
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9445;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v313-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--autoplay-policy=no-user-gesture-required', APP_URL,
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
  } catch { }
  if (!target) await sleep(500);
}
if (!target) { console.error('EDGE_CONNECT_FAILED'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
async function mouse(type, x, y) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0 });
}

let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

try {
  await send('Runtime.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false)) break;
    await sleep(500);
  }
  await evalJs(`(() => { const s = window.__osuStore; s.pause && s.pause(); s.tool = 'select'; })()`);

  const info = await evalJs(`(() => {
    const store = window.__osuStore;
    store.setSelectedNodes([]); store.clearSelection();
    // 造一条竖向滑条 (节点盒高 > 0, bc 手柄可用), 位置靠近游玩区底部便于向下拉
    store.addObject({ id: 900002, type: 'slider', x: 256, y: 150, time: store.currentTime,
      curveType: 'B', curvePoints: [{ x: 306, y: 220 }, { x: 256, y: 290 }],
      slides: 1, length: 300, newCombo: false, comboSkip: 0, hitSound: 0 });
    store.setSelectedNodes([[900002, 0], [900002, 2]]);
    // nodeBounds pad=8: q = 点集盒, dq 外扩 8; bc 手柄 = (dq 水平中点, dq 底)
    const xs = [256, 256], ys = [150, 290];
    const minX = Math.min(...xs) - 8, maxX = Math.max(...xs) + 8, minY = Math.min(...ys) - 8, maxY = Math.max(...ys) + 8;
    const bcOsu = { x: (minX + maxX) / 2, y: maxY };
    const bc = window.__osuToClient(bcOsu.x, bcOsu.y);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return { bc, canvasBottom: rect.bottom, headY: 150, tailY: 290 };
  })()`);
  await sleep(400);
  console.log('  bc 手柄 client:', JSON.stringify(info.bc), '画布底:', Math.round(info.canvasBottom));

  const targetY = info.canvasBottom + 120; // UI (下时间轴) 下方 120px
  await mouse('mousePressed', info.bc.x, info.bc.y);
  await evalJs(`window.__mvlog = []; window.addEventListener('mousemove', e => window.__mvlog.push([Math.round(e.clientX), Math.round(e.clientY), (e.target && e.target.tagName) || '?']), true);`);
  await sleep(150);
  for (let i = 1; i <= 5; i++) {
    await mouse('mouseMoved', info.bc.x, info.bc.y + (targetY - info.bc.y) * i / 5);
    await sleep(120);
  }
  const mvlog = await evalJs('window.__mvlog');
  console.log('  mousemove 事件记录:', JSON.stringify(mvlog));
  const mid = await evalJs(`(() => {
    const o = window.__osuStore.beatmap.hitObjects.find(x => x.id === 900002);
    return { headY: o.y, tailY: o.curvePoints[1].y };
  })()`);
  console.log('  拖到 UI 下方中途:', JSON.stringify(mid));
  await mouse('mouseReleased', info.bc.x, targetY);
  await sleep(200);
  const post = await evalJs(`(() => {
    const o = window.__osuStore.beatmap.hitObjects.find(x => x.id === 900002);
    return { headY: o.y, tailY: o.curvePoints[1].y, nodes: window.__osuStore.nodeSelectionCount };
  })()`);
  console.log('  松开后:', JSON.stringify(post));
  // 原点 = bc 对侧 (顶边中点 y=142), 拖 bc 到远超底边 → 尾点应远超 384
  assert(post.tailY > 384, `拉伸到 UI 下方 — 尾点 y=${post.tailY} > 384 (缩放不被中断/钳制)`);
  assert(post.tailY > 450, `缩放跟随到画布底+120px 全程 (尾点 y=${post.tailY}; 按全程位移换算期望 ≈481)`);
  await evalJs(`(() => { const store = window.__osuStore;
    store.beatmap.hitObjects = store.beatmap.hitObjects.filter(o => o.id !== 900002);
    store.setSelectedNodes([]); store.emit(); })()`);
} finally {
  try { edge.kill(); } catch { }
}
console.log(failures ? `\nV313_PROBE_FAILED: ${failures}` : '\nV313_PROBE_PASSED');
process.exit(failures ? 1 : 0);
