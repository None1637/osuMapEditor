// v309 CDP 验证: (1) Alt 框选中途松开 Alt -> 逻辑切回物件框选; (2) 红锚点 Alt+单击整对取消;
// (3) 节点黄框内部按下拖拽 -> 整组拖动且可拖出 UI 区域。需 7100 dev server。
// 运行: node verifier/v309/probe-verify.mjs
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9439;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v309v-'));
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
// CDP modifiers: Alt=1, Ctrl=2, Meta=4, Shift=8
async function mouse(type, x, y, modifiers = 0) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0, modifiers });
}
async function key(type, modifiers) { // Alt 键按下/松开 (app 的 window keydown/keyup 监听 e.altKey)
  await send('Input.dispatchKeyEvent', { type, key: 'Alt', code: 'AltLeft', modifiers });
}

let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

try {
  await send('Runtime.enable');
  await send('Page.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false)) break;
    await sleep(500);
  }
  await evalJs(`(() => { const s = window.__osuStore; s.pause && s.pause(); s.tool = 'select'; })()`);

  // ---------- (1) Alt 框选中途松开 Alt ----------
  {
    const info = await evalJs(`(() => {
      const store = window.__osuStore;
      // 找一条头尾锚点 + 若干单点同屏的时刻
      const s = store.beatmap.hitObjects.find(o => o.type === 'slider' && (o.curvePoints ?? []).length >= 1);
      store.seek(s.time + 50);
      const tail = s.curvePoints[s.curvePoints.length - 1];
      const h = window.__osuToClient(s.x, s.y), t = window.__osuToClient(tail.x, tail.y);
      const x0 = Math.min(h.x, t.x) - 30, y0 = Math.min(h.y, t.y) - 30;
      const x1 = Math.max(h.x, t.x) + 30, y1 = Math.max(h.y, t.y) + 30;
      store.setSelectedNodes([]); store.clearSelection();
      return { id: s.id, x0, y0, x1, y1 };
    })()`);
    await sleep(300);
    await key('rawKeyDown', 1); // 按下 Alt
    await mouse('mousePressed', info.x0, info.y0, 1);
    await mouse('mouseMoved', info.x1, info.y1, 1); // 直接拉满框 (中点恰好在头部 y 上, 边界浮点会漏点)
    await sleep(120);
    const mid = await evalJs('({ nodes: window.__osuStore.nodeSelectionCount, sel: window.__osuStore.selected.size })');
    console.log('  Alt 按住框选中途:', JSON.stringify(mid));
    assert(mid.nodes >= 2, 'Alt 按住时 = 节点框选 (选中 >=2 锚点)');
    await key('keyUp', 0); // 松开 Alt (保持鼠标按下)
    await mouse('mouseMoved', info.x1 + 6, info.y1 + 6, 0); // 触发一次重算
    await sleep(120);
    await mouse('mouseReleased', info.x1 + 6, info.y1 + 6, 0);
    await sleep(200);
    const done = await evalJs('({ nodes: window.__osuStore.nodeSelectionCount, sel: window.__osuStore.selected.size })');
    console.log('  松开 Alt 收尾后:', JSON.stringify(done));
    assert(done.nodes === 0, '松开 Alt 后逻辑切回物件框选 (节点选区清空)');
    assert(done.sel >= 1, '松开 Alt 后物件被框选 (>=1)');
  }

  // ---------- (2) 红锚点 Alt+单击整对取消 ----------
  {
    await evalJs(`(() => {
      const store = window.__osuStore;
      store.setSelectedNodes([]); store.clearSelection();
      // 造一条带红锚点 (连续重复点) 的滑条
      store.addObject({ id: 900001, type: 'slider', x: 200, y: 150, time: store.currentTime,
        curveType: 'B', curvePoints: [{ x: 300, y: 150 }, { x: 300, y: 150 }, { x: 400, y: 200 }],
        slides: 1, length: 300, newCombo: false, comboSkip: 0, hitSound: 0 });
    })()`);
    await sleep(300);
    const pre = await evalJs(`(() => {
      const store = window.__osuStore;
      store.setSelectedNodes([[900001, 1], [900001, 2]]); // 红锚点重复对 (模拟 Alt 框选结果)
      const pt = window.__osuToClient(300, 150);
      return pt;
    })()`);
    await sleep(300);
    await key('rawKeyDown', 1);
    await mouse('mousePressed', pre.x, pre.y, 1);
    await mouse('mouseReleased', pre.x, pre.y, 1);
    await key('keyUp', 0);
    await sleep(200);
    const post = await evalJs('window.__osuStore.nodeSelectionCount');
    assert(post === 0, `红锚点 Alt+单击整对取消 (剩 ${post})`);
    await evalJs(`(() => { const store = window.__osuStore;
      store.beatmap.hitObjects = store.beatmap.hitObjects.filter(o => o.id !== 900001); store.emit(); })()`);
  }

  // ---------- (3) 黄框内部按下拖拽出 UI ----------
  {
    const info = await evalJs(`(() => {
      const store = window.__osuStore;
      store.setSelectedNodes([]); store.clearSelection();
      const s = store.beatmap.hitObjects.find(o => o.type === 'slider' && (o.curvePoints ?? []).length >= 1);
      store.seek(s.time + 50);
      const lastIdx = (s.curvePoints ?? []).length;
      store.setSelectedNodes([[s.id, 0], [s.id, lastIdx]]);
      const tail = s.curvePoints[s.curvePoints.length - 1];
      const h = window.__osuToClient(s.x, s.y), t = window.__osuToClient(tail.x, tail.y);
      const rect = document.querySelector('canvas').getBoundingClientRect();
      return { id: s.id, mid: { x: (h.x + t.x) / 2, y: (h.y + t.y) / 2 }, bottom: rect.bottom, y0: s.y };
    })()`);
    await sleep(400);
    const target = info.bottom + 120;
    const dyTotal = target - info.mid.y;
    await mouse('mousePressed', info.mid.x, info.mid.y, 0);
    await sleep(150);
    for (let i = 1; i <= 4; i++) {
      await mouse('mouseMoved', info.mid.x, info.mid.y + dyTotal * i / 4, 0);
      await sleep(120);
    }
    await mouse('mouseReleased', info.mid.x, target, 0);
    await sleep(200);
    const post = await evalJs(`(() => {
      const store = window.__osuStore;
      const s = store.beatmap.hitObjects.find(o => o.id === ${info.id});
      return { y: s.y, nodes: store.nodeSelectionCount, sel: store.selected.size };
    })()`);
    console.log('  黄框内拖出 UI 后:', JSON.stringify(post), `(起点 y=${info.y0}, 画布底=${Math.round(info.bottom)})`);
    assert(post.nodes === 2, '黄框内部按下不再清节点选区');
    assert(post.sel === 0, '不再转成物件选中');
    assert(post.y > 384, `整组拖出游玩区底边 (y=${post.y} > 384, 不被钳制/中断)`);
  }
} finally {
  try { edge.kill(); } catch { }
  await sleep(1200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
}
console.log(failures ? `\nV309_PROBE_FAILED: ${failures}` : '\nV309_PROBE_OK');
process.exit(failures ? 1 : 0);
