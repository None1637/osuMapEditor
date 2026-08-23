// CDP v98 端到端: 上方时间轴折返标记 = 皮肤 reversearrow (回退皮肤 = 白色 chevron)
// 布景: slides=3 滑条, sliderMultiplier=1/beatLength=500 -> 单程 1000ms, repeat 节点在 2000/3000
// A) repeat 节点处白像素数远大于旧圆点 (π*3.5² ≈ 38)
// B) 方向: s=1 (尾端) 箭头朝左 -> 白像素质心在节点左侧; s=2 (头端) 朝右 -> 质心在右侧
// 运行: node verifier/v98/cdp-v98.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9418;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v98-'));
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

  // 布景: slides=3 直线滑条, 单程 1000ms (sliderMultiplier=1 -> vel=100/500=0.2 px/ms, length=200)
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.difficulty.sliderMultiplier = 1;
      s.beatmap.hitObjects = [
        { id: 1, type: 'slider', x: 100, y: 200, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 200 }], slides: 3, length: 200 },
      ];
      s.select([]);
      s.seek(2500); // 滑条 (1000..4000) 居中于 6000ms 窗口, repeat 节点 2000/3000
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(600);

  // 探针: 时间轴 canvas 上 repeat 节点处白像素统计 (页内镜像 x(ms) 映射)
  const probe = await evalJs(`JSON.stringify((() => {
    const s = window.__osuStore;
    const c = [...document.querySelectorAll('canvas')].find(cv => cv.className.includes('h-[92px]'));
    if (!c) return { err: 'no timeline canvas' };
    const g = c.getContext('2d');
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
    const t0 = s.currentTime - win / 2;
    const x = (ms) => ((ms - t0) / win) * rect.width;
    const cy = 30; // OBJ_H/2
    const stat = (ms) => {
      const tx = x(ms);
      const x0 = Math.round((tx - 18) * dpr), y0 = Math.round((cy - 18) * dpr);
      const w = Math.round(36 * dpr);
      const d = g.getImageData(x0, y0, w, Math.round(36 * dpr)).data;
      // 箭头判别: 箭头头部 (三角) 纵向跨度大于杆部 -> 比较左/右半窗白像素纵向跨度
      let n = 0, lMin = 1e9, lMax = -1, rMin = 1e9, rMax = -1;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        if (r > 150 && gg > 150 && b > 150) {
          n++;
          const col = (i / 4) % w, row = Math.floor(i / 4 / w);
          if (col < w / 2) { if (row < lMin) lMin = row; if (row > lMax) lMax = row; }
          else { if (row < rMin) rMin = row; if (row > rMax) rMax = row; }
        }
      }
      return { tx, n, spanL: lMax - lMin, spanR: rMax - rMin };
    };
    return { s1: stat(2000), s2: stat(3000), dpr };
  })())`);
  const p = JSON.parse(probe);
  if (p.err) throw new Error(p.err);
  console.log(`  s=1 节点 tx=${p.s1.tx.toFixed(1)} 白像素=${p.s1.n} 左跨=${p.s1.spanL} 右跨=${p.s1.spanR}`);
  console.log(`  s=2 节点 tx=${p.s2.tx.toFixed(1)} 白像素=${p.s2.n} 左跨=${p.s2.spanL} 右跨=${p.s2.spanR}`);
  assert(p.s1.n > 80, `s=1 节点白像素 ≫ 旧圆点 38 (实际 ${p.s1.n}) — 箭头贴图`);
  assert(p.s2.n > 80, `s=2 节点白像素 ≫ 旧圆点 38 (实际 ${p.s2.n}) — 箭头贴图`);
  assert(p.s1.spanL > p.s1.spanR + 2, `s=1 (尾端) 箭头朝左: 左半窗纵向跨度大 (头在左; ${p.s1.spanL} vs ${p.s1.spanR})`);
  assert(p.s2.spanR > p.s2.spanL + 2, `s=2 (头端) 箭头朝右: 右半窗纵向跨度大 (头在右; ${p.s2.spanR} vs ${p.s2.spanL})`);

  // 截图存档 (人工复核)
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v98-repeat-arrow.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  截图: verifier/runs/v98-repeat-arrow.png');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V98_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V98_CDP_PASSED');
