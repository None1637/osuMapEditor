// CDP profile v245: 全选/播放两场景性能实测 (基线与优化后复测共用)
//   场景A: 合成 2000 物件谱面, Ctrl+A 全选, 静止 3s 测帧率/帧忙时/renderPlayfield 耗时
//   场景B: 合成 1000 绿线谱面, 播放 4s 测同一组指标
//   指标: fps (rAF 间隔), frameBusy (rAF 起 -> MessageChannel 回调 ≈ 渲染步结束, 含全部 rAF 循环 JS + 排版/绘制),
//         perfRender (window.__perfRender = renderPlayfield 单次耗时, v99 既有埋点)
//   240fps 目标对应 frameBusy < 4.17ms; 60fps 对应 < 16.7ms (无头软件渲染偏慢, 真机更快)
// 运行: node verifier/v245/profile.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9433;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v245-'));
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run',
  ...(process.env.PROFILE_SW ? ['--disable-gpu'] : []), // 默认走 GPU (headless=new 支持硬件加速); PROFILE_SW=1 强制软件渲染对照
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
if (!target) { console.error('EDGE_CONNECT_FAILED'); process.exit(2); }
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
  if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}

// CPU profiler: 采样期间聚合 selfTime 按函数 (文件:行), 返回 top N
async function cpuProfile(label, ms, during) {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 200 });
  await send('Profiler.start');
  const t0 = Date.now();
  if (during) await during();
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  const r = await send('Profiler.stop');
  const prof = r.result?.profile;
  if (!prof) throw new Error('Profiler.stop 无返回: ' + JSON.stringify(r).slice(0, 300));
  const byNode = new Map();
  for (const n of prof.nodes) byNode.set(n.id, n);
  const hits = new Map(); // key = fn@file:line -> {self, fn}
  (prof.samples ?? []).forEach((id, i) => {
    const n = byNode.get(id); if (!n) return;
    const dt = (prof.timeDeltas?.[i] ?? 1000) / 1000; // µs -> ms
    const cf = n.callFrame;
    const file = (cf.url || '').split('/').pop()?.split('?')[0] || '(anon)';
    const key = `${cf.functionName || '(anon)'} @ ${file}:${cf.lineNumber + 1}`;
    const e = hits.get(key) ?? { self: 0 };
    e.self += dt; hits.set(key, e);
  });
  const top = [...hits.entries()].sort((a, b) => b[1].self - a[1].self).slice(0, 25)
    .map(([k, v]) => ({ fn: k, ms: +v.self.toFixed(1) }));
  console.log(`-- CPU top (${label}) --`);
  for (const t of top) console.log(`   ${String(t.ms).padStart(8)}ms  ${t.fn}`);
  return top;
}

// 页面内测量函数: 3~4s rAF 探针, 帧间隔 + MessageChannel 帧忙时 + __perfRender 统计
const MEASURE_JS = (ms) => `(async () => new Promise(resolve => {
  const deltas = [], busy = [];
  const ch = new MessageChannel();
  let frameStart = 0, last = 0;
  ch.port1.onmessage = () => { busy.push(performance.now() - frameStart); };
  const t0 = performance.now();
  const tick = (ts) => {
    if (last) deltas.push(ts - last);
    last = ts; frameStart = performance.now();
    ch.port2.postMessage(0);
    if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
    else {
      const s = a => [...a].sort((x, y) => x - y);
      const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
      const avg = a => a.length ? a.reduce((v, s2) => v + s2, 0) / a.length : 0;
      const pr = window.__perfRender || [];
      resolve({
        frames: deltas.length, fps: +(1000 / avg(deltas)).toFixed(1),
        frameP95: +q(s(deltas), 0.95).toFixed(2),
        busyAvg: +avg(busy).toFixed(2), busyP95: +q(s(busy), 0.95).toFixed(2),
        renderAvg: +avg(pr).toFixed(2), renderP95: +q(s(pr), 0.95).toFixed(2),
      });
    }
  };
  window.__perfRender = [];
  requestAnimationFrame(tick);
}))()`;

