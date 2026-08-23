// CDP v57 端到端: 锁定间距默认关 + 网格间距输入自由输入 (全选输入 10/20 不被钳成 4)
// 运行: node verifier/v57/cdp-v57.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9392;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v57-'));
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
// 模拟逐键输入: 原生 setter 写值 + input 事件 (React 受控组件标准技巧)
const typeExpr = (v) => `(() => {
  const inp = document.querySelector('[data-grid-input=spacing]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '${v}');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return [inp.value, window.__osuStore.gridSpacing, window.__osuStore.beatmap.editor.gridSize];
})()`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');

  console.log('== A) 锁定间距默认关 (lazer DistanceSnapToggle 默认 TernaryState.False)');
  {
    const dl = await evalJs('window.__osuStore.distanceLock');
    assert(dl === false, `fresh store distanceLock === false (实际 ${dl})`);
  }

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.tool = 'select';
      s.beatmap.editor.timelineZoom = 1;
      s.gridSpacing = null; // 跟随谱面 GridSize
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== B) 网格间距输入: 逐键输入不被中途钳制');
  {
    // 全选后输入 "10": 第一个键 "1" 不得被钳成 4 提交
    let r = await evalJs(typeExpr('1'));
    await sleep(200);
    assert(r[0] === '1' && r[1] === null, `输入 "1": 框内显示 1, 未提交 (实际 框=${r[0]}, store=${r[1]})`);
    r = await evalJs(typeExpr('10'));
    await sleep(200);
    assert(r[1] === 10 && r[2] === 10, `继续输入 "10": 提交 10 并写回 GridSize (实际 store=${r[1]}, gridSize=${r[2]})`);
    // 超范围不提交
    r = await evalJs(typeExpr('999'));
    await sleep(200);
    assert(r[0] === '999' && r[1] === 10, `输入 "999": 框内显示 999, 不提交 (实际 框=${r[0]}, store=${r[1]})`);
    // 失焦还原为已提交值
    r = await evalJs(`(() => {
      const inp = document.querySelector('[data-grid-input=spacing]');
      inp.focus(); inp.blur();
      return 'ok';
    })()`);
    await sleep(300);
    const v = await evalJs(`document.querySelector('[data-grid-input=spacing]').value`);
    assert(v === '10', `失焦后还原为已提交值 10 (实际 ${v})`);
    // 输入 20 同样可行
    r = await evalJs(typeExpr('2'));
    await sleep(150);
    r = await evalJs(typeExpr('20'));
    await sleep(200);
    assert(r[1] === 20 && r[2] === 20, `输入 "20": 提交 20 (实际 store=${r[1]}, gridSize=${r[2]})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
if (failures) { console.error(`\nVERIFIER_V57_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V57_CDP_PASSED');
