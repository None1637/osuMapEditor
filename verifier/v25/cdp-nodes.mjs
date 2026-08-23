// CDP v25 端到端: 已建滑条节点编辑 (插入 / 点击切红 / 右键删除与转白 / undo 还原)
// 造一个 4 控制点滑条 -> 选中 -> 模拟真实鼠标事件:
//   1) 点击连接线段中点插入节点 (curvePoints +1 且位置正确)
//   2) 点击新节点手柄 (无拖拽) 切红 (出现连续重复坐标对, curveType=B)
//   3) 右键红节点 -> 合并转白 (v29 起); 右键头部不可删; 右键普通点删除
//   4) 逐步 undo 全部还原
// 运行: node verifier/v25/cdp-nodes.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9349;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v25-'));
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

  // 造单个 4 控制点滑条并选中; 页面内注册 osu 坐标 -> 鼠标事件助手
  await evalJs(`
    const s = window.__osuStore;
    const bm = s.beatmap;
    bm.hitObjects = [{
      id: 92001, type: 'slider', x: 100, y: 100, time: 5000, hitSound: 0, newCombo: true, comboSkip: 0,
      curveType: 'B', curvePoints: [{ x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }], slides: 1, length: 600,
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
    window.__cps = () => JSON.stringify(window.__osuStore.beatmap.hitObjects[0].curvePoints.map(p => [p.x, p.y]));
    window.__ctype = () => window.__osuStore.beatmap.hitObjects[0].curveType;
    'ok'
  `);
  await sleep(500);

  // 1) 点击连接线段 (头->第2点) 中点 (200,100) 插入节点
  await evalJs(`window.__click(200, 100); 'ok'`);
  let cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 4, `插入后 curvePoints 3->4 (实际 ${cps.length})`);
  assert(cps[0][0] === 200 && cps[0][1] === 100, `新节点插在线段中点 (200,100) 的正确下标 (实际 ${JSON.stringify(cps[0])})`);
  assert(await evalJs('window.__osuStore.selected.has(92001)'), '插入后滑条保持选中');

  // 2) 点击新节点手柄 (无拖拽) -> 切红: 出现连续重复坐标对
  await evalJs(`window.__click(200, 100); 'ok'`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 5, `切红后 curvePoints 4->5 (实际 ${cps.length})`);
  assert(cps[0][0] === 200 && cps[1][0] === 200 && cps[0][1] === 100 && cps[1][1] === 100, '白->红: 形成 (200,100) 连续重复对');
  assert(await evalJs('window.__ctype()') === 'B', '红点后 curveType=B');
  await sleep(400);

  // 截图: 红色节点手柄 + 新插入节点可见
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v25-nodes.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  截图: verifier/runs/v25-nodes.png');

  // 3a) 右键红节点 (200,100) -> 重复对合并为一个白点 (v29 起: 红->白改用右键, 不再成对删除)
  await evalJs(`window.__rclick(200, 100); 'ok'`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 4, `红点对合并转白: curvePoints 5->4 (实际 ${cps.length})`);
  assert(cps[0][0] === 200 && cps[0][1] === 100 && cps[1][0] === 300, '合并后保留 (200,100) 单个白点');
  assert(!(cps[0][0] === cps[1][0] && cps[0][1] === cps[1][1]), '重复对已消除 (转为白点)');

  // 3b) 右键头部 (100,100) -> 不可删
  await evalJs(`window.__rclick(100, 100); 'ok'`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 4, '头部右键不可删 (curvePoints 仍 4)');

  // 3c) 右键普通节点 (300,300) -> 删除
  await evalJs(`window.__rclick(300, 300); 'ok'`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 3 && cps[0][0] === 200 && cps[1][0] === 300 && cps[2][0] === 100, `普通点删除: curvePoints 4->3 (实际 ${JSON.stringify(cps)})`);

  // 4) 逐步 undo 全部还原
  const undoLens = [];
  for (let i = 0; i < 4; i++) {
    await evalJs(`window.__osuStore.undo(); 'ok'`);
    undoLens.push(JSON.parse(await evalJs('window.__cps()')).length);
  }
  assert(JSON.stringify(undoLens) === '[4,5,4,3]', `undo 链 curvePoints 长度 3->4->5->4->3 (实际 ${JSON.stringify(undoLens)})`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps[0][0] === 300 && cps[0][1] === 100 && cps[1][0] === 300 && cps[1][1] === 300 && cps[2][0] === 100 && cps[2][1] === 300,
    'undo 到底后恢复原始 curvePoints');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V25_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V25_CDP_PASSED');
