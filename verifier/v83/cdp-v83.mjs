// CDP v83 端到端: 收敛后行为不变 + 预览=落盘一致
// A) 放置预览幻影仍出现 (共用绘制后渲染不变)
// B) 双击落盘: 物件 time/length 与预览区间 (pendingSliderTimeline) 完全一致 (预览=落盘)
// C) 落盘后真实滑条绘制不变 (连体条仍亮, combo 染色)
// 运行: node verifier/v83/cdp-v83.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v83-'));
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

  // 红线 1000/500 (vel=0.2px/ms), seek 2000, zoom 1 => 窗口 [-1000,5000]
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [];
      s.beatmap.editor.timelineZoom = 1;
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.tool = 'slider';
      s.pendingSlider = []; s.pendingCursor = null;
      s.seek(2000);
      s.clearSelection();
      s.emit();
      window.__tlBright = (ms) => {
        const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
        const r = c.getBoundingClientRect();
        const t0 = window.__osuStore.currentTime - 3000;
        const cx = r.left + ((ms - t0) / 6000) * r.width;
        const g = c.getContext('2d');
        const dx = Math.round((cx - r.left) * (c.width / r.width)), dy = Math.round(30 * (c.height / r.height));
        const d = g.getImageData(dx, dy, 1, 1).data;
        return (d[0] + d[1] + d[2]) / 3;
      };
      return 'ok';
    })()
  `);
  await sleep(400);

  console.log('== A) 共用绘制后放置预览幻影仍出现');
  {
    const dark = await evalJs('window.__tlBright(2250)');
    await click(100, 100);
    await click(200, 100);
    await sleep(350);
    const lit = await evalJs('window.__tlBright(2250)');
    assert(lit - dark > 15, `幻影条增亮 (${dark.toFixed(0)} -> ${lit.toFixed(0)})`);
  }

  console.log('== B) 双击落盘: time/length 与预览区间一致 (预览=落盘)');
  {
    const pv = await evalJs(`
      Promise.all([import('/src/osu/sliderPath.ts'), import('/src/osu/parser.ts')]).then(([m, p]) => {
        const s = window.__osuStore;
        const r = m.pendingSliderTimeline(s.beatmap.timingPoints, s.beatmap.difficulty.sliderMultiplier,
          s.pendingSlider, null, s.currentTime, s.beatSnap, s.distanceLock, s.beatmap.editor.distanceSpacing);
        return { ...r, vel: p.sliderVelocityAt(s.beatmap.timingPoints, s.currentTime, s.beatmap.difficulty.sliderMultiplier) };
      })
    `);
    await mouse('mousePressed', 200, 100, { clickCount: 2 });
    await sleep(60);
    await mouse('mouseReleased', 200, 100, { clickCount: 2 });
    await sleep(400);
    const o = await evalJs(`(() => {
      const s = window.__osuStore;
      const o = s.beatmap.hitObjects[0];
      return o ? { time: o.time, length: o.length, type: o.type, pending: s.pendingSlider.length } : null;
    })()`);
    assert(o !== null && o.type === 'slider', '落盘生成滑条');
    if (o) {
      assert(o.time === pv.time, `time = 预览 ${pv.time} (实际 ${o.time})`);
      const expectLen = Math.round((pv.end - pv.time) * pv.vel);
      assert(Math.abs(o.length - expectLen) <= 1, `length = 预览换算 ${expectLen} (实际 ${o.length})`);
      assert(o.pending === 0, '落盘后 pendingSlider 清空');
    }
  }

  console.log('== C) 真实滑条绘制不变 (连体条仍亮)');
  {
    await sleep(300);
    const lit = await evalJs('window.__tlBright(2250)');
    const outside = await evalJs('window.__tlBright(3400)');
    assert(lit > 30, `真实连体条亮 (${lit.toFixed(0)})`);
    assert(outside < 25, `条外仍暗 (${outside.toFixed(0)})`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V83_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V83_CDP_PASSED');
