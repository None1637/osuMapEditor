// v112 CDP 端到端: 波形/频谱显示偏移 +20ms 生效 (对齐 lazer WAVEFORM_VISUAL_OFFSET)
//   T1 波形: 500ms 冲激峰值列 = x(480)±2px (内容左移 20ms; 无偏移会在 x(500))
//   T2 频谱: 冲激亮列 = x(480)±2.5px (窗口居中 + 显示偏移; 前缘窗口会在 x(500)右侧 ~23ms)
//   T3 0.25x 播放中: 冲激列仍贴 x(480)±2.5px (v111 滚动簿记与 v112 显示偏移正交共存)
// 运行: node verifier/v112/cdp-v112.mjs  (需 dev server :7100)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9437;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-v112-'));
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required', APP_URL], { stdio: 'ignore' });
let target;
for (let i = 0; i < 40 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    target = targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL));
  } catch { }
  if (!target) await sleep(500);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown')
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? ''));
};
const send = (method, params = {}) => { const id = ++msgId; return new Promise(res => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

// 冲激(500ms)列位置测量: 返回 {waveX, x480, x500, h} (css px)
const measure = (mode) => `
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
        ${mode === 'wave'
          ? 'if (img[o + 1] > 120) h++;'
          : 'h += img[o] + img[o + 1] + img[o + 2];'}
      }
      if (h > peakH) { peakH = h; peakCol = cx; }
    }
    const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
    const t0 = s.currentTime - win / 2;
    const xOf = (ms) => ((ms - t0) / win) * (cv.width / dpr);
    return JSON.stringify({ waveX: peakCol / dpr, h: peakH, x480: xOf(480), x500: xOf(500), t: Math.round(s.currentTime) });
  })()
`;

try {
  await send('Runtime.enable');
  for (let i = 0; i < 40; i++) { await sleep(500); if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)')) break; }
  await sleep(400);

  // 布景: 1s WAV = 低幅噪声 + 500ms 满幅冲激; 面板展开, 波形模式
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      const sr = 22050, n = sr;
      const buf = new ArrayBuffer(44 + n * 2);
      const dv = new DataView(buf);
      const w = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
      w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
      dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
      let seed = 42;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round((rnd() * 2 - 1) * 1600), true);
      dv.setInt16(44 + Math.round(sr * 0.5) * 2, 32767, true); // 500ms 冲激
      try { const st = JSON.parse(localStorage.getItem('osu-editor:wavepanel:state') || '{}'); st.mode = 'wave'; st.offsetY = 0; st.collapsed = false; localStorage.setItem('osu-editor:wavepanel:state', JSON.stringify(st)); } catch {}
      s.setWavePanelOpen(true);
      s.setAudio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
      s.beatmap.editor.timelineZoom = 1;
      s.seek(500);
      return 'ok';
    })()
  `);
  for (let i = 0; i < 30; i++) { await sleep(300); if (await evalJs('!!window.__osuStore.getAudioBuffer()')) break; }
  await sleep(500);

  // T1: 波形模式 — 冲激显示在 x(480)
  const p1 = JSON.parse(await evalJs(measure('wave')));
  console.log('  T1 波形:', JSON.stringify(p1));
  assert(p1.h > 0, `T1 波形有亮绿峰值列 (h=${p1.h})`);
  assert(Math.abs(p1.waveX - p1.x480) <= 2, `T1 峰值在 x(480)±2px — +20ms 显示偏移生效 (实际 ${p1.waveX.toFixed(1)} vs ${p1.x480.toFixed(1)}; 无偏移会在 ${p1.x500.toFixed(1)})`);

  // T2: 频谱模式 — 冲激亮列同样在 x(480) (窗口居中保持, 非前缘)
  await evalJs(`(() => { const st = JSON.parse(localStorage.getItem('osu-editor:wavepanel:state')); st.mode = 'spectro'; localStorage.setItem('osu-editor:wavepanel:state', JSON.stringify(st)); document.querySelector('[data-wave="mode-spectro"]').click(); return 'ok'; })()`);
  await sleep(1200);
  const p2 = JSON.parse(await evalJs(measure('spectro')));
  console.log('  T2 频谱:', JSON.stringify(p2));
  assert(p2.h > 0, `T2 频谱有亮列 (h=${p2.h})`);
  assert(Math.abs(p2.waveX - p2.x480) <= 2.5, `T2 频谱亮列在 x(480)±2.5px (实际 ${p2.waveX.toFixed(1)} vs ${p2.x480.toFixed(1)}; 无偏移 ${p2.x500.toFixed(1)}, 前缘窗口更右 ~23ms)`);

  // T3: 0.25x 播放 — 滚动簿记 + 显示偏移共存, 冲激列贴 x(480) 不漂移
  await evalJs(`window.__osuStore.seek(200); window.__osuStore.setRate(0.25); window.__osuStore.play(); 'ok'`);
  await sleep(3600); // 播到 ~1100ms... 0.25x: 200+900=1100 — 冲激 500ms 在视口左 1/3
  const p3 = JSON.parse(await evalJs(measure('spectro')));
  console.log('  T3 播放中频谱:', JSON.stringify(p3));
  await evalJs(`window.__osuStore.pause(); 'ok'`);
  assert(p3.h > 0, `T3 播放中有亮列 (h=${p3.h})`);
  assert(Math.abs(p3.waveX - p3.x480) <= 2.5, `T3 0.25x 播放中冲激列贴 x(480)±2.5px (实际 ${p3.waveX.toFixed(1)} vs ${p3.x480.toFixed(1)}; v111 簿记不漂移 + v112 偏移共存)`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { }
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { }
}

console.log(failures ? `\nV112_CDP_FAILED: ${failures}` : '\nV112_CDP_PASSED');
process.exit(failures ? 1 : 0);
