// CDP check v343 (Electron / production): Alt+Shift 节点框选 = toggle (对称差)
//   修复前 (v317): 纯减选 — 框到已选锚点取消, 框到未选锚点不加入 (「变成橡皮擦了只能减少不能增加」)
//   修复后: 框内已选剔除 + 框内未选加入; 连续两次同框 = 还原 (toggle 往返)
// 运行: npm run build 后 node verifier/v343/check.mjs  (会短暂弹出编辑器窗口)
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9443;
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
// modifiers: Alt=1, Shift=8
const mouse = (type, x, y, mod = 0) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0,
  buttons: type === 'mouseReleased' ? 0 : 1, modifiers: mod,
});

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)').catch(() => false);
  }
  if (!ready) throw new Error('Electron 应用未就绪');

  // 单滑条 4 节点 (头+3 控制点), 横向排开
  await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const ts = base.hitObjects.find(o => o.type === 'slider');
    const red = base.timingPoints.find(p => p.uninherited);
    const slider = { ...ts, id: 434343, time: 5000, x: 100, y: 192,
      curvePoints: [{ x: 200, y: 192 }, { x: 300, y: 192 }, { x: 400, y: 192 }], curveType: 'B', slides: 1, length: 400 };
    store.load({ ...base, hitObjects: [slider], timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.pause && store.pause();
    store.tool = 'select';
    store.select([]); store.setSelectedNodes([]);
    store.seek(5000);
  })()`);
  await sleep(400);

  const toPage = (ox, oy) => evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(${ox}, ${oy}); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  const sel = () => evalJs(`JSON.stringify([...window.__osuStore.selectedNodes.entries()].map(([k, v]) => [k, [...v].sort()]))`);

  // 预选节点 idx=1 (200,192)
  await evalJs('window.__osuStore.setSelectedNodes([[434343, 1]])');
  // Alt+Shift 框选覆盖 idx=1 与 idx=2 (矩形 x150..350, y140..240)
  const p0 = await toPage(150, 140), p1 = await toPage(350, 240);
  await mouse('mousePressed', p0.x, p0.y, 9);
  await mouse('mouseMoved', p1.x, p1.y, 9);
  await sleep(250);
  await mouse('mouseReleased', p1.x, p1.y, 9);
  await sleep(250);
  const s1 = JSON.parse(await sel());
  console.log('  toggle 后选区:', JSON.stringify(s1));
  const e1 = s1.find(([k]) => k === 434343)?.[1] ?? [];
  assert(!e1.includes(1), '框内已选节点 idx=1 → 剔除');
  assert(e1.includes(2), '框内未选节点 idx=2 → 加入');
  assert(!e1.includes(0) && !e1.includes(3), '框外节点不受影响');

  // 同框再来一次 → toggle 往返还原 (idx=1 回来, idx=2 去掉)
  await mouse('mousePressed', p0.x, p0.y, 9);
  await mouse('mouseMoved', p1.x, p1.y, 9);
  await sleep(250);
  await mouse('mouseReleased', p1.x, p1.y, 9);
  await sleep(250);
  const s2 = JSON.parse(await sel());
  console.log('  二次 toggle 后选区:', JSON.stringify(s2));
  const e2 = s2.find(([k]) => k === 434343)?.[1] ?? [];
  assert(e2.includes(1) && !e2.includes(2), '二次同框 toggle 还原 (idx=1 回来, idx=2 剔除)');

  if (exceptions.length) { failures++; console.error('  FAIL: 页面异常:', exceptions.slice(0, 3)); }
} finally {
  electron.kill();
}
console.log(failures ? `\n${failures} 个断言失败` : '\ncheck v343 全部通过');
process.exit(failures ? 1 : 0);
