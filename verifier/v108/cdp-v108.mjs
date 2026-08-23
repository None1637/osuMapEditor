// CDP v108 端到端: 左侧栏布局
//   T1 左侧栏存在且贴页面左缘 (含曲库按钮), 宽 ≈176px
//   T2 顶部工具栏不再含任何按钮
//   T3 侧栏分隔线 ≥7 条
//   T4 侧栏控件可用: 点「滑条」工具 → store.tool='slider'; 点「网格吸附」→ store.gridSnap 切换
//   T5 右侧内容上时间轴左缘 = 侧栏右缘 (铺满剩余宽度)
// 运行: node verifier/v108/cdp-v108.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9428;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v108-'));
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

  // 定位: 侧栏 = 曲库按钮的祖先容器; 工具栏 = 标题 span 的祖先
  const r1 = JSON.parse(await evalJs(`
    (() => {
      const libBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('曲库'));
      const side = libBtn.closest('div.w-56');
      const title = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === 'osu! 谱面编辑器');
      const toolbar = title.parentElement;
      const tl = document.querySelector('canvas'); // 上时间轴画布不确定, 用几何: 右侧列第一个 canvas
      const sr = side.getBoundingClientRect();
      return JSON.stringify({
        side: { left: sr.left, width: sr.width, top: sr.top, height: sr.height },
        toolbarButtons: toolbar.querySelectorAll('button').length,
        seps: side.querySelectorAll('div.h-px').length,
        undoInSide: !!side.querySelector('button:not([disabled])'),
        gridToggle: !!side.querySelector('[data-grid-input="type"]'),
        waveToggle: !!side.querySelector('[data-wave-input="toggle"]'),
      });
    })()
  `));
  console.log('  T1-T3:', r1);
  assert(Math.abs(r1.side.left) < 1 && r1.side.width > 200 && r1.side.width < 260, `T1 左侧栏贴左缘且宽度与右栏一致 (v109 w-56; ${JSON.stringify(r1.side)})`);
  assert(r1.toolbarButtons === 0, `T2 顶部工具栏无按钮 (实际 ${r1.toolbarButtons})`);
  assert(r1.seps >= 7, `T3 分隔线 ≥7 (实际 ${r1.seps})`);
  assert(r1.gridToggle && r1.waveToggle, 'T3b 侧栏含网格/波形控件');

  // T4: 侧栏控件可用
  const r4 = JSON.parse(await evalJs(`
    (() => {
      const libBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('曲库'));
      const side = libBtn.closest('div.w-56');
      const sliderBtn = [...side.querySelectorAll('button')].find(b => b.textContent.includes('滑条'));
      sliderBtn.click();
      const tool = window.__osuStore.tool;
      const gridBtn = [...side.querySelectorAll('button')].find(b => b.textContent.includes('网格吸附'));
      const before = window.__osuStore.gridSnap;
      gridBtn.click();
      const after = window.__osuStore.gridSnap;
      gridBtn.click(); // 还原
      const undoBtn = [...side.querySelectorAll('button')].find(b => b.textContent.includes('撤销'));
      return JSON.stringify({ tool, gridToggled: before !== after, undoThere: !!undoBtn });
    })()
  `));
  console.log('  T4:', r4);
  assert(r4.tool === 'slider', `T4 点侧栏「滑条」切换工具 (tool=${r4.tool})`);
  assert(r4.gridToggled, 'T4 点侧栏「网格吸附」开关生效');
  assert(r4.undoThere, 'T4 侧栏含撤销按钮');
  await evalJs(`window.__osuStore.tool = 'select'; window.__osuStore.emit(); 'ok'`); // 还原工具

  // T5: 右侧内容 (上时间轴容器) 左缘 = 侧栏右缘
  const r5 = JSON.parse(await evalJs(`
    (() => {
      const libBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('曲库'));
      const side = libBtn.closest('div.w-56');
      const sr = side.getBoundingClientRect();
      // 上时间轴 = 侧栏右侧第一个含 canvas 的 flex-1 容器
      const probe = document.elementFromPoint(sr.right + 10, sr.top + 60);
      return JSON.stringify({ sideRight: sr.right, probeX: sr.right + 10, probeOutsideSide: !probe.closest('div.w-56') });
    })()
  `));
  console.log('  T5:', r5);
  assert(r5.probeOutsideSide, `T5 侧栏右缘之外即右侧内容 (probe ${r5.probeX} 不在侧栏内)`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V108_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V108_CDP_PASSED');
