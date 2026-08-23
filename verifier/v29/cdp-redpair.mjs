// CDP v29 端到端: 滑条节点编辑手势 (v29)
//   A) 拖拽红锚点 -> 重复对成对移动 (不拆成两个白点), curveType 保持 B
//   B) 拖拽控制点超出游玩区 (负坐标/y>384) -> 不钳制
//   C) 左键点击红锚点 (无拖拽) -> 无任何操作 (对不拆, 点数不变)
//   D) 右键红锚点 -> 合并为一个白点; 逐步 undo 还原
// 运行: node verifier/v29/cdp-redpair.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9355;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v29-'));
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
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from(s.result.data, 'base64'));
  console.log('  截图: verifier/runs/' + name);
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3500);

  // 造一个含红锚点重复对的滑条: ctrl = 头(100,100) + [(300,100),(300,100),(100,300)]
  await evalJs(`
    const s = window.__osuStore;
    const bm = s.beatmap;
    bm.hitObjects = [{
      id: 93001, type: 'slider', x: 100, y: 100, time: 5000, hitSound: 0, newCombo: true, comboSkip: 0,
      curveType: 'B', curvePoints: [{ x: 300, y: 100 }, { x: 300, y: 100 }, { x: 100, y: 300 }], slides: 1, length: 500,
    }];
    s.select([93001]);
    s.seek(4800);
    window.__ev = (type, ox, oy, btn) => {
      const c = document.querySelector('canvas.cursor-crosshair');
      const p = window.__osuToClient(ox, oy);
      c.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, button: btn || 0,
        clientX: p.x, clientY: p.y,
      }));
    };
    window.__click = (x, y) => { window.__ev('mousedown', x, y, 0); window.__ev('mouseup', x, y, 0); };
    window.__rclick = (x, y) => { window.__ev('contextmenu', x, y, 2); };
    window.__drag = (x0, y0, x1, y1) => {
      window.__ev('mousedown', x0, y0, 0);
      window.__ev('mousemove', x0 + (x1 - x0) / 2, y0 + (y1 - y0) / 2, 0);
      window.__ev('mousemove', x1, y1, 0);
      window.__ev('mouseup', x1, y1, 0);
    };
    window.__cps = () => JSON.stringify(window.__osuStore.beatmap.hitObjects[0].curvePoints.map(p => [p.x, p.y]));
    window.__head = () => JSON.stringify([window.__osuStore.beatmap.hitObjects[0].x, window.__osuStore.beatmap.hitObjects[0].y]);
    window.__ctype = () => window.__osuStore.beatmap.hitObjects[0].curveType;
    'ok'
  `);
  await sleep(500);

  // ---- A) 拖拽红锚点 (300,100) -> (340,160): 成对移动不拆对 ----
  console.log('== A) 红点拖拽成对移动');
  await evalJs(`window.__drag(300, 100, 340, 160); 'ok'`);
  let cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 3, `拖拽后 curvePoints 仍 3 个 (实际 ${cps.length}, 旧行为拆对变 3 点但两点分离)`);
  assert(cps[0][0] === 340 && cps[0][1] === 160, `对中第一个移动到 (340,160) (实际 ${JSON.stringify(cps[0])})`);
  assert(cps[1][0] === 340 && cps[1][1] === 160, `对中第二个同步移动 (重复对保持, 实际 ${JSON.stringify(cps[1])})`);
  assert(await evalJs('window.__ctype()') === 'B', 'curveType 保持 B');

  // ---- B) 拖拽白点 (100,300) 超出游玩区 -> (-60, 420): 不钳制 ----
  console.log('== B) 控制点可超出游玩区');
  await evalJs(`window.__drag(100, 300, -60, 420); 'ok'`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps[2][0] === -60 && cps[2][1] === 420, `控制点拖到 (-60,420) 不钳制 (实际 ${JSON.stringify(cps[2])}, 旧行为钳到 (0,384))`);
  await shot('v29-outside.png');

  // ---- C) 左键点击红锚点 (340,160) 无拖拽 -> 无操作 ----
  console.log('== C) 左键点击红点无操作');
  await evalJs(`window.__click(340, 160); 'ok'`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 3, `点击红点后点数不变 (实际 ${cps.length})`);
  assert(cps[0][0] === 340 && cps[1][0] === 340 && cps[0][1] === 160 && cps[1][1] === 160, '重复对未被点击拆散');

  // ---- D) 右键红锚点 (340,160) -> 合并为一个白点 ----
  console.log('== D) 右键红点转白');
  await evalJs(`window.__rclick(340, 160); 'ok'`);
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 2, `右键红点后合并: curvePoints 3->2 (实际 ${cps.length})`);
  assert(cps[0][0] === 340 && cps[0][1] === 160 && cps[1][0] === -60, '保留 (340,160) 单个白点 + 尾部');

  // ---- undo 链: 转白 -> 点击(无 undo) -> 拖出界 -> 成对拖 ----
  console.log('== undo 还原');
  await evalJs(`window.__osuStore.undo(); 'ok'`); // 撤销 转白
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps.length === 3 && cps[0][0] === 340 && cps[1][0] === 340, 'undo 转白: 重复对恢复');
  await evalJs(`window.__osuStore.undo(); 'ok'`); // 撤销 拖出界
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps[2][0] === 100 && cps[2][1] === 300, 'undo 拖出界: 白点回 (100,300)');
  await evalJs(`window.__osuStore.undo(); 'ok'`); // 撤销 成对拖
  cps = JSON.parse(await evalJs('window.__cps()'));
  assert(cps[0][0] === 300 && cps[0][1] === 100 && cps[1][0] === 300 && cps[2][0] === 100, 'undo 成对拖: 恢复原始点列');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V29_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V29_CDP_PASSED');
