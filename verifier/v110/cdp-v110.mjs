// CDP v110 端到端: 工具栏加高后波形面板最上方齐贴时间轴
//   T1 工具栏高度 = 48px
//   T2 波形面板 offsetY=0 (最上方) → top >= 0 且 bottom == 上时间轴顶 (齐贴不重合)
//   T3 全程无异常
// 运行: node verifier/v110/cdp-v110.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9431;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v110-'));
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

  // T1: 工具栏高度
  const h = await evalJs(`
    (() => {
      const title = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === 'osu! 谱面编辑器');
      return title.parentElement.getBoundingClientRect().height;
    })()
  `);
  console.log('  T1 工具栏高度 =', h);
  assert(Math.abs(h - 48) < 1, `T1 工具栏高度 48px (实际 ${h})`);

  // T2: 面板 offsetY=0 (最上方) → 齐贴时间轴上方
  await evalJs(`
    localStorage.setItem('osu-editor:wavepanel:state', JSON.stringify({ mode: 'wave', offsetY: 0, height: 92, collapsed: false, colPos: null }));
    window.__osuStore.setWavePanelOpen(true); 'ok'
  `);
  await sleep(600);
  const r2 = JSON.parse(await evalJs(`
    (() => {
      const panel = document.querySelector('[data-wave="panel"]');
      const tlCv = Array.from(document.querySelectorAll('canvas')).find(x => x.className.includes('h-[92px]'));
      const pr = panel.getBoundingClientRect(), tr = tlCv.getBoundingClientRect();
      return JSON.stringify({ top: pr.top, bottom: pr.bottom, tlTop: tr.top });
    })()
  `));
  console.log('  T2 面板几何:', r2);
  assert(r2.top >= -1, `T2 面板顶不出屏 (top=${r2.top})`);
  assert(Math.abs(r2.bottom - r2.tlTop) <= 1, `T2 面板底齐贴上时间轴顶不重合 (bottom=${r2.bottom} vs tlTop=${r2.tlTop})`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V110_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V110_CDP_PASSED');
