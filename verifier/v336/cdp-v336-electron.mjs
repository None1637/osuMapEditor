// CDP v336 Electron 端到端: 真实主进程链路 — before-input-event 拦截 Alt + "alt-key" IPC 转发
// 与 cdp-v336.mjs (浏览器) 相同的框选切换场景, 额外验证:
//   E1) 页面 DOM 收到 Alt keyDown (放行) 但收不到 keyUp (被主进程拦, 防菜单激活) — 松开态走 IPC
//   E2) 但 Alt 按下/松开仍即时切换框选类型 (证明 IPC 转发生效)
// 运行: npm run build 后 node verifier/v336/cdp-v336-electron.mjs
// (会短暂弹出编辑器窗口; 需要 dev server 未占用 7199 不影响, exe 内嵌服务器自起)
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_PORT = 9422;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });

let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
  } catch { /* not ready */ }
  if (!target) await sleep(500);
}
if (!target) { console.error('找不到 Electron 页面目标'); electron.kill(); process.exit(1); }
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

const MOD_ALT = 1;
async function keyAlt(down) {
  await send('Input.dispatchKeyEvent', {
    type: down ? 'rawKeyDown' : 'keyUp', key: 'Alt', code: 'AltLeft',
    windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: down ? MOD_ALT : 0,
  });
}
async function mouse(type, x, y, opts = {}) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0,
    buttons: type === 'mouseReleased' ? 0 : 1, modifiers: opts.alt ? MOD_ALT : 0,
  });
}

try {
  await send('Runtime.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas && window.osuEditor && window.osuEditor.isElectron)');
  }
  if (!ready) throw new Error('Electron 应用未就绪 (首跑向导未跳过?)');
  await sleep(500);

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.tool = 'select';
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [
        { id: 1, type: 'slider', x: 200, y: 192, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 320, y: 192 }], slides: 1, length: 120 },
        { id: 2, type: 'circle', x: 420, y: 192, time: 1500, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.currentTime = 1200;
      s.select([]);
      s.setSelectedNodes([]);
      s.emit();
    })()
  `);

  await evalJs(`
    window.__altLog = [];
    window.addEventListener('keydown', e => { if (e.key === 'Alt') window.__altLog.push('down:' + e.altKey); });
    window.addEventListener('keyup', e => { if (e.key === 'Alt') window.__altLog.push('up:' + e.altKey); });
  `);

  const p0 = await evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(96, 64); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  const p1 = await evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(448, 320); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  const state = () => evalJs(`JSON.stringify({ sel: [...window.__osuStore.selected], nodes: window.__osuStore.nodeSelectionCount })`).then(JSON.parse);

  // ---- A) 无 Alt 起手物件框选 → 框选中按下 Alt (不动鼠标) → 应立即切节点框选 ----
  await mouse('mousePressed', p0.x, p0.y);
  await mouse('mouseMoved', p1.x, p1.y);
  await sleep(150);
  let st = await state();
  assert(st.sel.length === 2 && st.nodes === 0, `A0 物件框选生效 (sel=${st.sel} nodes=${st.nodes})`);
  await keyAlt(true);
  await sleep(200);
  st = await state();
  assert(st.sel.length === 0 && st.nodes > 0, `A1 按下 Alt 立即切节点框选 (sel=${st.sel} nodes=${st.nodes})`);
  // ---- B) 框选中松开 Alt (不动鼠标) → 应立即切回物件框选 ----
  await keyAlt(false);
  await sleep(200);
  st = await state();
  assert(st.sel.length === 2 && st.nodes === 0, `B1 松开 Alt 立即切回物件框选 (sel=${st.sel} nodes=${st.nodes})`);
  await mouse('mouseReleased', p1.x, p1.y);
  await sleep(100);

  // ---- E1) DOM 探针: keyDown 放行 (页面直接收到), keyUp 被主进程吞下 (松开态走 IPC) ----
  const log = JSON.parse(await evalJs('JSON.stringify(window.__altLog)'));
  assert(log.filter(x => x.startsWith('down')).length >= 1 && !log.some(x => x.startsWith('up')),
    `E1 DOM 收到 keydown / 收不到 keyup = 只拦 keyUp (${JSON.stringify(log)})`);

  if (exceptions.length) { failures++; console.error('  FAIL: 页面异常:', exceptions.slice(0, 3)); }
} finally {
  electron.kill();
}

console.log(failures ? `\n${failures} 个断言失败` : '\ncdp-v336-electron 全部通过');
process.exit(failures ? 1 : 0);
