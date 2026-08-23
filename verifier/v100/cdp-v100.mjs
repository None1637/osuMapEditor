// CDP v100 端到端: 用户场景 — 皮肤 hitcircle 全透明 + 无 sliderstartcircle, 滑条头应与 note 渲染一致
// 页内 mock FsDirLike 皮肤目录: 只提供 hitcircle.png (全透明) + hitcircleoverlay.png (白环)
// A) 应用皮肤后滑条头中心不再实心染色 (与 note 中心同为暗色)
// B) 滑条头与 note 白环都在 (overlay 原色)
// 运行: node verifier/v100/cdp-v100.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9420;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v100-'));
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
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuSkin && window.__osuToCanvas)');
  }
  if (!ready) throw new Error('应用未就绪');
  await sleep(500);

  // 布景: 滑条 (256,192)->(400,192) + 单点 (128,192), 同 combo => 同 tint
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.hitObjects = [
        { id: 1, type: 'slider', x: 256, y: 192, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'L', curvePoints: [{ x: 400, y: 192 }], slides: 1, length: 144 },
        { id: 2, type: 'circle', x: 128, y: 192, time: 1500, hitSound: 0, newCombo: false, comboSkip: 0 },
      ];
      s.select([]);
      s.seek(1000);
      s.emit();
      return 'ok';
    })()
  `);
  await sleep(400);

  // 应用 mock 皮肤: hitcircle 全透明 + hitcircleoverlay 白环, 无 sliderstart/endcircle
  const applied = await evalJs(`
    (async () => {
      const mk = (draw) => new Promise(res => {
        const c = document.createElement('canvas'); c.width = c.height = 128;
        draw(c.getContext('2d'));
        c.toBlob(b => res(new File([b], 'x.png', { type: 'image/png' })), 'image/png');
      });
      const transparent = await mk(() => {});
      const ring = await mk(g => { g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke(); });
      const dir = {
        getFileHandle: async (name) => {
          if (name === 'hitcircle.png') return { getFile: async () => transparent };
          if (name === 'hitcircleoverlay.png') return { getFile: async () => ring };
          throw new Error('not found: ' + name);
        },
      };
      return JSON.stringify(await window.__osuSkin.applySkinFromDir(dir, 'mock-transparent'));
    })()
  `);
  console.log('  皮肤应用:', applied);
  // seek 到滑条中段: 滑条球离开头部 (t=1000 球正压在头上会干扰探针), 单点 (1500) 完全淡入
  await evalJs(`window.__osuStore.seek(1500); 'ok'`);
  await sleep(600);

  // 探针: 滑条头/单点 中心 (避开数字: 左上 r*0.4) 与 白环 (右缘 r*0.85)
  const probe = await evalJs(`JSON.stringify((() => {
    const s = window.__osuStore;
    const r = 54.4 - 4.48 * s.beatmap.difficulty.cs;
    const c = document.querySelector('canvas.cursor-crosshair');
    const g = c.getContext('2d');
    const px = (x, y) => {
      const p = window.__osuToCanvas(x, y);
      const d = g.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
      return Math.max(d[0], d[1], d[2]);
    };
    return {
      sliderCenter: px(256 - r * 0.4, 192 - r * 0.4),
      circleCenter: px(128 - r * 0.4, 192 - r * 0.4),
      sliderRing: px(256 + r * 0.85, 192),
      circleRing: px(128 + r * 0.85, 192),
    };
  })())`);
  const p = JSON.parse(probe);
  console.log(`  滑条头: 中心=${p.sliderCenter} 环=${p.sliderRing} | 单点: 中心=${p.circleCenter} 环=${p.circleRing}`);
  assert(p.sliderCenter < 80, `滑条头中心不再实心染色 (实际 ${p.sliderCenter}; 修复前 = 实心 combo 色填充)`);
  assert(p.circleCenter < 80, `单点中心同为暗色 (实际 ${p.circleCenter})`);
  assert(Math.abs(p.sliderCenter - p.circleCenter) < 40, `滑条头与 note 中心一致 (差 ${Math.abs(p.sliderCenter - p.circleCenter)})`);
  assert(p.sliderRing > 150, `滑条头白环在 (实际 ${p.sliderRing})`);
  assert(p.circleRing > 150, `单点白环在 (实际 ${p.circleRing})`);

  // 截图存档 (人工复核)
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'v100-slider-head.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('  截图: verifier/runs/v100-slider-head.png');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V100_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V100_CDP_PASSED');
