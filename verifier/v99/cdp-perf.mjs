// CDP v99 端到端: 1000 节点滑条渲染性能 (期望 <10ms)
// 布景: 1000 控制点 zigzag B 滑条 (硬角最坏形状, 横穿游玩区), length=8000
// A) 稳态帧 (路径/body 缓存命中): 最近 60 帧 renderPlayfield p95 < 10ms
// B) 冷帧 (__invalidatePath 后首帧: 路径剖分 + 等距重采样 + 离屏 body 描边全重算) < 10ms
// 运行: node verifier/v99/cdp-perf.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9419;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v99-'));
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
    ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__perfRender && window.__invalidatePath)');
  }
  if (!ready) throw new Error('应用未就绪 (含 __perfRender/__invalidatePath 探针)');
  await sleep(500);

  // 布景: 1000 控制点 zigzag B 滑条 (硬角最坏形状)
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      s.beatmap.timingPoints = [
        { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
      ];
      s.beatmap.difficulty.sliderMultiplier = 1;
      const cps = [];
      for (let i = 1; i < 1000; i++) cps.push({ x: i % 2 === 0 ? 480 : 30, y: Math.round(20 + (i * 340) / 999) });
      s.beatmap.hitObjects = [
        { id: 1, type: 'slider', x: 30, y: 20, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0,
          curveType: 'B', curvePoints: cps, slides: 1, length: 8000 },
      ];
      s.select([]);
      s.seek(1000);
      s.emit();
      return 'ok';
    })()
  `);
  // 等缓存建立 (稳态): 帧缓冲持续增长
  await sleep(1500);

  // ---- A) 稳态帧: 最近 60 帧 ----
  console.log('== A) 稳态帧 (缓存命中) 最近 60 帧 renderPlayfield 耗时');
  const warm = await evalJs(`JSON.stringify(window.__perfRender.slice(-60))`);
  const wf = JSON.parse(warm).sort((a, b) => a - b);
  const p50 = wf[Math.floor(wf.length * 0.5)], p95 = wf[Math.floor(wf.length * 0.95)], wmax = wf[wf.length - 1];
  console.log(`  稳态: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${wmax.toFixed(2)}ms (${wf.length} 帧)`);
  assert(wf.length >= 30, `采样帧数足够 (${wf.length})`);
  assert(p95 < 10, `稳态 p95 <10ms (实际 ${p95.toFixed(2)}ms)`);

  // ---- B) 冷帧: invalidatePath 后首帧 (路径剖分+重采样+body 描边全重算) ----
  console.log('== B) 冷帧 (__invalidatePath(1) 后首帧)');
  const cold = await evalJs(`
    (async () => {
      window.__perfRender.length = 0;
      window.__invalidatePath(1);
      const t0 = performance.now();
      while (window.__perfRender.length === 0 && performance.now() - t0 < 90000) {
        await new Promise(r => setTimeout(r, 50));
      }
      return JSON.stringify(window.__perfRender.slice(0, 3));
    })()
  `);
  const cf = JSON.parse(cold);
  console.log(`  冷帧: ${cf.map(v => v.toFixed(2) + 'ms').join(' / ')}`);
  assert(cf.length > 0, '冷帧已采样');
  assert(cf[0] < 10, `冷帧 <10ms (实际 ${cf[0].toFixed(2)}ms; 旧算法 1000 节点约数十秒)`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V99_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V99_CDP_PASSED');