try {
  await send('Runtime.enable');
  const ONLY = process.env.PROFILE_ONLY ? process.env.PROFILE_ONLY.split(',') : null; // v246: PROFILE_ONLY=C,D 单跑指定场景
  // v246: PROFILE_DSF/PROFILE_WIN 模拟用户机器 (Windows 125%/150% 缩放 → r.width*dpr 为分数,
  //   旧代码每帧重建 canvas 位图); 设置后刷新页面让 app 在新 dpr 下重新布局
  if (process.env.PROFILE_DSF) {
    const [ww, wh] = (process.env.PROFILE_WIN || '1440,900').split(',').map(Number);
    await send('Emulation.setDeviceMetricsOverride', {
      width: ww, height: wh, deviceScaleFactor: Number(process.env.PROFILE_DSF), mobile: false,
    });
    await send('Page.enable');
    await send('Page.reload', { ignoreCache: true });
    await sleep(2500);
  }
  // 等 app 启动并载入演示谱面
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false)) break;
    await sleep(500);
  }
  console.log('== 注入合成谱面 (页面 JS 按演示谱面模板克隆字段)');
  const info = await evalJs(`(() => {
    const store = window.__osuStore;
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const ts = base.hitObjects.find(o => o.type === 'slider');
    const red = base.timingPoints.find(p => p.uninherited);
    // 2000 物件: 单点/滑条交替, 300ms 间隔, 总跨度 600s (静止时约 4~6 个可见, 选中装饰全量 2000 个)
    const objs = [];
    for (let i = 0; i < 2000; i++) {
      const t = 5000 + i * 300;
      const x = 100 + (i * 37) % 312, y = 80 + (i * 53) % 224;
      if (i % 2 === 0) objs.push({ ...tc, id: 1000000 + i, time: t, x, y, endTime: t });
      else objs.push({
        ...ts, id: 1000000 + i, time: t, x, y,
        curvePoints: [{ x: x + 60, y: y - 40 }, { x: x + 120, y: y }, { x: x + 120, y: y + 60 }],
        curveType: 'B', slides: 1, length: 190, endTime: t + 280,
      });
    }
    // 1000 绿线: 1000..101000ms 每 100ms 一条 (100s 跨度, 6s 窗口约 60 条可见; 下时间轴全局视图全量画)
    const greens = [];
    for (let i = 0; i < 1000; i++) greens.push({
      time: 1000 + i * 100, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0,
      volume: 80, uninherited: false, effects: 0,
    });
    const timingPoints = [{ ...red, time: 0 }, ...greens].sort((a, b) => a.time - b.time);
    const bm = { ...base, hitObjects: objs, timingPoints };
    store.load(bm, store.audioUrl);
    return { objects: objs.length, greens: greens.length, audioUrl: !!store.audioUrl };
  })()`);
  console.log('  injected:', JSON.stringify(info));
  // 等音频解码完 (播放推进依赖 audioBuffer)
  // NOTE: A/B 注入的 2000/1000 谱面是场景C/D/E 的模板来源, 跳过时页面仍是初始演示谱面, 不影响
  for (let i = 0; i < 40; i++) {
    if (await evalJs('!!window.__osuStore.audioBuffer').catch(() => false)) break;
    await sleep(500);
  }

  let a, b, cRes, dRes, e;
  if (!ONLY || ONLY.includes('A')) {
  console.log('== 场景A: 2000 物件全选 (静止, select 工具)');
  await evalJs(`(() => {
    const store = window.__osuStore;
    store.pause && store.pause();
    store.tool = 'select';
    store.seek(60000);
    store.selected = new Set(store.beatmap.hitObjects.map(o => o.id));
    store.emitSelection();
    return store.selected.size;
  })()`);
  await sleep(800); // 缓存预热 (滑条身位图/路径)
  await cpuProfile('A 全选', 3200, async () => { a = await evalJs(MEASURE_JS(3000)); });
  console.log('  A:', JSON.stringify(a));
  }

  if (!ONLY || ONLY.includes('B')) {
  console.log('== 场景B: 1000 绿线播放');
  await evalJs(`(() => {
    const store = window.__osuStore;
    store.selected = new Set(); store.emitSelection();
    store.seek(30000);
    store.play();
    return store.playing;
  })()`);
  await sleep(500);
  await cpuProfile('B 播放', 4200, async () => { b = await evalJs(MEASURE_JS(4000)); });
  console.log('  B:', JSON.stringify(b));
  await evalJs('window.__osuStore.pause()');
  }

  if (exceptions.length) console.log('页面异常:', exceptions.slice(0, 3).join(' | '));

  // 场景C/D: 普通小谱面 (300 物件/30 绿线), 静止无选区 + 播放 — 回归对照 ("打开任意谱面" 场景)
  if (!ONLY || ONLY.includes('C') || ONLY.includes('D')) {
  console.log('== 场景C: 300 物件小谱面静止 (无选区)');
  await evalJs(`(() => {
    const store = window.__osuStore;
    store.pause();
    const base = store.beatmap;
    const objs = base.hitObjects.slice(0, 1); // 模板
    const tc = objs[0];
    const ts0 = base.hitObjects.find(o => o.type === 'slider') ?? tc;
    const ho = [];
    for (let i = 0; i < 300; i++) {
      const t = 3000 + i * 500;
      const x = 100 + (i * 37) % 312, y = 80 + (i * 53) % 224;
      if (i % 3 === 2) ho.push({ ...ts0, id: 2000000 + i, time: t, x, y, endTime: t + 400 });
      else ho.push({ ...tc, id: 2000000 + i, time: t, x, y, endTime: t });
    }
    const greens = [];
    for (let i = 0; i < 30; i++) greens.push({ time: 2000 + i * 4000, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 });
    const red = base.timingPoints.find(p => p.uninherited);
    store.load({ ...base, hitObjects: ho, timingPoints: [{ ...red, time: 0 }, ...greens].sort((a, b) => a.time - b.time) }, store.audioUrl);
    store.selected = new Set(); store.emitSelection();
    store.seek(20000);
    return ho.length;
  })()`);
  await sleep(800);
  if (!ONLY || ONLY.includes('C')) {
  await cpuProfile('C 静止', 3200, async () => { cRes = await evalJs(MEASURE_JS(3000)); });
  console.log('  C:', JSON.stringify(cRes));
  }
  }
  if (!ONLY || ONLY.includes('D')) {
  console.log('== 场景D: 300 物件小谱面播放');
  await evalJs('window.__osuStore.play()');
  await sleep(500);
  const dRes0 = await evalJs(MEASURE_JS(4000)); dRes = dRes0;
  console.log('  D:', JSON.stringify(dRes));
  await evalJs('window.__osuStore.pause()');
  }

  // 场景E (v246 用户复现用): 密集谱面播放 (默认 10ms 间隔 = 100 物件/秒, 同屏可见 ~200+;
  //   PROFILE_E_INTERVAL=50 → 20/s ≈ 300BPM 1/4 连打, 真实谱面极端密度)
  const eInterval = Number(process.env.PROFILE_E_INTERVAL || 10);
  const eCount = Math.floor(30000 / eInterval);
  if (!ONLY || ONLY.includes('E')) {
  console.log(`== 场景E: 密集谱面播放 (间隔 ${eInterval}ms = ${1000 / eInterval} 物件/秒)`);
  await evalJs(`(() => {
    const store = window.__osuStore;
    store.pause();
    const base = store.beatmap;
    const tc = base.hitObjects.find(o => o.type === 'circle');
    const red = base.timingPoints.find(p => p.uninherited);
    const ho = [];
    for (let i = 0; i < ${eCount}; i++) {
      const t = 3000 + i * ${eInterval};
      const x = 60 + (i * 47) % 392, y = 60 + (i * 31) % 264;
      ho.push({ ...tc, id: 3000000 + i, time: t, x, y, endTime: t });
    }
    store.load({ ...base, hitObjects: ho, timingPoints: [{ ...red, time: 0 }] }, store.audioUrl);
    store.selected = new Set(); store.emitSelection();
    store.seek(10000);
    return ho.length;
  })()`);
  await sleep(800);
  await evalJs('window.__osuStore.play()');
  await sleep(500);
  await cpuProfile('E 密集播放', 4200, async () => { e = await evalJs(MEASURE_JS(4000)); });
  console.log('  E:', JSON.stringify(e));
  await evalJs('window.__osuStore.pause()');
  }

  console.log(`\nPROFILE_RESULT ${JSON.stringify({ A: a, B: b, C: cRes, D: dRes, E: e })}`);
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(1200); // 等 Edge 进程退出释放 profile 目录句柄 (Windows EPERM 规避)
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 残留临时目录无害 */ }
}
