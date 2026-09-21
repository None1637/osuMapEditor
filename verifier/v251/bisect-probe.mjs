// v251 探针6: 二分定位 — 单次 seekWhilePlaying 是否即触发降质? 风暴是否必要?
// 三遍同窗口 [61s,64s]: A=干净重播; B=播放中单次 seekWhilePlaying(-0.5s) 后播回; C=滚轮风暴后播回
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG_PORT = 9442;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const electron = spawn(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ['.', `--remote-debugging-port=${DEBUG_PORT}`], { cwd: root, stdio: 'ignore' });
let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page');
  } catch { }
  if (!target) await sleep(500);
}
if (!target) { console.error('CONNECT_FAILED'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
}
try {
  await send('Runtime.enable');
  for (let i = 0; i < 60; i++) {
    if (await evalJs('!!(window.__osuStore && window.__osuMenuCmd)').catch(() => false)) break;
    await sleep(500);
  }
  await evalJs(`window.__osuMenuCmd({ type: 'open', folderRel: 'beatmap-639217845366573336-audio',
    file: 'cygnus - Book of Dark Magic (None1637) [Magic].osu' })`);
  for (let i = 0; i < 90; i++) {
    if (await evalJs('(window.__osuStore.audioBuffer?.duration ?? 0) > 100').catch(() => false)) break;
    await sleep(500);
  }
  await evalJs(`(() => { const s = window.__osuStore; s.seek(10000); s.play(); return 1; })()`);
  await sleep(300);
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); return 1; })()`);
  await evalJs(`(() => {
    const s = window.__osuStore; const actx = s.actx;
    const an = actx.createAnalyser(); an.fftSize = 16384; an.smoothingTimeConstant = 0.5;
    window.__anHit = an; s.ensureHitBus().connect(an);
    window.__hfTrace = []; window.__tracing = false;
    const data = new Float32Array(an.frequencyBinCount);
    const binHz = actx.sampleRate / 2 / an.frequencyBinCount;
    const i0 = Math.floor(16000 / binHz), i1 = Math.ceil(20000 / binHz);
    setInterval(() => {
      if (!window.__tracing) return;
      an.getFloatFrequencyData(data);
      let s2 = 0; for (let i = i0; i < i1; i++) s2 += Math.max(-200, data[i]);
      window.__hfTrace.push(+(s2 / (i1 - i0)).toFixed(1));
    }, 50);
    return 1;
  })()`);
  const MEAS = `(async () => {
    const s = window.__osuStore;
    while (s.positionMs() < 61000) await new Promise(r => setTimeout(r, 30));
    window.__hfTrace = []; window.__tracing = true;
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) await new Promise(r => setTimeout(r, 50));
    window.__tracing = false;
    const a = window.__hfTrace.slice(8); // 跳过 analyser 预热段
    return +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  })()`;

  const results = {};
  // A: 干净重播
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(60000); s.play(); return 1; })()`);
  await sleep(200);
  results.A_clean = await evalJs(MEAS);
  // B: 播放中单次 seekWhilePlaying
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(60000); s.play(); return 1; })()`);
  await sleep(200);
  await evalJs(`(async () => {
    const s = window.__osuStore;
    while (s.positionMs() < 61000) await new Promise(r => setTimeout(r, 30));
    s.seekWhilePlaying(s.positionMs() - 500); // 单次硬切回 ~0.5s
    return 1;
  })()`);
  results.B_singleSeek = await evalJs(MEAS);
  // C: 滚轮风暴
  await evalJs(`(() => { const s = window.__osuStore; s.pause(); s.seek(60000); s.play(); return 1; })()`);
  await sleep(200);
  await evalJs(`(async () => {
    const s = window.__osuStore;
    while (s.positionMs() < 61000) await new Promise(r => setTimeout(r, 30));
    for (let i = 0; i < 60 && s.positionMs() > 60100; i++) {
      s.wheelSeek(-120, 0);
      await new Promise(r => setTimeout(r, 60));
    }
    for (let i = 0; i < 20 && s.positionMs() < 59900; i++) {
      s.wheelSeek(120, 0);
      await new Promise(r => setTimeout(r, 60));
    }
    return 1;
  })()`);
  results.C_storm = await evalJs(MEAS);
  console.log('hit 16-20k 均值:', JSON.stringify(results));
  await evalJs('window.__osuStore.pause()');
} finally {
  try { electron.kill(); } catch { }
  await sleep(800);
}
process.exit(0);
