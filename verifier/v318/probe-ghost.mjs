// v318 CDP 冒烟: F24a 放置幽灵注入渲染管线后, 单点/滑条工具下渲染循环无异常且幽灵实际改变画面。
// 需 7100 dev server。运行: node verifier/v318/probe-ghost.mjs
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9446;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v318-'));
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
const consoleErrors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args ?? []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
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
async function mouse(type, x, y) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: 0 });
}

let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

// 画布中心区域截图指纹 (dataURL 长度即可, 幽灵出现/消失应显著改变)
async function canvasHash() {
  return evalJs(`(() => { const c = document.querySelector('canvas'); return c ? c.toDataURL('image/png').length : -1; })()`);
}

try {
  await send('Runtime.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && document.querySelector("canvas"))').catch(() => false)) break;
    await sleep(500);
  }
  await evalJs(`(() => { const s = window.__osuStore; s.pause && s.pause(); s.tool = 'select'; })()`);
  const center = await evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await mouse('mouseMoved', center.x, center.y);
  await sleep(400);

  const hashSelect = await canvasHash();

  // 单点工具: 幽灵圆圈应出现 (画面变化)
  await evalJs(`(() => { window.__osuStore.tool = 'circle'; window.__osuStore.emit(); })()`);
  await mouse('mouseMoved', center.x + 3, center.y + 3);
  await sleep(400);
  const hashCircle = await canvasHash();
  assert(hashCircle > 0 && hashCircle !== hashSelect, `单点幽灵改变画面 (${hashSelect} -> ${hashCircle})`);

  // 滑条工具: 放两个待点, 幽灵滑条 + 骨架应出现
  await evalJs(`(() => {
    const s = window.__osuStore;
    s.tool = 'slider'; s.pendingSlider = [{ x: 200, y: 150, redAnchor: false }, { x: 300, y: 200, redAnchor: false }];
    s.pendingCursor = { x: 340, y: 240 }; s.emit();
  })()`);
  await mouse('mouseMoved', center.x + 6, center.y + 6);
  await sleep(400);
  const hashSlider = await canvasHash();
  assert(hashSlider > 0 && hashSlider !== hashCircle, `滑条幽灵改变画面 (${hashCircle} -> ${hashSlider})`);

  // 渲染循环仍存活 (__perfRender 增长)
  const pf1 = await evalJs('(window.__perfRender || []).length');
  await sleep(500);
  const pf2 = await evalJs('(window.__perfRender || []).length');
  assert(pf2 > pf1, `渲染循环存活 (${pf1} -> ${pf2})`);

  // 清放置态恢复
  await evalJs(`(() => { const s = window.__osuStore; s.pendingSlider = []; s.pendingCursor = null; s.tool = 'select'; s.emit(); })()`);
  await sleep(300);

  const renderErrors = consoleErrors.filter(e => e.includes('渲染帧异常') || e.includes('Uncaught'));
  assert(renderErrors.length === 0, '无渲染帧异常/未捕获错误' + (renderErrors.length ? ': ' + renderErrors[0] : ''));
} finally {
  edge.kill();
}
console.log(failures ? `\n${failures} 个断言失败` : '\nv318 CDP 冒烟全部通过');
process.exit(failures ? 1 : 0);
