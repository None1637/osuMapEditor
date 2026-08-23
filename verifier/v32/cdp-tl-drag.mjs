// CDP v32 端到端:
//   A) 时间轴拖拽物件改时间 (吸附 1/4 拍 = 125ms), undo 还原
//   B) 点击 (未拖动) = 选中, 不再 seek (v79: 点击时间轴不改时间)
//   C) 多选拖拽: anchor 吸附, 另一选中物件同 delta 跟随
//   D) J/K 快捷键: 选中物件后移/前移一个吸附
// 运行: node verifier/v32/cdp-tl-drag.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9358;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v32-'));
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
  // 等待应用就绪 (__osuStore + beatmap 挂载), 比固定 sleep 可靠
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)');
  }
  if (!ready) throw new Error('应用未就绪');
  await sleep(500);

  // demo 红线 1000/500 -> 1/4 吸附 = 125ms; zoom=1, seek 4000 -> 窗口 [1000,7000]
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      const bm = s.beatmap;
      bm.editor.timelineZoom = 1;
      bm.hitObjects = [
        { id: 95001, type: 'circle', x: 100, y: 100, time: 2000, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 95002, type: 'circle', x: 300, y: 100, time: 3000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.select([]);
      s.seek(4000);
      window.__tl = () => [...document.querySelectorAll('canvas')]
        .find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      window.__cx = (ms) => {
        const c = window.__tl();
        const r = c.getBoundingClientRect();
        const t0 = window.__osuStore.currentTime - 3000;
        return r.left + ((ms - t0) / 6000) * r.width;
      };
      window.__ev = (type, ms, btn, buttons, shift) => {
        const c = window.__tl();
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, button: btn || 0, buttons: buttons ?? 0, shiftKey: !!shift,
          clientX: window.__cx(ms), clientY: r.top + 30, // 物件行
        }));
      };
      window.__time = (id) => window.__osuStore.beatmap.hitObjects.find(o => o.id === id)?.time;
      return 'ok';
    })()
  `);
  await sleep(400);

  // ---- A) 拖拽 95001: 2000 -> +625ms (5 tick) = 2625 ----
  console.log('== A) 拖拽改时间 (吸附)');
  await evalJs(`window.__ev('mousedown', 2000, 0, 1); 'ok'`);
  await evalJs(`window.__ev('mousemove', 2300, 0, 1); 'ok'`); // 先越过 4px 阈值
  await evalJs(`window.__ev('mousemove', 2625, 0, 1); 'ok'`);
  await evalJs(`window.__ev('mouseup', 2625, 0, 0); 'ok'`);
  assert((await evalJs('window.__time(95001)')) === 2625, `拖拽后时间 2000->2625 (实际 ${await evalJs('window.__time(95001)')})`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  assert((await evalJs('window.__time(95001)')) === 2000, 'undo 还原 2000');

  // ---- B) 点击 (未拖动) = 选中, v79 起不再 seek ----
  console.log('== B) 点击选中且不 seek (v79)');
  await evalJs(`window.__ev('mousedown', 3000, 0, 1); window.__ev('mouseup', 3000, 0, 0); 'ok'`);
  assert(await evalJs('window.__osuStore.selected.has(95002)'), '点击选中 95002');
  assert((await evalJs('window.__osuStore.currentTime')) === 4000, `点击不再 seek, 时间保持 4000 (实际 ${await evalJs('window.__osuStore.currentTime')})`);
  assert((await evalJs('window.__time(95002)')) === 3000, '点击不改变物件时间');

  // ---- C) 多选拖拽: anchor 95001 +125, 95002 跟随 ----
  console.log('== C) 多选拖拽');
  await evalJs(`window.__osuStore.seek(4000); window.__osuStore.select([95001, 95002]); window.__osuStore.emit(); 'ok'`);
  await sleep(150);
  await evalJs(`window.__ev('mousedown', 2000, 0, 1); 'ok'`); // 95001 已在选区, mousedown 不改选区
  await evalJs(`window.__ev('mousemove', 2125, 0, 1); 'ok'`);
  await evalJs(`window.__ev('mouseup', 2125, 0, 0); 'ok'`);
  assert((await evalJs('window.__time(95001)')) === 2125, `anchor 2000->2125 (实际 ${await evalJs('window.__time(95001)')})`);
  assert((await evalJs('window.__time(95002)')) === 3125, `跟随物件 3000->3125 (实际 ${await evalJs('window.__time(95002)')})`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);

  // ---- D) J/K 快捷键 ----
  console.log('== D) J/K 前移后移');
  await evalJs(`window.__osuStore.select([95001]); window.__osuStore.emit(); 'ok'`);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' })); 'ok'`);
  assert((await evalJs('window.__time(95001)')) === 2125, `K 后移一个吸附 2000->2125 (实际 ${await evalJs('window.__time(95001)')})`);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); 'ok'`);
  assert((await evalJs('window.__time(95001)')) === 2000, `J 前移一个吸附 2125->2000 (实际 ${await evalJs('window.__time(95001)')})`);
  await evalJs(`window.__osuStore.undo(); 'ok'`);
  assert((await evalJs('window.__time(95001)')) === 2125, 'J/K 各一次 undo (撤销 J 回 2125)');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}

if (failures) { console.error(`\nVERIFIER_V32_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V32_CDP_PASSED');
