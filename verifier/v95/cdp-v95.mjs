// CDP v95 端到端: 新建滑条尾端吸附节拍 (lazer FindSnappedDistance)
// 布景: 红线 0/500, SM 1.4 => vel 0.28 px/ms, beatSnap 4 => tick 125ms = 35px
// A) 几何 160px 滑条 => 落盘 length=140 (4 tick, 5 tick=175 超几何), time=1000, 尾端 1500 恰在 tick 上
//    且与时间轴预览区间 (pendingSliderTimeline) 完全一致 (预览=落盘)
// B) 几何 110px 滑条 => length=105 (3 tick, round 3.14->3 未超)
// 运行: node verifier/v95/cdp-v95.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v95-'));
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
async function mouse(type, osuX, osuY, opts = {}) {
  const c = await evalJs(`window.__osuToClient(${osuX}, ${osuY})`);
  await send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', buttons: type === 'mouseMoved' ? 1 : 0, clickCount: 1, ...opts });
}
async function click(x, y) { await mouse('mousePressed', x, y); await sleep(60); await mouse('mouseReleased', x, y); await sleep(150); }

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');
  await sleep(500);

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.difficulty.sliderMultiplier = 1.4;
      s.beatmap.hitObjects = [];
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.tool = 'slider';
      s.pendingSlider = []; s.pendingCursor = null;
      s.seek(1000);
      s.clearSelection();
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 几何 160px 滑条 => 落盘 4 tick=140, 尾端在 tick 上, 预览=落盘');
  {
    await click(100, 100);
    await click(260, 100);
    await sleep(300);
    const pv = await evalJs(`
      import('/src/osu/sliderPath.ts').then(m => {
        const s = window.__osuStore;
        return m.pendingSliderTimeline(s.beatmap.timingPoints, s.beatmap.difficulty.sliderMultiplier,
          s.pendingSlider, null, s.currentTime, s.beatSnap, s.distanceLock, s.beatmap.editor.distanceSpacing);
      })
    `);
    await mouse('mousePressed', 260, 100, { clickCount: 2 });
    await sleep(60);
    await mouse('mouseReleased', 260, 100, { clickCount: 2 });
    await sleep(400);
    const o = await evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects[0];
      return o ? { time: o.time, length: o.length, type: o.type, pending: window.__osuStore.pendingSlider.length } : null; })()`);
    assert(o !== null && o.type === 'slider' && o.pending === 0, '滑条已落盘');
    if (o) {
      assert(o.time === 1000, `time=1000 (实际 ${o.time})`);
      assert(o.length === 140, `length=140 (4 tick; 实际 ${o.length})`);
      // 尾端 = time + length/vel, vel=0.28 => 1000+500=1500, (1500-0)/125 整除 => 在 tick 上
      const end = o.time + o.length / 0.28;
      assert(Math.abs(end - 1500) < 1 && Math.abs((end / 125) - Math.round(end / 125)) < 0.01,
        `尾端 1500 恰在 tick 上 (实际 ${end})`);
      assert(pv && pv.time === o.time && Math.abs(pv.end - end) < 1,
        `预览=落盘 (预览 ${pv?.time}~${pv?.end}, 落盘 ${o.time}~${end})`);
    }
  }

  console.log('== B) 几何 110px 滑条 => 落盘 3 tick=105');
  {
    await evalJs(`window.__osuStore.seek(2000); window.__osuStore.emit(); "ok"`);
    await sleep(200);
    await click(100, 300);
    await click(210, 300);
    await sleep(300);
    await mouse('mousePressed', 210, 300, { clickCount: 2 });
    await sleep(60);
    await mouse('mouseReleased', 210, 300, { clickCount: 2 });
    await sleep(400);
    const o = await evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects[1];
      return o ? { time: o.time, length: o.length } : null; })()`);
    assert(o !== null, '第二条滑条已落盘');
    if (o) {
      assert(o.time === 2000, `time=2000 (实际 ${o.time})`);
      assert(o.length === 105, `length=105 (3 tick; 实际 ${o.length})`);
    }
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V95_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V95_CDP_PASSED');
