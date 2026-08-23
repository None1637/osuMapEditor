// v111 CDP 端到端: ①0.25x 变速播放中频谱冲激列与时间轴逐像素对齐 (旧簿记此处漂移 >10px)
//                 ②谱面信息/保存反馈显示在游玩区左下角, 工具栏不含
// 运行: node verifier/v111/cdp-v111.mjs  (需 dev server :7100)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9435;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-v111-'));
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
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => { const id = ++msgId; return new Promise(res => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};

// 频谱亮度峰列 vs 期望列 (设备像素); 同时测时间轴 tick 列做 sanity
const measure = `
  (() => {
    const s = window.__osuStore;
    const t = s.currentTime;
    const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
    const t0 = t - win / 2;
    const wcv = document.querySelector('[data-wave="canvas"]');
    const tcv = Array.from(document.querySelectorAll('canvas')).find(x => x.className.includes('h-[92px]'));
    const wg = wcv.getContext('2d'), tg = tcv.getContext('2d');
    const wimg = wg.getImageData(0, 0, wcv.width, wcv.height).data;
    const timg = tg.getImageData(0, 0, tcv.width, tcv.height).data;
    const find = (ms) => {
      const expX = ((ms - 20 - t0) / win) * wcv.width; // v112: 波形/频谱显示左移 20ms (lazer WAVEFORM_VISUAL_OFFSET)
      const expTickX = ((ms - t0) / win) * wcv.width;  // 时间轴 tick 不偏移
      let wx = -1, wh = 0;
      for (let cx = Math.max(0, Math.round(expX - 50)); cx < Math.min(wcv.width, expX + 50); cx++) {
        let h = 0;
        for (let y = 0; y < wcv.height; y += 2) { const o = (y * wcv.width + cx) * 4; h += wimg[o] + wimg[o + 1] + wimg[o + 2]; }
        if (h > wh) { wh = h; wx = cx; }
      }
      let tx = -1, th = 0;
      for (let cx = Math.max(0, Math.round(expTickX - 50)); cx < Math.min(tcv.width, expTickX + 50); cx++) {
        let h = 0;
        for (let y = Math.floor(tcv.height * 0.55); y < tcv.height; y++) { const o = (y * tcv.width + cx) * 4; if (timg[o] > 150 && timg[o + 1] > 150 && timg[o + 2] > 150) h++; }
        if (h > th) { th = h; tx = cx; }
      }
      return { ms, expX: Math.round(expX * 10) / 10, expTickX: Math.round(expTickX * 10) / 10, waveX: wx, waveH: wh, tickX: tx };
    };
    return JSON.stringify({ t: Math.round(t), m3000: find(3000), m4000: find(4000), playing: s.playing, rate: s.playbackRate });
  })()
`;

try {
  for (let i = 0; i < 40; i++) { await sleep(500); if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)')) break; }

  // ---------- ② 谱面信息在游玩区左下角 ----------
  const b = await evalJs(`(() => {
    const s = window.__osuStore; const bm = s.beatmap;
    const el = Array.from(document.querySelectorAll('div')).find(d => d.className.includes('bottom-2') && d.className.includes('left-2') && d.textContent.includes(bm.metadata.artist));
    if (!el) return { found: false };
    const p = el.parentElement;
    const er = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
    const tb = document.querySelector('.h-12');
    return { found: true, hasCanvas: !!p.querySelector('canvas'),
      dLeft: Math.round((er.left - pr.left) * 10) / 10, dBottom: Math.round((pr.bottom - er.bottom) * 10) / 10,
      hasVersion: el.textContent.includes('[' + bm.metadata.version + ']'),
      toolbarHasName: tb ? tb.textContent.includes(bm.metadata.artist) : null };
  })()`);
  assert(b.found, '② 游玩区存在左下角谱面信息 overlay');
  if (b.found) {
    assert(b.hasCanvas, '② overlay 父容器 = 游玩区 (含 EditorCanvas canvas)');
    assert(Math.abs(b.dLeft - 8) < 2 && Math.abs(b.dBottom - 8) < 2, `② overlay 贴左下角 (left-2/bottom-2 = 8px, 实际 ${b.dLeft}/${b.dBottom})`);
    assert(b.hasVersion, '② overlay 含难度名 [version]');
    assert(b.toolbarHasName === false, '② 工具栏不再显示谱面名');
  }

  // ---------- ① 0.25x 播放中频谱对齐 ----------
  await evalJs(`
    (() => {
      const s = window.__osuStore;
      s.pause();
      const sr = 22050, n = sr * 10;
      const buf = new ArrayBuffer(44 + n * 2);
      const dv = new DataView(buf);
      const w = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
      w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
      dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let sec = 1; sec < 10; sec++) dv.setInt16(44 + sec * sr * 2, 30000, true); // 每秒一个冲激
      try { const st = JSON.parse(localStorage.getItem('osu-editor:wavepanel:state') || '{}'); st.mode = 'spectro'; st.offsetY = 0; st.collapsed = false; localStorage.setItem('osu-editor:wavepanel:state', JSON.stringify(st)); } catch {}
      s.setWavePanelOpen(true);
      s.setAudio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
      s.beatmap.timingPoints = [{ time: 0, beatLength: 1000, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.beatmap.editor.timelineZoom = 1; // win=6000ms, 冲激 3000/4000 在 t≈5000 时都在视口内
      return 'ok';
    })()
  `);
  for (let i = 0; i < 30; i++) { await sleep(300); if (await evalJs('!!window.__osuStore.getAudioBuffer()')) break; }
  await evalJs(`window.__osuStore.seek(2000); window.__osuStore.setRate(0.25); 'ok'`);
  await sleep(300);
  await evalJs(`window.__osuStore.play(); 'ok'`);
  await sleep(12000); // 0.25x: 播到 ~5000ms — 旧簿记此时漂移 >10px
  const r = JSON.parse(await evalJs(measure));
  console.log('  播放中测量:', JSON.stringify(r));
  assert(r.playing && Math.abs(r.rate - 0.25) < 1e-6, '① 0.25x 播放中');
  for (const k of ['m3000', 'm4000']) {
    const m = r[k];
    assert(m.waveH > 0 && Math.abs(m.waveX - m.expX) <= 2.5, `① 播放中 ${m.ms}ms 冲激列对齐 v112 显示偏移位 (频谱 ${m.waveX} vs 期望 ${m.expX}, 差 ${Math.abs(m.waveX - m.expX).toFixed(1)}px)`);
    assert(Math.abs(m.tickX - m.expTickX) <= 3, `① sanity: 时间轴 tick 对齐 (${m.tickX} vs ${m.expTickX})`);
  }
  // 暂停后再测 — 静态精度 (频谱逐列采样本身的准度, v106 已证 ±1px)
  await evalJs(`window.__osuStore.pause(); 'ok'`);
  await sleep(400);
  const rp = JSON.parse(await evalJs(measure));
  console.log('  暂停后测量:', JSON.stringify(rp));
  for (const k of ['m3000', 'm4000']) {
    const m = rp[k];
    assert(m.waveH > 0 && Math.abs(m.waveX - m.expX) <= 2.5, `① 暂停后 ${m.ms}ms 冲激列对齐 (差 ${Math.abs(m.waveX - m.expX).toFixed(1)}px)`);
  }
} finally {
  try { edge.kill(); } catch { }
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { }
}

console.log(failures ? `\nV111_CDP_FAILED: ${failures}` : '\nV111_CDP_PASSED');
process.exit(failures ? 1 : 0);
