// CDP v93 端到端: pattern 缩略图滑条串形修复
// 布景: 横向长滑条 + 纵向短滑条, 分别收藏
// A) 缩略图1 墨迹包围盒 宽>高 (横向)
// B) 缩略图2 墨迹包围盒 高>宽 (纵向) — 修复前会渲染成滑条1的形状(宽>高)
// 运行: node verifier/v93/cdp-v93.mjs   (需要 7100 端口 dev server 已启动)
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v93-'));
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
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)');
  }
  if (!ready) throw new Error('应用未就绪');
  await sleep(500);

  // 布景: 滑条1 横向 (100,100)->(300,100); 滑条2 纵向 (100,300)->(100,380)
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [
        { id: 1, type: 'slider', x: 100, y: 100, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
        { id: 2, type: 'slider', x: 100, y: 300, time: 3000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 100, y: 380 }], slides: 1, length: 80 },
      ];
      s.beatSnap = 4; s.distanceLock = false; s.gridSnap = false;
      s.loadPatternsIfNeeded();
      s.patterns = []; s.patternGroups = [];
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);
  await evalJs(`document.querySelector('[data-pattern-input="panel-toggle"]').click(); "ok"`);
  await sleep(400);
  // 分别收藏两个滑条
  await evalJs(`window.__osuStore.select([1]); "ok"`);
  await sleep(200);
  await evalJs(`document.querySelector('[data-pattern-input="collect"]').click(); "ok"`);
  await sleep(400);
  await evalJs(`window.__osuStore.select([2]); "ok"`);
  await sleep(200);
  await evalJs(`document.querySelector('[data-pattern-input="collect"]').click(); "ok"`);
  await sleep(500);

  const boxes = await evalJs(`
    (() => {
      // 白色墨迹 = 滑条白边环+头尾圆白环 (轨道纯黑实验样式下粉色轨道不再可测, 白边仍勾勒整条滑条形状)
      const ink = (r, g, b) => r > 150 && g > 150 && b > 150;
      const cs = [...document.querySelectorAll('[data-pattern-card] canvas')];
      return cs.map(c => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (ink(d[i], d[i + 1], d[i + 2])) {
            n++;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
        return { w: x1 - x0, h: y1 - y0, n };
      });
    })()
  `);
  assert(boxes.length === 2, `两张缩略图 (实际 ${boxes.length})`);
  if (boxes.length === 2) {
    console.log('== A) 缩略图1 (横向滑条) 白色墨迹包围盒');
    assert(boxes[0].n > 30 && boxes[0].w > boxes[0].h * 1.5,
      `宽>>高 (实际 ${boxes[0].w}x${boxes[0].h}, 白像素 ${boxes[0].n})`);
    console.log('== B) 缩略图2 (纵向滑条) 白色墨迹包围盒');
    assert(boxes[1].n > 30 && boxes[1].h > boxes[1].w * 1.3,
      `高>>宽 (实际 ${boxes[1].w}x${boxes[1].h}, 白像素 ${boxes[1].n}) — 修复前会渲染成滑条1的形状(宽>高)`);
  }

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V93_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V93_CDP_PASSED');
