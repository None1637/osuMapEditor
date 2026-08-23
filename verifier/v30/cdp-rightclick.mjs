// CDP v30 端到端:
//   A) 拖滑条控制点到下方全局时间轴: 不触发 seek; 松开后时间轴恢复正常响应
//   B) 选择/单点/滑条/转盘四模式右键物件 -> 删除该物件
//   C) 选择模式选中滑条时, 右键滑条非控制点部位 -> 删除整个滑条
// 运行: node verifier/v30/cdp-rightclick.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9356;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v30-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
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
  await sleep(3500);

  await evalJs(`
    const s = window.__osuStore;
    const bm = s.beatmap;
    bm.hitObjects = [
      { id: 93001, type: 'slider', x: 100, y: 100, time: 5000, hitSound: 0, newCombo: true, comboSkip: 0,
        curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
      { id: 93011, type: 'circle', x: 440, y: 300, time: 6000, hitSound: 0, newCombo: false, comboSkip: 0 },
      { id: 93012, type: 'circle', x: 360, y: 300, time: 6100, hitSound: 0, newCombo: false, comboSkip: 0 },
      { id: 93013, type: 'circle', x: 280, y: 300, time: 6200, hitSound: 0, newCombo: false, comboSkip: 0 },
      { id: 93014, type: 'circle', x: 200, y: 300, time: 6300, hitSound: 0, newCombo: false, comboSkip: 0 },
    ];
    s.select([93001]);
    s.seek(4800);
    window.__cvs = () => document.querySelector('canvas.cursor-crosshair');
    window.__btl = () => document.querySelector('canvas.flex-1'); // 底部全局时间轴
    window.__evOn = (el, type, cx, cy, btn, buttons) => {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, button: btn || 0, buttons: buttons ?? 0,
        clientX: cx, clientY: cy,
      }));
    };
    window.__evOsu = (type, ox, oy, btn, buttons) => {
      const p = window.__osuToClient(ox, oy);
      window.__evOn(window.__cvs(), type, p.x, p.y, btn, buttons);
    };
    window.__rclick = (ox, oy) => window.__evOsu('contextmenu', ox, oy, 2);
    window.__ids = () => JSON.stringify(window.__osuStore.beatmap.hitObjects.map(o => o.id).sort((a, b) => a - b));
    'ok'
  `);
  await sleep(400);

  // ---- A) 拖控制点到下方时间轴不 seek ----
  console.log('== A) 拖控制点经过时间轴');
  const t0 = await evalJs('window.__osuStore.currentTime');
  // mousedown 在控制点 (300,100) 上 (画布内)
  await evalJs(`window.__evOsu('mousedown', 300, 100, 0, 1); 'ok'`);
  assert(await evalJs('window.__osuStore.canvasDragging'), '拖拽开始: canvasDragging=true');
  // 移动到底部时间轴上 (按钮仍按住) — 直接对时间轴 canvas 派发 mousemove/mouseup
  await evalJs(`(() => {
    const el = window.__btl();
    const r = el.getBoundingClientRect();
    window.__evOn(el, 'mousemove', r.left + r.width * 0.9, r.top + r.height / 2, 0, 1);
  })(); 'ok'`);
  assert((await evalJs('window.__osuStore.currentTime')) === t0, `拖拽经过时间轴: 未 seek (仍为 ${t0})`);
  // 在时间轴上松开 -> window mouseup 清标志; 随后正常点击时间轴应能 seek
  await evalJs(`(() => {
    const el = window.__btl();
    const r = el.getBoundingClientRect();
    window.__evOn(el, 'mouseup', r.left + r.width * 0.9, r.top + r.height / 2, 0, 0);
  })(); 'ok'`);
  assert(!(await evalJs('window.__osuStore.canvasDragging')), '松开后 canvasDragging 清除 (window 兜底)');
  await evalJs(`(() => {
    const el = window.__btl();
    const r = el.getBoundingClientRect();
    window.__evOn(el, 'mousedown', r.left + r.width * 0.05, r.top + r.height / 2, 0, 1);
    window.__evOn(el, 'mouseup', r.left + r.width * 0.05, r.top + r.height / 2, 0, 0);
  })(); 'ok'`);
  const t1 = await evalJs('window.__osuStore.currentTime');
  assert(t1 !== t0, `松开后时间轴恢复正常 seek (${t0} -> ${Math.round(t1)})`);
  await evalJs(`window.__osuStore.seek(${t0}); 'ok'`);

  // ---- B) 四模式右键删物件 ----
  console.log('== B) 四模式右键删除');
  await evalJs(`window.__osuStore.seek(5900); 'ok'`); // 圆在 6000-6300, preempt 600 -> 5900 起全部可见 (hitTest = 渲染窗口)
  await sleep(150);
  for (const [tool, id, cx] of [['select', 93011, 440], ['circle', 93012, 360], ['slider', 93013, 280], ['spinner', 93014, 200]]) {
    await evalJs(`window.__osuStore.select([]); window.__osuStore.tool = '${tool}'; window.__osuStore.emit(); 'ok'`);
    await sleep(120);
    await evalJs(`window.__rclick(${cx}, 300); 'ok'`);
    const ids = await evalJs('window.__ids()');
    assert(!ids.includes(String(id)), `${tool} 模式右键删除物件 ${id}`);
  }

  // ---- C) 选中滑条右键非控制点部位 -> 删整个滑条 ----
  console.log('== C) 选中滑条右键身体删除');
  await evalJs(`window.__osuStore.tool = 'select'; window.__osuStore.select([93001]); window.__osuStore.emit(); 'ok'`);
  await sleep(120);
  await evalJs(`window.__rclick(200, 100); 'ok'`); // 滑条身中点, 非控制点手柄
  let ids = await evalJs('window.__ids()');
  assert(!ids.includes('93001'), '右键滑条身 (非控制点) 删除整个滑条');

  // ---- undo 还原 ----
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  ids = await evalJs('window.__ids()');
  assert(ids.includes('93001'), 'undo 还原滑条删除');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V30_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V30_CDP_PASSED');
