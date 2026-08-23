// CDP v85 端到端: 按钮弹窗居中
// A) 打开几何辅助面板 => 窗口中心 ≈ 视口中心 (±2px)
// B) 拖标题栏 => 位置跟随且松手后不复位
// C) 关闭重开 => 重新居中 (不记忆上次拖到的位置)
// 运行: node verifier/v85/cdp-v85.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9411;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v85-'));
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
const dlgRect = () => evalJs(`
  (() => {
    const d = document.querySelector('[data-dialog="geo-snap"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
  })()
`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');
  await sleep(500);

  console.log('== A) 打开面板 => 居中');
  {
    await evalJs(`document.querySelector('[data-geo-input="panel-toggle"]').click(); "ok"`);
    await sleep(400);
    const r = await dlgRect();
    assert(r !== null, '面板已打开');
    if (r) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      assert(Math.abs(cx - r.vw / 2) <= 2 && Math.abs(cy - r.vh / 2) <= 2,
        `中心 (${cx.toFixed(1)},${cy.toFixed(1)}) ≈ 视口 (${(r.vw / 2).toFixed(1)},${(r.vh / 2).toFixed(1)})`);
    }
  }

  console.log('== B) 拖标题栏 => 跟随且不复位');
  {
    const r0 = await dlgRect();
    const sx = r0.x + 60, sy = r0.y + 12; // 标题栏上一点
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx + 200, y: sy + 150, button: 'left', buttons: 1 });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx + 200, y: sy + 150, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(300);
    const r1 = await dlgRect();
    assert(Math.abs(r1.x - (r0.x + 200)) <= 3 && Math.abs(r1.y - (r0.y + 150)) <= 3,
      `拖动 (+200,+150) 生效 (${r0.x.toFixed(0)},${r0.y.toFixed(0)}) -> (${r1.x.toFixed(0)},${r1.y.toFixed(0)})`);
    await sleep(400);
    const r2 = await dlgRect();
    assert(Math.abs(r2.x - r1.x) <= 1 && Math.abs(r2.y - r1.y) <= 1, '松手后不复位');
  }

  console.log('== C) 关闭重开 => 重新居中');
  {
    await evalJs(`window.__osuStore.setGeoPanelOpen(false); "ok"`);
    await sleep(250);
    await evalJs(`document.querySelector('[data-geo-input="panel-toggle"]').click(); "ok"`);
    await sleep(400);
    const r = await dlgRect();
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    assert(Math.abs(cx - r.vw / 2) <= 2 && Math.abs(cy - r.vh / 2) <= 2,
      `重开后中心 (${cx.toFixed(1)},${cy.toFixed(1)}) 回到视口中心`);
    await evalJs(`window.__osuStore.setGeoPanelOpen(false); "ok"`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V85_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V85_CDP_PASSED');
