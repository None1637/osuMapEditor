// CDP v336 端到端: Alt 按下/松开即时切换 — 真实输入事件 (Input.dispatchKeyEvent/dispatchMouseEvent)
// 场景: 选择工具 + 可见滑条/单点;
//   A) 无 Alt 起手框选 (蓝/物件框选) → 拖框罩住物件 → 框选中按下 Alt (不移动鼠标) → 应立即切节点框选 (selectedNodes 非空, selected 空)
//   B) 续上: 框选中松开 Alt (不移动鼠标) → 应立即切回物件框选 (selected 非空, selectedNodes 空)
//   C) Alt 起手框选 → 松开 Alt → 同样立即切换
//   附带探针: 页面是否收到 Alt keydown/keyup DOM 事件
// 运行: node verifier/v336/cdp-v336.mjs   (需要 3000 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:3000/';
const DEBUG_PORT = 9421;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v336-'));
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
if (!target) { console.error('找不到页面目标'); process.exit(1); }
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
  // Alt 是非字符键: 按下用 rawKeyDown, 松开用 keyUp (与真实 Windows 事件序列一致)
  await send('Input.dispatchKeyEvent', {
    type: down ? 'rawKeyDown' : 'keyUp', key: 'Alt', code: 'AltLeft',
    windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: down ? MOD_ALT : 0,
  });
}
async function mouse(type, x, y, opts = {}) {
  await send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: type === 'mousePressed' ? 1 : 0,
    buttons: type === 'mouseReleased' ? 0 : 1, modifiers: opts.alt ? MOD_ALT : 0, ...opts.extra,
  });
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToCanvas)');
  }
  if (!ready) throw new Error('应用未就绪');
  await sleep(500);

  // 布景: 滑条 (200,192)->(320,192) + 单点 (420,192), 选择工具, 暂停
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

  // 探针: 记录页面收到的 Alt DOM 事件
  await evalJs(`
    window.__altLog = [];
    window.addEventListener('keydown', e => { if (e.key === 'Alt') window.__altLog.push('down:' + e.altKey); });
    window.addEventListener('keyup', e => { if (e.key === 'Alt') window.__altLog.push('up:' + e.altKey); });
  `);

  // 画布坐标换算: osu(256,192) → 页面坐标
  const toPage = await evalJs(`
    (() => {
      const c = document.querySelector('canvas');
      const r = c.getBoundingClientRect();
      const p = window.__osuToCanvas(256, 192);
      return { left: r.left, top: r.top, cx: r.left + p.x, cy: r.top + p.y };
    })()
  `);
  // 框选起点 (游玩区左上空白) 与终点 (罩住所有物件): osu(96,64) 与 osu(448,320)
  const p0 = await evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(96, 64); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  const p1 = await evalJs(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); const p = window.__osuToCanvas(448, 320); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  const state = () => evalJs(`JSON.stringify({ sel: [...window.__osuStore.selected], nodes: window.__osuStore.nodeSelectionCount })`).then(JSON.parse);

  // ---- A) 无 Alt 起手物件框选, 框选中按下 Alt (不动鼠标) ----
  await mouse('mousePressed', p0.x, p0.y);
  await mouse('mouseMoved', p1.x, p1.y);
  await sleep(150);
  let st = await state();
  assert(st.sel.length === 2 && st.nodes === 0, `A0 物件框选生效 (sel=${st.sel} nodes=${st.nodes})`);
  await keyAlt(true);
  await sleep(150);
  st = await state();
  assert(st.sel.length === 0 && st.nodes > 0, `A1 按下 Alt 立即切节点框选 (sel=${st.sel} nodes=${st.nodes})`);
  // ---- B) 框选中松开 Alt (不动鼠标) ----
  await keyAlt(false);
  await sleep(150);
  st = await state();
  assert(st.sel.length === 2 && st.nodes === 0, `B1 松开 Alt 立即切回物件框选 (sel=${st.sel} nodes=${st.nodes})`);
  await mouse('mouseReleased', p1.x, p1.y);
  await sleep(100);

  // ---- C) Alt 起手节点框选, 框选中松开 Alt ----
  await evalJs('window.__osuStore.select([]); window.__osuStore.setSelectedNodes([]);');
  await keyAlt(true);
  await mouse('mousePressed', p0.x, p0.y, { alt: true });
  await mouse('mouseMoved', p1.x, p1.y, { alt: true });
  await sleep(150);
  st = await state();
  assert(st.sel.length === 0 && st.nodes > 0, `C0 Alt 起手节点框选 (sel=${st.sel} nodes=${st.nodes})`);
  await keyAlt(false);
  await sleep(150);
  st = await state();
  assert(st.sel.length === 2 && st.nodes === 0, `C1 松开 Alt 立即切物件框选 (sel=${st.sel} nodes=${st.nodes})`);
  await mouse('mouseReleased', p1.x, p1.y);

  // ---- 探针结果 ----
  const log = await evalJs('JSON.stringify(window.__altLog)');
  assert(JSON.parse(log).length >= 4, `页面收到 Alt keydown/keyup DOM 事件 (${log})`);

  if (exceptions.length) { failures++; console.error('  FAIL: 页面异常:', exceptions.slice(0, 3)); }
} finally {
  edge.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Edge 句柄未释放时忽略 */ }
}

console.log(failures ? `\n${failures} 个断言失败` : '\ncdp-v336 全部通过');
process.exit(failures ? 1 : 0);
