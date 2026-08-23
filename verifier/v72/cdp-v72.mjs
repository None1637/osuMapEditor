// CDP v72 端到端: timing 表头行固定在窗口内不滚动
// 布景同 v71 (26 行), seek(15000) 切到 timing => 自动滚动后表头仍贴容器顶
// 再手动滚到底 => 表头依然贴容器顶
// 运行: node verifier/v72/cdp-v72.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9407;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v72-'));
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
/** 表头相对容器顶的偏移 (sticky 生效 => ~0) */
const theadOffset = () => evalJs(`
  (() => {
    const c = document.querySelector('[data-tp-scroll]');
    const h = document.querySelector('[data-tp-thead]');
    if (!c || !h) return null;
    return { scrollTop: c.scrollTop, offset: h.getBoundingClientRect().top - c.getBoundingClientRect().top };
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
      s.seek(15000);
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== 自动滚动后表头贴容器顶');
  {
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === 'timing').click(); "ok"`);
    await sleep(600);
    const st = await theadOffset();
    assert(st !== null && st.scrollTop > 100, `已自动滚动 (scrollTop=${st?.scrollTop.toFixed(0)})`);
    assert(Math.abs(st.offset) < 2, `表头贴容器顶 (offset=${st?.offset.toFixed(1)})`);
  }

  console.log('== 手动滚到底部表头依然固定');
  {
    await evalJs(`(() => { const c = document.querySelector('[data-tp-scroll]'); c.scrollTop = c.scrollHeight; })(); "ok"`);
    await sleep(300);
    const st = await theadOffset();
    assert(st.scrollTop > 100, `已滚到底部 (scrollTop=${st?.scrollTop.toFixed(0)})`);
    assert(Math.abs(st.offset) < 2, `表头仍贴容器顶 (offset=${st?.offset.toFixed(1)})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V72_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V72_CDP_PASSED');
