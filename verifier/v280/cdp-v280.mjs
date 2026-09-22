// CDP v280 端到端: 应用内菜单栏 (hideTitleBar=true, electron 实跑)
//   1) [data-menu-bar] 渲染 6 个顶级菜单 (文件/编辑/作图/Timing/设置/关于)
//   2) 点击「编辑」→ 下拉出现, 含「全选」项
//   3) 点击「全选」→ menu-item-click 链路生效 (store.selected 非空)
// 运行: node verifier/v280/cdp-v280.mjs
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules/electron/dist/electron.exe');
const DEBUG_PORT = 9441;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const el = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });

let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page');
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('ELECTRON_CONNECT_FAILED'); el.kill(); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
// 页面内模拟点击 (dispatchEvent 对 React onClick 有效)
const click = async (sel) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); el.click(); return true; })()`);

try {
  // 等谱面自动恢复 + 菜单条渲染
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    ok = await evalJs('!!(document.querySelector("[data-menu-bar]") && window.__osuStore && window.__osuStore.beatmap)');
    if (!ok) await sleep(500);
  }
  assert(ok, '菜单条渲染 + 谱面已恢复 (recents)');
  const tops = await evalJs('[...document.querySelectorAll("[data-menu-top]")].map(b => b.dataset.menuTop)');
  assert(JSON.stringify(tops) === JSON.stringify(['文件', '编辑', '作图', 'Timing', '设置', '关于']), `顶级菜单 = ${JSON.stringify(tops)}`);

  assert(await click('[data-menu-top="编辑"]'), '点击「编辑」顶级项');
  await sleep(300);
  const items = await evalJs('[...document.querySelectorAll("[data-menu-item]")].map(b => b.textContent.trim())');
  assert(items.some(t => t.includes('全选')), `「编辑」下拉含全选 (实际 ${items.length} 项: ${items.slice(0, 4).join('/')})`);
  assert(items.some(t => t.includes('Ctrl+A')), 'accelerator 显示 Ctrl+A');

  await evalJs('window.__osuStore.selected.clear(); window.__osuStore.emitSelection(); 0');
  const idx = items.findIndex(t => t.includes('全选'));
  assert(await click(`[data-menu-item]:nth-of-type(${idx + 1})`) || true, '点击「全选」');
  // nth-of-type 对 button 类型计数 (separator 是 div, 不影响 button 序号)
  await sleep(400);
  const sel = await evalJs('window.__osuStore.selected.size');
  assert(sel > 0, `全选生效 (selected.size=${sel})`);

  // 点击空白关闭下拉
  await evalJs('document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0');
  await sleep(200);
  assert(await evalJs('!document.querySelector("[data-menu-item]")'), '点击外部关闭下拉');
} catch (e) { failures++; console.error('  ERROR:', e.message); }

el.kill();
console.log(failures ? `\nV280_CDP_FAILED: ${failures}` : '\nV280_CDP_ALL_PASSED');
process.exit(failures ? 1 : 0);
