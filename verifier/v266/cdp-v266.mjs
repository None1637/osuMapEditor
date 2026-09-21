// CDP v265/v266 端到端: Alt 节点交互新模型
//   1) Alt+框选 = 只选滑条点, 物件选区保持为空 (v265; 覆盖框内 circle 也不选)
//   2) 普通拖拽已选节点 = 整个框选组同步移动 (v266)
//   3) Alt+点击已选节点 = 取消该节点 (其余保留); 再 Alt+点击 = 重新加选 (v266)
// 运行: node verifier/v266/cdp-v266.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9437;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v266-'));
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

// 页面工具: 派发鼠标事件 (alt 可选) / osu 坐标 -> client / 读取节点选区与物件选区
const HELPERS = `
  const cv = document.querySelector('canvas.cursor-crosshair');
  const ev = (type, cx, cy, alt) => cv.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
    clientX: cx, clientY: cy, altKey: !!alt }));
  const cl = (x, y) => window.__osuToClient(x, y);
  const selInfo = () => {
    const s = window.__osuStore;
    return { objs: s.selected.size, nodes: [...s.selectedNodes.entries()].map(([k, v]) => [k, [...v]]) };
  };
`;

try {
  await send('Runtime.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false)) break;
    await sleep(500);
  }
  await sleep(500);

  // 注入测试谱面: 两条滑条 (各 3 控制点) + 一个单点, 同刻可见
  const setup = await evalJs(`(() => {
    const store = window.__osuStore;
    store.pause && store.pause();
    const base = store.beatmap;
    const ts = base.hitObjects.find(o => o.type === 'slider');
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const red = base.timingPoints.find(p => p.uninherited);
    const s1 = { ...ts, id: 900001, time: 5000, x: 150, y: 150,
      curvePoints: [{ x: 210, y: 150 }, { x: 260, y: 200 }], curveType: 'B', slides: 1, length: 180, endTime: 5280 };
    const s2 = { ...ts, id: 900002, time: 5000, x: 300, y: 300,
      curvePoints: [{ x: 360, y: 300 }, { x: 410, y: 350 }], curveType: 'B', slides: 1, length: 180, endTime: 5280 };
    const c1 = { ...tc, id: 900003, time: 5000, x: 256, y: 250, endTime: 5000 }; // 框内单点, 验证不被选
    store.load({ ...base, hitObjects: [s1, s2, c1], timingPoints: [red] }, store.audioUrl);
    store.tool = 'select';
    store.seek(4950);
    store.selected.clear(); store.selectedNodes.clear(); store.emitSelection();
    return { ok: true, gridSnap: store.gridSnap };
  })()`);
  assert(setup?.ok, '注入测试谱面 (2 滑条 + 1 单点)');
  console.log('  gridSnap:', setup.gridSnap);
  await sleep(600);

  // 1) Alt+框选整个游玩区中部 (覆盖两滑条全部控制点 + 单点)
  const marq = await evalJs(`(() => { ${HELPERS}
    const a = cl(100, 100), b = cl(460, 380);
    ev('mousedown', a.x, a.y, true);
    ev('mousemove', (a.x + b.x) / 2, (a.y + b.y) / 2, true);
    ev('mousemove', b.x, b.y, true);
    ev('mouseup', b.x, b.y, true);
    return selInfo();
  })()`);
  console.log('  Alt框选后:', JSON.stringify(marq));
  assert(marq.nodes.length === 2, `Alt框选选中两条滑条的节点 (${marq.nodes.length} 条滑条)`);
  const totalNodes = marq.nodes.reduce((n, [, idxs]) => n + idxs.length, 0);
  assert(totalNodes === 6, `共 6 个节点 (3+3, 实际 ${totalNodes})`);
  assert(marq.objs === 0, `v265: 物件选区为空 (忽略 hit circle/slider, 实际 ${marq.objs})`);
  await sleep(300);

  // 2) 普通 (无 Alt) 拖拽 s1 的头部节点 (150,150) — 整组应同步移动
  const drag = await evalJs(`(() => { ${HELPERS}
    const store = window.__osuStore;
    const before = new Map(store.beatmap.hitObjects.map(o => [o.id, { x: o.x, y: o.y, cp: (o.curvePoints ?? []).map(p => ({ ...p })) }]));
    const p0 = cl(150, 150);
    ev('mousedown', p0.x, p0.y, false);
    for (let i = 1; i <= 6; i++) ev('mousemove', p0.x + i * 10, p0.y + i * 8, false);
    ev('mouseup', p0.x + 60, p0.y + 48, false);
    const after = new Map(store.beatmap.hitObjects.map(o => [o.id, { x: o.x, y: o.y, cp: (o.curvePoints ?? []).map(p => ({ ...p })) }]));
    const d1 = { dx: after.get(900001).x - before.get(900001).x, dy: after.get(900001).y - before.get(900001).y };
    const d2 = { dx: after.get(900002).x - before.get(900002).x, dy: after.get(900002).y - before.get(900002).y };
    const d2cp = { dx: after.get(900002).cp[1].x - before.get(900002).cp[1].x, dy: after.get(900002).cp[1].y - before.get(900002).cp[1].y };
    const dc = { dx: after.get(900003).x - before.get(900003).x, dy: after.get(900003).y - before.get(900003).y };
    return { d1, d2, d2cp, dc, sel: selInfo() };
  })()`);
  console.log('  整组拖动:', JSON.stringify(drag));
  assert(Math.abs(drag.d1.dx) + Math.abs(drag.d1.dy) > 10, `v266: 锚节点所在滑条移动了 (${drag.d1.dx},${drag.d1.dy})`);
  assert(drag.d2.dx === drag.d1.dx && drag.d2.dy === drag.d1.dy, `v266: 另一滑条头同步同 delta (${drag.d2.dx},${drag.d2.dy})`);
  assert(drag.d2cp.dx === drag.d1.dx && drag.d2cp.dy === drag.d1.dy, `v266: 另一滑条尾点同步同 delta (${drag.d2cp.dx},${drag.d2cp.dy})`);
  assert(drag.dc.dx === 0 && drag.dc.dy === 0, '未选中的单点不动');
  await sleep(300);

  // 3) Alt+点击 s2 头 (已随组移动) = 取消该节点; 其余节点保留
  const tog = await evalJs(`(() => { ${HELPERS}
    const store = window.__osuStore;
    const s2 = store.beatmap.hitObjects.find(o => o.id === 900002);
    const p = cl(s2.x, s2.y);
    ev('mousedown', p.x, p.y, true);
    ev('mouseup', p.x, p.y, true);
    return selInfo();
  })()`);
  console.log('  Alt点击取消后:', JSON.stringify(tog));
  const s2nodes = tog.nodes.find(([id]) => id === 900002)?.[1] ?? [];
  assert(!s2nodes.includes(0), 'v266: Alt+点击取消已选节点 (s2 头移除)');
  assert(tog.nodes.length === 2 && tog.nodes.find(([id]) => id === 900001)?.[1].length === 3, '其余节点保留 (s1 整组 3 个)');
  assert(tog.objs === 0, '物件选区仍为空');

  // 再 Alt+点击同一点 = 重新加选
  const tog2 = await evalJs(`(() => { ${HELPERS}
    const store = window.__osuStore;
    const s2 = store.beatmap.hitObjects.find(o => o.id === 900002);
    const p = cl(s2.x, s2.y);
    ev('mousedown', p.x, p.y, true);
    ev('mouseup', p.x, p.y, true);
    return selInfo();
  })()`);
  assert((tog2.nodes.find(([id]) => id === 900002)?.[1] ?? []).includes(0), 'v266: 再 Alt+点击重新加选');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(1200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 残留临时目录无害 */ }
}
if (failures) { console.error(`\nV266_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV266_CDP_PASSED');
