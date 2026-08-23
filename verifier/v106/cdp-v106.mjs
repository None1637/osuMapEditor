// CDP v106 端到端: 波形/频谱对齐 + 频谱逐列自适应
//   T1 波形 500ms 冲激峰值落在 x(480)±2px (v112: +20ms lazer 显示偏移 WAVEFORM_VISUAL_OFFSET 生效)
//   T2 频谱无方格 (噪声信号区不存在连续 4 列完全相同 — 旧 21.3ms 帧阵列在 5ms/px 下会出 ~4 列同值)
//   T3 频谱冲激列对齐 (亮列 ≈ x(480), ±2px; 窗口居中后不再右偏半窗, 显示偏移后整体左移 20ms)
// 运行: node verifier/v106/cdp-v106.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9426;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v106-'));
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
  await sleep(400);

  // 布景: 1s WAV = 低幅白噪声 (防同色相邻列) + 500ms 满幅冲激
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      const sr = 22050, n = sr;
      const buf = new ArrayBuffer(44 + n * 2);
      const dv = new DataView(buf);
      const ws = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
      ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
      dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * 2, true);
      let seed = 42;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round((rnd() * 2 - 1) * 1600), true); // ±0.05 噪声
      dv.setInt16(44 + Math.round(sr * 0.5) * 2, 32767, true); // 500ms 冲激
      s.setAudio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
      s.seek(500);
      return 'ok';
    })()
  `);
  let hasBuf = false;
  for (let i = 0; i < 30 && !hasBuf; i++) { await sleep(300); hasBuf = await evalJs('!!window.__osuStore.getAudioBuffer()'); }
  assert(hasBuf, '布景: 合成 WAV 解码出 AudioBuffer');

  await evalJs(`window.__osuStore.setWavePanelOpen(true); 'ok'`);
  await sleep(600);

  // T1: 波形模式 — 冲激峰值列 = x(480) ± 2px (v112: +20ms lazer 显示偏移生效; 无偏移会在 x(500))
  const r1 = await evalJs(`
    (() => {
      const s = window.__osuStore;
      const cv = document.querySelector('[data-wave="canvas"]');
      const g = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const img = g.getImageData(0, 0, cv.width, cv.height).data;
      let peakCol = -1, peakH = 0;
      for (let cx = 0; cx < cv.width; cx++) {
        let h = 0;
        for (let y = 0; y < cv.height; y++) {
          const o = (y * cv.width + cx) * 4;
          if (img[o + 1] > 120) h++;
        }
        if (h > peakH) { peakH = h; peakCol = cx; }
      }
      const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
      const t0 = s.currentTime - win / 2;
      const xOf = (ms) => ((ms - t0) / win) * (cv.width / dpr);
      return JSON.stringify({ peakCssX: peakCol / dpr, peakH, x500: xOf(500), x480: xOf(480) });
    })()
  `);
  const p1 = JSON.parse(r1);
  console.log('  T1 峰值列:', r1);
  assert(p1.peakH > 0, `T1 波形有亮绿峰值列 (h=${p1.peakH})`);
  assert(Math.abs(p1.peakCssX - p1.x480) <= 2, `T1 峰值在 x(480)±2px — v112 lazer 显示偏移 +20ms 生效 (实际 ${p1.peakCssX.toFixed(1)} vs ${p1.x480.toFixed(1)}; 无偏移会在 ${p1.x500.toFixed(1)})`);

  // 切频谱模式
  await evalJs(`document.querySelector('[data-wave="mode-spectro"]').click(); 'ok'`);
  await sleep(1200); // 逐列首绘 ~1200 列 FFT, 留足时间

  // T2 + T3: 读频谱位图
  const r2 = await evalJs(`
    (() => {
      const s = window.__osuStore;
      const cv = document.querySelector('[data-wave="canvas"]');
      const g = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const img = g.getImageData(0, 0, cv.width, cv.height).data;
      const colSig = (cx) => { // 列签名 (抽样 16 行的 RGBA)
        let sig = '';
        for (let y = 0; y < cv.height; y += Math.max(1, cv.height >> 4)) {
          const o = (y * cv.width + cx) * 4;
          sig += img[o] + ',' + img[o + 1] + ',' + img[o + 2] + ',' + img[o + 3] + ';';
        }
        return sig;
      };
      const colBright = (cx) => {
        let b = 0;
        for (let y = 0; y < cv.height; y++) { const o = (y * cv.width + cx) * 4; b += img[o] + img[o + 1] + img[o + 2]; }
        return b;
      };
      const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
      const t0 = s.currentTime - win / 2;
      const pxPerMs = (cv.width / dpr) / win;
      const x0 = Math.ceil((0 - t0) * pxPerMs * dpr), x1 = Math.floor((1000 - t0) * pxPerMs * dpr); // 信号区 [0,1000]ms
      let maxRun = 1, run = 1, prev = colSig(x0);
      for (let cx = x0 + 1; cx <= x1; cx++) {
        const sg = colSig(cx);
        if (sg === prev) { run++; if (run > maxRun) maxRun = run; } else run = 1;
        prev = sg;
      }
      let peakCol = x0, peakB = 0;
      for (let cx = x0; cx <= x1; cx++) { const b = colBright(cx); if (b > peakB) { peakB = b; peakCol = cx; } }
      const xOf = (ms) => ((ms - t0) / win) * (cv.width / dpr);
      return JSON.stringify({ maxRun, peakCssX: peakCol / dpr, x500: xOf(500), x480: xOf(480), pxPerMs, sigCols: x1 - x0 });
    })()
  `);
  const p2 = JSON.parse(r2);
  console.log('  T2/T3 频谱:', r2);
  assert(p2.sigCols > 50, `T2 信号区列数充足 (${p2.sigCols})`);
  assert(p2.maxRun < 4, `T2 无方格 — 最长同值列连跑 ${p2.maxRun} < 4 (旧 21.3ms 帧在 ${p2.pxPerMs.toFixed(2)}px/ms 下会 ~4 列同值)`);
  assert(Math.abs(p2.peakCssX - p2.x480) <= 2, `T3 频谱冲激亮列对齐 x(480)±2px (v112 显示偏移; 实际 ${p2.peakCssX.toFixed(1)} vs ${p2.x480.toFixed(1)}; 前缘窗口会在其右侧 ~23ms ≈ ${(23 * p2.pxPerMs).toFixed(1)}px)`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V106_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V106_CDP_PASSED');
