// CDP v82 端到端: 上方时间轴放置中滑条预览
// A) 未放置时预览位置暗 -> 放 2 个控制点后出现幻影条 (变亮) -> Escape 取消后消失
// 运行: node verifier/v82/cdp-v82.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v82-'));
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
  // 预览: pend (100,100)+(200,100) => 长 100px => time 2000 end 2500, 条中段 2250
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
      // 时间轴 canvas (高 92) 在 ms 处物件行 (y=30) 的亮度
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

  console.log('== A) 放置 2 控制点 => 幻影条出现; Escape => 消失');
  {
    const dark = await evalJs('window.__tlBright(2250)');
    await click(100, 100);
    await click(200, 100);
    const pendLen = await evalJs('window.__osuStore.pendingSlider.length');
    assert(pendLen === 2, `已放 2 个控制点 (实际 ${pendLen})`);
    await sleep(350);
    const lit = await evalJs('window.__tlBright(2250)');
    assert(lit - dark > 15, `幻影条增亮 (${dark.toFixed(0)} -> ${lit.toFixed(0)})`);
    // 条外 (3200, 超出 end 2500+尾圆半径) 不应被预览点亮
    const outside = await evalJs('window.__tlBright(3400)');
    assert(outside - dark < 15, `条外不增亮 (${outside.toFixed(0)})`);
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); "ok"`);
    await sleep(350);
    const gone = await evalJs('window.__tlBright(2250)');
    assert(Math.abs(gone - dark) < 10, `Escape 后幻影消失 (${gone.toFixed(0)} ≈ ${dark.toFixed(0)})`);
    assert((await evalJs('window.__osuStore.pendingSlider.length')) === 0, 'Escape 清空 pendingSlider');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V82_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V82_CDP_PASSED');
