// CDP v79/v80 端到端: 上方时间轴点击不改时间 + 尾圆命中 + 条中段兜底
// A) 点头圆 => 选中, 时间不变
// B) 点转盘尾圆 => 选中, 时间不变
// C) 点连体条中段 => v80 选中该物件 (barHit 兜底), 时间不变
// C2) 条区域按住拖动 => 仍进框选 (v50 语义保持)
// D) 右键条中段 => v80 也可删除
// E) 右键头圆 => 删除该物件
// 运行: node verifier/v79/cdp-v79.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9411;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v79-'));
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
  await sleep(500);

  // zoom=1, seek 4000 -> 窗口 [1000,7000]; circle 2000/3000 + spinner 5000..6000
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      const bm = s.beatmap;
      bm.editor.timelineZoom = 1;
      bm.hitObjects = [
        { id: 95001, type: 'circle', x: 100, y: 100, time: 2000, hitSound: 0, newCombo: true, comboSkip: 0 },
        { id: 95002, type: 'circle', x: 300, y: 100, time: 3000, hitSound: 0, newCombo: false, comboSkip: 0 },
        { id: 95003, type: 'spinner', x: 256, y: 192, time: 5000, endTime: 6000, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.select([]);
      s.seek(4000);
      s.emit();
      window.__tl = () => [...document.querySelectorAll('canvas')]
        .find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      window.__cx = (ms) => {
        const c = window.__tl();
        const r = c.getBoundingClientRect();
        const t0 = window.__osuStore.currentTime - 3000;
        return r.left + ((ms - t0) / 6000) * r.width;
      };
      window.__ev = (type, ms, btn, buttons) => {
        const c = window.__tl();
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, button: btn || 0, buttons: buttons ?? 0,
          clientX: window.__cx(ms), clientY: r.top + 30, // 物件行
        }));
      };
      window.__click = (ms) => { window.__ev('mousedown', ms, 0, 1); window.__ev('mouseup', ms, 0, 0); };
      window.__rclick = (ms) => {
        const c = window.__tl();
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, button: 2, clientX: window.__cx(ms), clientY: r.top + 30,
        }));
      };
      window.__ids = () => window.__osuStore.beatmap.hitObjects.map(o => o.id).join(',');
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 点头圆: 选中且时间不变');
  await evalJs(`window.__click(3000); 'ok'`);
  await sleep(250);
  assert(await evalJs('window.__osuStore.selected.has(95002)'), '选中 95002');
  assert((await evalJs('window.__osuStore.currentTime')) === 4000, `时间保持 4000 (实际 ${await evalJs('window.__osuStore.currentTime')})`);

  console.log('== B) 点转盘尾圆: 选中且时间不变');
  await evalJs(`window.__click(6000); 'ok'`);
  await sleep(250);
  assert(await evalJs('window.__osuStore.selected.has(95003)'), '尾圆命中选中 95003');
  assert((await evalJs('window.__osuStore.currentTime')) === 4000, '时间仍保持 4000');

  console.log('== C) 点连体条中段: v80 起选中该物件, 时间不变');
  await evalJs(`window.__click(5500); 'ok'`);
  await sleep(250);
  assert(await evalJs('window.__osuStore.selected.has(95003)'), '中段点击选中 95003 (barHit 兜底)');
  assert((await evalJs('window.__osuStore.currentTime')) === 4000, '时间仍保持 4000');

  console.log('== C2) 条区域按住拖动: 仍进框选 (v50 语义保持)');
  await evalJs(`window.__osuStore.clearSelection(); 'ok'`);
  await evalJs(`window.__ev('mousedown', 5350, 0, 1); 'ok'`);
  await evalJs(`window.__ev('mousemove', 5700, 0, 1); 'ok'`);
  await evalJs(`window.__ev('mouseup', 5700, 0, 0); 'ok'`);
  await sleep(250);
  {
    const sel = await evalJs(`[...window.__osuStore.selected].join(',')`);
    assert(sel === '95003', `拖动框选选中 [95003] (实际 [${sel}])`);
  }

  console.log('== D) 右键连体条中段: v80 起也可删除');
  await evalJs(`window.__rclick(5500); 'ok'`);
  await sleep(250);
  assert((await evalJs('window.__ids()')) === '95001,95002', `95003 已删 (实际 ${await evalJs('window.__ids()')})`);

  console.log('== E) 右键头圆: 删除单点');
  await evalJs(`window.__rclick(3000); 'ok'`);
  await sleep(250);
  assert((await evalJs('window.__ids()')) === '95001', `95002 已删 (实际 ${await evalJs('window.__ids()')})`);
  assert((await evalJs('window.__osuStore.currentTime')) === 4000, '全程时间未变');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V79_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V79_CDP_PASSED');
