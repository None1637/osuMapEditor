// CDP v107 端到端: 波形窗点击穿透
//   T1 画布中心 elementFromPoint 命中面板外元素 (穿透到下层)
//   T2 右侧标题条 elementFromPoint 仍命中标题条 (可拖/可点)
//   T3 模式按钮仍命中且点击生效 (切到频谱图)
//   T4 顶边拉伸句柄仍命中 (可拉伸)
//   T5 画布处真实 pointerdown 落到下层元素 (事件目标在面板外)
// 运行: node verifier/v107/cdp-v107.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9427;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v107-'));
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

  await evalJs(`window.__osuStore.setWavePanelOpen(true); 'ok'`);
  await sleep(600);

  const geo = JSON.parse(await evalJs(`
    (() => {
      const q = (sel) => document.querySelector(sel);
      const rc = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      return JSON.stringify({
        canvas: rc(q('[data-wave="canvas"]')),
        header: rc(q('[data-wave="header"]')),
        resize: { x: rc(q('[data-wave="resize"]')).x, y: q('[data-wave="resize"]').getBoundingClientRect().top + 2 },
        modeSpectro: rc(q('[data-wave="mode-spectro"]')),
      });
    })()
  `));

  const hitAt = (p) => evalJs(`
    (() => {
      const el = document.elementFromPoint(${p.x}, ${p.y});
      if (!el) return 'null';
      const wave = el.closest('[data-wave]');
      return (wave ? wave.getAttribute('data-wave') : 'OUTSIDE') + '|' + el.tagName;
    })()
  `);

  // T1: 画布中心 → 面板外元素 (穿透)
  const h1 = await hitAt(geo.canvas);
  console.log('  T1 画布中心命中:', h1);
  assert(h1.startsWith('OUTSIDE'), `T1 画布中心穿透到面板外 (${h1})`);

  // T2: 标题条中心 → 命中 header
  const h2 = await hitAt(geo.header);
  console.log('  T2 标题条中心命中:', h2);
  assert(h2.startsWith('header'), `T2 标题条仍可点 (${h2})`);

  // T3: 模式按钮命中 + 点击切到频谱图
  const h3 = await hitAt(geo.modeSpectro);
  console.log('  T3 频谱按钮命中:', h3);
  assert(h3.startsWith('mode-spectro'), `T3 频谱按钮仍可点 (${h3})`);
  await evalJs(`document.elementFromPoint(${geo.modeSpectro.x}, ${geo.modeSpectro.y}).click(); 'ok'`);
  await sleep(400);
  const active = await evalJs(`document.querySelector('[data-wave="mode-spectro"]').className.includes('bg-emerald-500/50')`);
  assert(active, 'T3 点击穿透改造后模式按钮仍生效 (切到频谱图高亮)');

  // T4: 拉伸句柄命中
  const h4 = await hitAt(geo.resize);
  console.log('  T4 拉伸句柄命中:', h4);
  assert(h4.startsWith('resize'), `T4 拉伸句柄仍可点 (${h4})`);

  // T5: 画布处受信鼠标事件 (Input.dispatchMouseEvent 走真实 hit-test) — 目标在面板外
  await evalJs(`
    window.__t107hit = 'no-event';
    window.addEventListener('pointerdown', (e) => {
      const wave = e.target.closest ? e.target.closest('[data-wave]') : null;
      window.__t107hit = (wave ? wave.getAttribute('data-wave') : 'OUTSIDE') + '|' + e.target.tagName;
    }, { capture: true, once: true });
    'ok'
  `);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geo.canvas.x, y: geo.canvas.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: geo.canvas.x, y: geo.canvas.y, button: 'left', clickCount: 1 });
  await sleep(200);
  const h5 = await evalJs('window.__t107hit');
  console.log('  T5 画布 pointerdown 目标:', h5);
  assert(h5.startsWith('OUTSIDE'), `T5 画布处受信点击直达下层 (${h5})`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V107_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V107_CDP_PASSED');
