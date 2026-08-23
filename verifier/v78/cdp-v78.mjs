// CDP v78 端到端: 自定义网格中心
// A) 自定义原点影响放置吸附: 原点 (100,80) spacing 32 => (290,190) 落 (292,176); 关自定义后落默认格点 (288,192)
// B) 画布标记拖拽: 按下标记拖到 (150,120) => gridOrigin 跟随 (全工具可拖, circle 工具下验证)
// C) 标记像素: 拖拽后中心处为青色 #4df3ff
// D) UI: ◎ 中心开关切换 gridOriginCustom 且显示/隐藏 x/y 输入
// 运行: node verifier/v78/cdp-v78.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v78-'));
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
async function click(x, y) { await down(x, y); await sleep(60); await up(x, y); await sleep(150); }
// 采样 osu 坐标处主画布像素 [r,g,b]
const colorAt = (ox, oy) => evalJs(`
  (() => {
    const c = [...document.querySelectorAll('canvas')].find(c => c.className.includes('cursor-crosshair'));
    if (!c) return null;
    const g = c.getContext('2d');
    const rect = c.getBoundingClientRect();
    const cl = window.__osuToClient(${ox}, ${oy});
    const dx = Math.round((cl.x - rect.left) * (c.width / rect.width)), dy = Math.round((cl.y - rect.top) * (c.height / rect.height));
    const d = g.getImageData(dx, dy, 1, 1).data;
    return [d[0], d[1], d[2]];
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
      s.setGridOriginCustom(false); s.setGridOrigin({ x: 256, y: 192 });
      s.tool = 'circle';
      s.seek(1000);
      s.clearSelection();
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(300);

  console.log('== A) 自定义原点影响放置吸附 (原点 (100,80), 方形 spacing 32)');
  {
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.gridSnap = true; s.gridType = 'square'; s.gridSpacing = 32; s.gridRotation = 0;
        s.setGridOriginCustom(true); s.setGridOrigin({ x: 100, y: 80 });
        s.emit();
        return 'ok';
      })()
    `);
    await sleep(200);
    await click(290, 190);
    const r1 = await evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects[0]; return [o.x, o.y]; })()`);
    assert(r1 && Math.abs(r1[0] - 292) <= 1 && Math.abs(r1[1] - 176) <= 1, `自定义原点吸附 (${r1}) 期望 (292,176)`);
    await evalJs(`window.__osuStore.setGridOriginCustom(false); window.__osuStore.emit(); "ok"`);
    await sleep(200);
    await click(290, 190);
    const r2 = await evalJs(`(() => { const o = window.__osuStore.beatmap.hitObjects[1]; return [o.x, o.y]; })()`);
    assert(r2 && Math.abs(r2[0] - 288) <= 1 && Math.abs(r2[1] - 192) <= 1, `关自定义后回归默认格点 (${r2}) 期望 (288,192)`);
  }

  console.log('== B) 画布标记拖拽 (circle 工具下全工具可拖, 网格吸附开着也不吸自身网格)');
  {
    await evalJs(`
      (() => {
        const s = window.__osuStore;
        s.gridSnap = true; s.gridType = 'square'; s.gridSpacing = 32; s.gridRotation = 0; // 若误做网格吸附会落到 (132,112)
        s.setGridOriginCustom(true); s.setGridOrigin({ x: 100, y: 80 });
        s.emit();
        return 'ok';
      })()
    `);
    await sleep(250);
    await down(100, 80);
    await sleep(80);
    for (let i = 1; i <= 6; i++) { await move(100 + (150 - 100) * i / 6, 80 + (120 - 80) * i / 6); await sleep(30); }
    await up(150, 120);
    await sleep(300);
    const g = await evalJs(`[window.__osuStore.gridOrigin.x, window.__osuStore.gridOrigin.y]`);
    assert(Math.abs(g[0] - 150) <= 1 && Math.abs(g[1] - 120) <= 1, `标记拖拽后 gridOrigin (${g}) 期望 (150,120)`);
    const n = await evalJs(`window.__osuStore.beatmap.hitObjects.length`);
    assert(n === 2, `拖拽标记未误放物件 (共 ${n} 个)`);
  }

  console.log('== C) 标记像素为青色 #4df3ff');
  {
    await mouse('mouseMoved', 450, 320, { buttons: 0 }); // 光标移开, 避免 circle 工具放置预览盖住标记
    await sleep(300);
    // 中心附近 3x3 (±2 osu px) 扫采样, 规避坐标往返舍入落在抗锯齿边缘
    let hit = null;
    for (const dx of [-2, 0, 2]) for (const dy of [-2, 0, 2]) {
      const px = await colorAt(150 + dx, 120 + dy);
      if (px && px[2] > 200 && px[1] > 180 && px[0] < 150) { hit = px; break; }
    }
    assert(hit, `中心附近存在青色像素 rgb(${hit}) 近 #4df3ff`);
  }

  console.log('== D) UI: ◎ 中心开关 + x/y 输入');
  {
    await evalJs(`window.__osuStore.setGridOriginCustom(false); window.__osuStore.emit(); "ok"`);
    await sleep(200);
    await evalJs(`document.querySelector('[data-grid-input="origin-toggle"]').click(); "ok"`);
    await sleep(250);
    const on = await evalJs(`window.__osuStore.gridOriginCustom`);
    const hasInputs = await evalJs(`!!(document.querySelector('[data-grid-input="origin-x"]') && document.querySelector('[data-grid-input="origin-y"]'))`);
    assert(on === true && hasInputs, '点击开关后 custom=true 且 x/y 输入出现');
    await evalJs(`document.querySelector('[data-grid-input="origin-toggle"]').click(); "ok"`);
    await sleep(250);
    const off = await evalJs(`window.__osuStore.gridOriginCustom`);
    const inputsGone = await evalJs(`!document.querySelector('[data-grid-input="origin-x"]')`);
    assert(off === false && inputsGone, '再次点击后 custom=false 且输入隐藏');
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V78_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V78_CDP_PASSED');
