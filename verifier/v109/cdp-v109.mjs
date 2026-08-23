// CDP v109 端到端: 左侧栏层级与宽度
//   T1 侧栏顶 = 上时间轴底 (位于上时间轴下方)
//   T2 侧栏底 = 下时间轴顶 (位于下时间轴上方)
//   T3 侧栏宽 = 右侧 Inspector 宽 (w-56 = 224px), 右栏贴右缘
//   T4 上时间轴恢复全宽 (左缘 = 0, 不再被侧栏挤占)
//   T5 「网格中心」按钮文案 + timing 页签下侧栏仍在
// 运行: node verifier/v109/cdp-v109.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9430;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v109-'));
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

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');
  await sleep(400);

  const r = JSON.parse(await evalJs(`
    (() => {
      const libBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('曲库'));
      const side = libBtn.closest('div.w-56');
      const tlCv = Array.from(document.querySelectorAll('canvas')).find(x => x.className.includes('h-[92px]')); // 上时间轴
      const inspector = [...document.querySelectorAll('div')].find(d => d.textContent.includes('快捷键') && d.className.includes('w-56') && d.className.includes('border-l'));
      // 下时间轴 = 主区域行之后的第一个带 border-t-2 的容器
      const mainRow = side.parentElement;
      const bottomTl = mainRow.nextElementSibling;
      const sr = side.getBoundingClientRect(), tr = tlCv.getBoundingClientRect(),
        ir = inspector.getBoundingClientRect(), br = bottomTl.getBoundingClientRect();
      const originBtn = side.querySelector('[data-grid-input="origin-toggle"]');
      return JSON.stringify({
        sideTop: sr.top, tlBottom: tr.bottom, sideBottom: sr.bottom, bottomTlTop: br.top,
        sideW: sr.width, inspW: ir.width, inspRight: ir.right, winW: window.innerWidth,
        tlLeft: tr.left, originText: originBtn.textContent.trim(),
      });
    })()
  `));
  console.log('  几何:', r);
  assert(Math.abs(r.sideTop - r.tlBottom) <= 1, `T1 侧栏顶=上时间轴底 (${r.sideTop} vs ${r.tlBottom})`);
  assert(Math.abs(r.sideBottom - r.bottomTlTop) <= 1, `T2 侧栏底=下时间轴顶 (${r.sideBottom} vs ${r.bottomTlTop})`);
  assert(Math.abs(r.sideW - r.inspW) < 1 && Math.abs(r.inspRight - r.winW) < 1, `T3 左右栏同宽且右栏贴右缘 (${r.sideW}/${r.inspW}, right=${r.inspRight}/${r.winW})`);
  assert(Math.abs(r.tlLeft) < 1, `T4 上时间轴恢复全宽 (左缘=${r.tlLeft})`);
  assert(r.originText.includes('网格中心'), `T5a 按钮文案「${r.originText}」含网格中心`);

  // T5b: 切到 timing 页签, 侧栏仍在
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'timing').click(); 'ok'`);
  await sleep(400);
  const r5 = await evalJs(`
    (() => {
      const libBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('曲库'));
      const side = libBtn && libBtn.closest('div.w-56');
      if (!side) return 'missing';
      const sr = side.getBoundingClientRect();
      const tlCv = Array.from(document.querySelectorAll('canvas')).find(x => x.className.includes('h-[92px]'));
      return JSON.stringify({ sideTop: sr.top, tlBottom: tlCv.getBoundingClientRect().bottom });
    })()
  `);
  console.log('  timing 页签:', r5);
  const p5 = r5 === 'missing' ? null : JSON.parse(r5); // evalJs 恒返回字符串, 只特判 'missing'
  assert(p5 && Math.abs(p5.sideTop - p5.tlBottom) <= 1, `T5b timing 页签下侧栏仍在上时间轴下方 (${r5})`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V109_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V109_CDP_PASSED');
