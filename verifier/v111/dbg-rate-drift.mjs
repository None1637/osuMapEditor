// 一次性探针 v3: 变速播放中, 波形冲激列 与 时间轴 tick 列 是否同刻对齐 (特征局部检测)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9434;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-dbg-rate3-'));
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

const measure = `
  (() => {
    const s = window.__osuStore;
    const t = s.currentTime;
    const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
    const t0 = t - win / 2;
    const wcv = document.querySelector('[data-wave="canvas"]');
    const tcv = Array.from(document.querySelectorAll('canvas')).find(x => x.className.includes('h-[92px]'));
    const dpr = wcv.width / wcv.getBoundingClientRect().width;
    const wg = wcv.getContext('2d'), tg = tcv.getContext('2d');
    const MODE = (JSON.parse(localStorage.getItem("osu-editor:wavepanel:state") || "{}").mode) || "wave"; const wimg = wg.getImageData(0, 0, wcv.width, wcv.height).data;
    const timg = tg.getImageData(0, 0, tcv.width, tcv.height).data;
    const find = (ms) => {
      const expX = ((ms - t0) / win) * wcv.width; // device px
      // 波形: ±50px 内找绿色像素数最多列; 频谱: ±50px 内找总亮度最多列 (冲激宽带能量)
      let wx = -1, wh = 0;
      for (let cx = Math.max(0, Math.round(expX - 50)); cx < Math.min(wcv.width, expX + 50); cx++) {
        let h = 0;
        if (MODE === 'spectro') {
          for (let y = 0; y < wcv.height; y += 2) { const o = (y * wcv.width + cx) * 4; h += wimg[o] + wimg[o + 1] + wimg[o + 2]; }
        } else {
          for (let y = 0; y < wcv.height; y++) { const o = (y * wcv.width + cx) * 4; if (wimg[o + 1] > 100 && wimg[o + 1] > wimg[o] + 30) h++; }
        }
        if (h > wh) { wh = h; wx = cx; }
      }
      // 时间轴: ±50px 内找下半区亮白列 (tick)
      let tx = -1, th = 0;
      for (let cx = Math.max(0, Math.round(expX - 50)); cx < Math.min(tcv.width, expX + 50); cx++) {
        let h = 0;
        for (let y = Math.floor(tcv.height * 0.55); y < tcv.height; y++) { const o = (y * tcv.width + cx) * 4; if (timg[o] > 150 && timg[o + 1] > 150 && timg[o + 2] > 150) h++; }
        if (h > th) { th = h; tx = cx; }
      }
      return { ms, expX: Math.round(expX * 10) / 10, waveX: wx, waveH: wh, tickX: tx, tickH: th };
    };
    return JSON.stringify({ t: Math.round(t), m4000: find(4000), m5000: find(5000), playing: s.playing, rate: s.playbackRate, tempo: !!s.tempoActive });
  })()
`;

try {
  for (let i = 0; i < 40; i++) { await sleep(500); if (await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)')) break; }
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
      for (let sec = 1; sec < 10; sec++) dv.setInt16(44 + sec * sr * 2, 30000, true);
      s.setAudio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
      s.beatmap.timingPoints = [{ time: 0, beatLength: 1000, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
      s.setWavePanelOpen(true); try { const st = JSON.parse(localStorage.getItem('osu-editor:wavepanel:state') || '{}'); st.mode = 'spectro'; st.offsetY = 0; localStorage.setItem('osu-editor:wavepanel:state', JSON.stringify(st)); } catch {}
      return 'ok';
    })()
  `);
  for (let i = 0; i < 30; i++) { await sleep(300); if (await evalJs('!!window.__osuStore.getAudioBuffer()')) break; }
  await evalJs(`window.__osuStore.seek(2000); window.__osuStore.setRate(0.25); 'ok'`);
  await sleep(300);
  await evalJs(`window.__osuStore.play(); 'ok'`);
  await sleep(4000); // 0.25x: 播到 ~3000ms
  const r1 = JSON.parse(await evalJs(measure));
  await sleep(8000);
  const r2 = JSON.parse(await evalJs(measure));
  await evalJs(`window.__osuStore.pause(); 'ok'`);
  console.log('r1:', JSON.stringify(r1, null, 1));
  console.log('r2:', JSON.stringify(r2, null, 1));
} finally {
  try { edge.kill(); } catch { }
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { }
}
