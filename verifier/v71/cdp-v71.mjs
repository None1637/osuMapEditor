// CDP v71 端到端: timing 窗口内滚动条 + 切页签自动滚到生效绿线行
// 布景: red(0) + green @1000..25000 共 26 行 (超出窗口高度); seek(15000) => 生效绿线行 15
// A) timing 页签 [data-tp-scroll] 容器限高滚动 (scrollHeight > clientHeight)
// B) 切入后 scrollTop > 0 且生效绿线行在容器可视区内 (并带 data-active-green)
// C) seek(500) 后切走再切回 => 滚回顶部 (目标 = 红@0 行)
// 运行: node verifier/v71/cdp-v71.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9406;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v71-'));
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
  if (r.error) throw new Error('CDP 错误: ' + JSON.stringify(r.error).slice(0, 300));
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
const clickTab = (label) => evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === '${label}').click(); "ok"`);
/** 滚动容器状态: scrollTop / 是否限高 / 指定行是否在可视区内 */
const scrollState = (rowIdx) => evalJs(`
  (() => {
    const c = document.querySelector('[data-tp-scroll]');
    if (!c) return null;
    const row = c.querySelector('[data-tp-row="${rowIdx}"]');
    if (!row) return { scrollTop: c.scrollTop, limited: c.scrollHeight > c.clientHeight, rowVisible: null };
    const cr = c.getBoundingClientRect(), rr = row.getBoundingClientRect();
    return {
      scrollTop: c.scrollTop,
      limited: c.scrollHeight > c.clientHeight,
      rowVisible: rr.top >= cr.top - 1 && rr.bottom <= cr.bottom + 1,
    };
  })()
`);

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
      s.pause();
      const tps = [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      for (let t = 1000; t <= 25000; t += 1000)
        tps.push({ time: t, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 });
      s.beatmap.timingPoints = tps;
      s.beatmap.hitObjects = [];
      s.beatmap.editor.timelineZoom = 1;
      s.seek(15000);
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== A/B) 切到 timing: 窗口内滚动 + 自动滚到生效绿线行 15');
  {
    await clickTab('timing');
    await sleep(600); // rAF 滚动 + 渲染
    const st = await scrollState(15);
    assert(st !== null, '[data-tp-scroll] 容器存在');
    assert(st.limited, `容器限高滚动 (scrollTop=${st.scrollTop?.toFixed(0)})`);
    assert(st.scrollTop > 100, `自动滚离顶部 (scrollTop=${st.scrollTop?.toFixed(0)})`);
    assert(st.rowVisible === true, '生效绿线行 15 在容器可视区内');
    const activeRow = await evalJs(`document.querySelector('[data-active-green]')?.getAttribute('data-tp-row') ?? null`);
    assert(activeRow === '15', `生效绿线高亮行=15 (实际 ${activeRow})`);
  }

  console.log('== C) seek(500) 切走再切回 => 滚回顶部 (目标行 0)');
  {
    await evalJs(`window.__osuStore.seek(500); "ok"`);
    await clickTab('compose');
    await sleep(300);
    await clickTab('timing');
    await sleep(600);
    const st = await scrollState(0);
    assert(st !== null && st.rowVisible === true, '行 0 在可视区内');
    assert(st.scrollTop < 40, `回滚到顶部 (scrollTop=${st.scrollTop?.toFixed(0)})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V71_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V71_CDP_PASSED');
