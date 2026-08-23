// CDP v26 端到端: 拖拽/插入/删除滑条节点后长度自动重算并吸附节拍
// 演示谱面: 红线 1000ms/500ms, SliderMultiplier 1.4 -> vel 0.28px/ms, 每拍 140px, beatDivisor 4 -> tick 35px
// 造 L 滑条 (100,100)->(300,100) 几何 200px:
//   1) 拖尾节点 (300,100)->(280,100): 几何 180 -> 吸附 5tick=175 (length 200->175)
//   2) undo 还原 length=200
//   3) 点击线段中点插入节点: 几何仍 200 -> SnapTo 吸附 175 (lazer 插入后无条件 SnapTo)
//   4) undo 还原
//   5) 插入后右键删回: 几何 200 -> length 175
//   6) 点击尾节点切红: 几何不变 (200 >= 175) -> 保留 length 175 (lazer 条件分支)
// 运行: node verifier/v26/cdp-snap.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9350;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v26-'));
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

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3500);

  await evalJs(`
    const s = window.__osuStore;
    const bm = s.beatmap;
    bm.hitObjects = [{
      id: 92001, type: 'slider', x: 100, y: 100, time: 5000, hitSound: 0, newCombo: true, comboSkip: 0,
      curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200,
    }];
    s.select([92001]);
    s.seek(4800);
    window.__ev = (type, ox, oy, btn) => {
      const c = document.querySelector('canvas.cursor-crosshair');
      const p = window.__osuToClient(ox, oy); // v28: 与渲染同一变换 (含 PAD_Y 留白)
      c.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, button: btn || 0,
        clientX: p.x, clientY: p.y,
      }));
    };
    window.__click = (x, y) => { window.__ev('mousedown', x, y, 0); window.__ev('mouseup', x, y, 0); };
    window.__rclick = (x, y) => { window.__ev('contextmenu', x, y, 2); };
    window.__drag = (x0, y0, x1, y1) => {
      window.__ev('mousedown', x0, y0, 0);
      window.__ev('mousemove', (x0 + x1) / 2, (y0 + y1) / 2, 0);
      window.__ev('mousemove', x1, y1, 0);
      window.__ev('mouseup', x1, y1, 0);
    };
    window.__len = () => window.__osuStore.beatmap.hitObjects[0].length;
    window.__cps = () => JSON.stringify(window.__osuStore.beatmap.hitObjects[0].curvePoints.map(p => [p.x, p.y]));
    'ok'
  `);
  await sleep(500);

  // 1) 拖尾节点 (300,100)->(280,100): 几何 180 -> 5 tick = 175
  await evalJs(`window.__drag(300, 100, 280, 100); 'ok'`);
  assert(await evalJs('window.__len()') === 175, `拖节点后长度 200->175 (几何 180 吸附 5 tick; 实际 ${await evalJs('window.__len()')})`);
  let cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps[0][0] === 280, `节点已拖到 (280,100) (实际 ${JSON.stringify(cps[0])})`);

  // 2) undo 还原
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  assert(await evalJs('window.__len()') === 200, `undo 还原 length=200 (实际 ${await evalJs('window.__len()')})`);

  // 3) 点击线段中点 (200,100) 插入节点: 几何仍 200, SnapTo 吸附 -> 175
  await evalJs(`window.__click(200, 100); 'ok'`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 2 && cps[0][0] === 200, `插入节点成功 (实际 ${JSON.stringify(cps)})`);
  assert(await evalJs('window.__len()') === 175, `插入后 length 200->175 (几何 200 吸附; 实际 ${await evalJs('window.__len()')})`);

  // 4) undo 还原插入
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  assert(await evalJs('window.__len()') === 200 && JSON.parse(await evalJs('window.__cps()')).length === 1, 'undo 还原插入 (length=200, 单曲线点)');

  // 5) 再插入 -> 右键删回: length 保持吸附值 175
  await evalJs(`window.__click(200, 100); 'ok'`);
  await evalJs(`window.__rclick(200, 100); 'ok'`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 1, `右键删除插入的节点 (实际 ${JSON.stringify(cps)})`);
  assert(await evalJs('window.__len()') === 175, `删除后 length=175 (实际 ${await evalJs('window.__len()')})`);

  // 6) 点击尾节点 (300,100) 无拖拽 -> 切红: 几何 200 不变 >= 175 -> 保留 175
  await evalJs(`window.__click(300, 100); 'ok'`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 2 && cps[0][0] === 300 && cps[1][0] === 300, `切红形成重复对 (实际 ${JSON.stringify(cps)})`);
  assert(await evalJs('window.__len()') === 175, `切红后保留 length=175 (实际 ${await evalJs('window.__len()')})`);
  assert(await evalJs(`window.__osuStore.beatmap.hitObjects[0].curveType`) === 'B', '切红后 curveType=B');

  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v26-snap.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  截图: verifier/runs/v26-snap.png');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V26_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V26_CDP_PASSED');
