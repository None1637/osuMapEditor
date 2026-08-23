// CDP v34 端到端: 自定义变换原点标记渲染 + 拖拽
//   A) 勾选"自定义"原点后, 画布 (256,192) 处渲染 #ffaa00 标记 (未勾选时无)
//   B) 拖拽标记 (256,192)->(350,250): store.customOrigin 更新, Inspector 输入同步, 物件不动, 无 undo
//   C) 旋转使用拖拽后的原点: 绕 (350,250) 顺时针 90°, 圆 (256,100)->(500,156); undo 还原物件但不动原点
//   D) 标记命中优先于物件: 原点与物件重叠时按下拖动 = 移原点不动物件
//   E) Inspector 输入反向同步: 输入 custom-x -> 标记位置更新
// 运行: node verifier/v34/cdp-origin-marker.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9360;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v34-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
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
async function mouse(type, x, y) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
  });
}
// osu 坐标 -> 客户端坐标
const toClient = (x, y) => evalJs(`window.__osuToClient(${x}, ${y})`);
// 画布像素颜色探针 (osu 坐标 -> 画布像素 -> rgb)
const probe = (x, y) => evalJs(`(() => {
  const p = window.__osuToCanvas(${x}, ${y});
  if (!p) return null;
  const c = document.querySelector('canvas.cursor-crosshair');
  const d = c.getContext('2d').getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
  return [d[0], d[1], d[2]];
})()`);
const isOrange = (rgb) => rgb && rgb[0] > 200 && rgb[1] > 110 && rgb[1] < 210 && rgb[2] < 80;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.beatmap.hitObjects = [
        { id: 97001, type: 'circle', x: 256, y: 100, time: 5000, hitSound: 0, newCombo: true, comboSkip: 0 },
      ];
      s.select([97001]);
      s.seek(4000);
      window.__pos = () => {
        const o = window.__osuStore.beatmap.hitObjects.find(x => x.id === 97001);
        return JSON.stringify([o.x, o.y]);
      };
      window.__origin = () => JSON.stringify(window.__osuStore.customOrigin);
      return 'ok';
    })()
  `);
  await sleep(400);

  // ---- A) 勾选自定义原点后标记渲染 ----
  console.log('== A) 标记渲染');
  assert(!isOrange(await probe(256, 192)), '未勾选自定义: (256,192) 无橙色标记');
  await evalJs(`document.querySelector('[data-tf="origin-custom"]').click(); 'ok'`);
  await sleep(400);
  assert(isOrange(await probe(256, 192)), `勾选自定义: (256,192) 渲染橙色标记 (${JSON.stringify(await probe(256, 192))})`);
  await evalJs(`document.querySelector('[data-tf="origin-selection"]').click(); 'ok'`);
  await sleep(400);
  assert(!isOrange(await probe(256, 192)), '切回选区原点: 标记消失');
  await evalJs(`document.querySelector('[data-tf="origin-custom"]').click(); 'ok'`);
  await sleep(300);

  // ---- B) 拖拽标记 ----
  console.log('== B) 拖拽标记 (256,192)->(350,250)');
  const undoBefore = await evalJs(`(() => { const s = window.__osuStore; s.undo(); s.redo(); return 'ok'; })()`); // 确认 undo/redo 可用性无损
  const from = await toClient(256, 192);
  const to = await toClient(350, 250);
  await mouse('mousePressed', from.x, from.y);
  await sleep(100);
  await mouse('mouseMoved', to.x, to.y);
  await sleep(200);
  let org = JSON.parse(await evalJs('window.__origin()'));
  assert(Math.abs(org.x - 350) <= 2 && Math.abs(org.y - 250) <= 2, `拖拽中 customOrigin -> (${org.x},${org.y}) 期望 ~(350,250)`);
  await mouse('mouseReleased', to.x, to.y);
  await sleep(300);
  org = JSON.parse(await evalJs('window.__origin()'));
  assert(Math.abs(org.x - 350) <= 2 && Math.abs(org.y - 250) <= 2, `松开后 customOrigin (${org.x},${org.y})`);
  const posB = JSON.parse(await evalJs('window.__pos()'));
  assert(posB[0] === 256 && posB[1] === 100, `物件未被动 (${posB})`);
  const inpX = await evalJs(`document.querySelector('[data-tf="custom-x"]').value`);
  const inpY = await evalJs(`document.querySelector('[data-tf="custom-y"]').value`);
  assert(Math.abs(parseFloat(inpX) - org.x) <= 1 && Math.abs(parseFloat(inpY) - org.y) <= 1, `Inspector 输入同步 (${inpX},${inpY})`);
  // 拖原点不进 undo: undo 应作用于此前的谱面操作而非原点拖拽 — 用标记检测: undo 后原点不变
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  const orgAfterUndo = JSON.parse(await evalJs('window.__origin()'));
  assert(orgAfterUndo.x === org.x && orgAfterUndo.y === org.y, 'undo 不影响原点 (UI 状态不进 undo)');
  await evalJs(`window.__osuStore.redo(); 'ok'`);

  // ---- C) 旋转使用拖拽后的原点 ----
  console.log('== C) 绕拖拽后原点 (350,250) 顺时针 90°');
  await evalJs(`(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('顺时针')).click();
  })(); 'ok'`);
  let pos = JSON.parse(await evalJs('window.__pos()'));
  // (256,100) 绕 (350,250) 顺时针 90°: dx=-94,dy=-150 -> x'=350+150=500, y'=250-94=156
  assert(pos[0] === 500 && pos[1] === 156, `圆 (256,100)->(${pos}) 期望 (500,156)`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  pos = JSON.parse(await evalJs('window.__pos()'));
  assert(pos[0] === 256 && pos[1] === 100, 'undo 还原物件');
  org = JSON.parse(await evalJs('window.__origin()'));
  assert(Math.abs(org.x - 350) <= 2 && Math.abs(org.y - 250) <= 2, 'undo 后原点保持 (350,250)');

  // ---- D) 标记命中优先于物件 ----
  console.log('== D) 原点与物件重叠: 拖动 = 移原点不动物件');
  await evalJs(`window.__osuStore.setCustomOrigin({ x: 256, y: 100 }); 'ok'`);
  await sleep(300);
  const fromD = await toClient(256, 100);
  const toD = await toClient(400, 300);
  await mouse('mousePressed', fromD.x, fromD.y);
  await sleep(80);
  await mouse('mouseMoved', toD.x, toD.y);
  await sleep(150);
  await mouse('mouseReleased', toD.x, toD.y);
  await sleep(300);
  org = JSON.parse(await evalJs('window.__origin()'));
  const posD = JSON.parse(await evalJs('window.__pos()'));
  assert(Math.abs(org.x - 400) <= 2 && Math.abs(org.y - 300) <= 2, `重叠拖动移了原点 (${org.x},${org.y})`);
  assert(posD[0] === 256 && posD[1] === 100, `重叠拖动物件不动 (${posD})`);

  // ---- E) Inspector 输入反向同步到标记 ----
  console.log('== E) Inspector 输入 -> 标记位置');
  await evalJs(`(() => {
    const inp = document.querySelector('[data-tf="custom-x"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '128');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })(); 'ok'`);
  await sleep(400);
  org = JSON.parse(await evalJs('window.__origin()'));
  assert(org.x === 128, `输入 custom-x=128 -> store (${org.x},${org.y})`);
  assert(isOrange(await probe(128, org.y)), `标记渲染在输入位置 (128,${org.y})`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V34_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V34_CDP_PASSED');
