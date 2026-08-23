// CDP v76 端到端: 放置预览幻影尾点手柄 + 节点拖拽物件/网格吸附
// A) 放置中移动光标 => 光标处出现白色控制点手柄 (幻影尾点), 未移到时没有
// B) 节点拖拽物件吸附: 拖控制点到可见 circle 附近 (<6.4px) => 吸附到 circle 位置
// C) 节点拖拽网格吸附: 开方形网格 (spacing 32) 拖控制点 => 落网格交点
// 运行: node verifier/v76/cdp-v76.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v76-'));
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
async function mouse(type, osuX, osuY, opts = {}) {
  const c = await evalJs(`window.__osuToClient(${osuX}, ${osuY})`);
  await send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', buttons: type === 'mouseMoved' ? 1 : 0, clickCount: 1, ...opts });
}
const down = (x, y, o) => mouse('mousePressed', x, y, o);
const up = (x, y, o) => mouse('mouseReleased', x, y, o);
const move = (x, y) => mouse('mouseMoved', x, y);
const hover = (x, y) => mouse('mouseMoved', x, y, { buttons: 0 });
async function click(x, y) { await down(x, y); await sleep(60); await up(x, y); await sleep(150); }
const clearAll = () => evalJs(`
  window.__osuStore.beatmap.hitObjects = [];
  window.__osuStore.pendingSlider = [];
  window.__osuStore.gridSnap = false;
  window.__osuStore.clearSelection();
  window.__osuStore.emit(); "ok"
`);
// 采样 osu 坐标处主画布像素亮度 (r+g+b)/3
const brightnessAt = (ox, oy) => evalJs(`
  (() => {
    const c = [...document.querySelectorAll('canvas')].find(c => c.className.includes('cursor-crosshair'));
    if (!c) return -1;
    const g = c.getContext('2d');
    const rect = c.getBoundingClientRect();
    const cl = window.__osuToClient(${ox}, ${oy});
    const dx = Math.round((cl.x - rect.left) * (c.width / rect.width)), dy = Math.round((cl.y - rect.top) * (c.height / rect.height));
    const d = g.getImageData(dx, dy, 1, 1).data;
    return (d[0] + d[1] + d[2]) / 3;
  })()
`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');

  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [];
      s.beatmap.editor.timelineZoom = 1;
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.tool = 'slider';
      s.seek(1000);
      s.clearSelection();
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== A) 放置预览: 光标处显示幻影尾点手柄');
  {
    await click(100, 100);
    await click(200, 100);
    await hover(200, 100); // 光标停在末点上: 无幻影
    await sleep(250);
    const dark = await brightnessAt(300, 160);
    await hover(300, 160); // 光标远离末点: 幻影尾点手柄
    await sleep(250);
    const lit = await brightnessAt(300, 160);
    assert(dark >= 0 && lit - dark > 50, `幻影尾点手柄增亮 (${dark.toFixed(0)} -> ${lit.toFixed(0)})`);
    await clearAll();
    await sleep(200);
  }

  console.log('== B) 节点拖拽物件吸附 (<6.4px => 吸附到 circle 位置)');
  {
    await evalJs(`window.__osuStore.tool = 'slider'; window.__osuStore.emit(); "ok"`);
    await click(100, 100);
    await click(200, 100);
    await down(200, 100, { clickCount: 2 }); await sleep(60); await up(200, 100, { clickCount: 2 }); // 双击结束
    await sleep(350);
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.addObject({ id: 8001, type: 'circle', x: 300, y: 200, time: 1000, newCombo: false, comboSkip: 0, hitSound: 0 });
        s.tool = 'select';
        const sl = s.beatmap.hitObjects.find(o => o.type === 'slider');
        s.select([sl.id]);
        s.emit();
        return 'ok';
      })()
    `);
    await sleep(250);
    // 拖尾部控制点 (200,100) 到 circle 附近 (296,201) (距离 (300,200) ≈4.1 < 6.4)
    await down(200, 100);
    await sleep(80);
    for (let i = 1; i <= 6; i++) { await move(200 + (296 - 200) * i / 6, 100 + (201 - 100) * i / 6); await sleep(30); }
    await up(296, 201);
    await sleep(300);
    const r = await evalJs(`(() => {
      const sl = window.__osuStore.beatmap.hitObjects.find(o => o.type === 'slider');
      return [sl.curvePoints[0].x, sl.curvePoints[0].y];
    })()`);
    assert(Math.abs(r[0] - 300) <= 1 && Math.abs(r[1] - 200) <= 1, `控制点吸附到 circle (${r[0]},${r[1]})`);
    await clearAll();
    await sleep(200);
  }

  console.log('== C) 节点拖拽网格吸附 (方形 spacing 32, 原点 (256,192))');
  {
    await evalJs(`window.__osuStore.tool = 'slider'; window.__osuStore.emit(); "ok"`);
    await click(100, 100);
    await click(200, 100);
    await down(200, 100, { clickCount: 2 }); await sleep(60); await up(200, 100, { clickCount: 2 });
    await sleep(350);
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.tool = 'select';
        s.gridSnap = true; s.gridType = 'square'; s.gridSpacing = 32; s.gridRotation = 0;
        const sl = s.beatmap.hitObjects.find(o => o.type === 'slider');
        s.select([sl.id]);
        s.emit();
        return 'ok';
      })()
    `);
    await sleep(250);
    // 拖头部控制点 (100,100) 到 (290,190) => 方形网格吸附 (288,192)
    await down(100, 100);
    await sleep(80);
    for (let i = 1; i <= 8; i++) { await move(100 + (290 - 100) * i / 8, 100 + (190 - 100) * i / 8); await sleep(30); }
    await up(290, 190);
    await sleep(300);
    const r = await evalJs(`(() => {
      const sl = window.__osuStore.beatmap.hitObjects.find(o => o.type === 'slider');
      return [sl.x, sl.y];
    })()`);
    assert(Math.abs(r[0] - 288) <= 1 && Math.abs(r[1] - 192) <= 1, `头部控制点吸附到网格交点 (${r[0]},${r[1]})`);
    await evalJs(`window.__osuStore.gridSnap = false; "ok"`);
    await clearAll();
    await sleep(200);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V76_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V76_CDP_PASSED');
