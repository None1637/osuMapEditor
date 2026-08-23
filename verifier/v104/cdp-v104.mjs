// CDP v104 端到端: 波形窗修复
//   T1 波形对齐 (500ms 冲激峰值落在 x(480)±2px; v112 适配: +20ms lazer 显示偏移恢复 — WAVEFORM_VISUAL_OFFSET=20)
//   T2 向上猛拖 → 顶边钳制不出视口 (top >= 0)
//   T3 向下拖 → 面板可停到游玩区上方 (offsetY 变负)
//   T4 顶边大幅拉高 → 高度增加且顶边仍 >= 0 (自动回屏)
//   T5 ✕ 关闭按钮生效 (面板卸载, store.wavePanelOpen=false)
// 运行: node verifier/v104/cdp-v104.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9424;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v104-'));
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

  // 布景: 1s WAV, 500ms 处一个满幅冲激
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
      dv.setInt16(44 + Math.round(sr * 0.5) * 2, 32767, true); // 500ms 冲激
      s.setAudio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
      s.seek(500);
      return 'ok';
    })()
  `);
  let hasBuf = false;
  for (let i = 0; i < 30 && !hasBuf; i++) { await sleep(300); hasBuf = await evalJs('!!window.__osuStore.getAudioBuffer()'); }
  assert(hasBuf, '布景: 合成 WAV 解码出 AudioBuffer');

  await evalJs(`
    window.__t104 = (() => {
      const q = (sel) => document.querySelector(sel);
      const pd = (el, x, y) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, clientX: x, clientY: y }));
      const pm = (el, x, y) => el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: x, clientY: y }));
      const pu = (el) => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
      return { q, pd, pm, pu };
    })();
    window.__osuStore.setWavePanelOpen(true);
    'ok'
  `);
  await sleep(500);

  // T1: 冲激峰值列 = x(480) ± 2px (v112: +20ms lazer 显示偏移恢复; 无偏移会在 x(500))
  const r1 = await evalJs(`
    (() => {
      const s = window.__osuStore;
      const cv = __t104.q('[data-wave="canvas"]');
      const g = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const img = g.getImageData(0, 0, cv.width, cv.height).data;
      // 找每列最高的绿色像素 (冲激列全高亮)
      let peakCol = -1, peakH = 0;
      for (let cx = 0; cx < cv.width; cx++) {
        let h = 0;
        for (let y = 0; y < cv.height; y++) {
          const o = (y * cv.width + cx) * 4;
          if (img[o + 1] > 120) h++; // 亮绿像素计数
        }
        if (h > peakH) { peakH = h; peakCol = cx; }
      }
      const win = 6000 / (s.beatmap.editor.timelineZoom || 1);
      const t0 = s.currentTime - win / 2;
      const xOf = (ms) => ((ms - t0) / win) * (cv.width / dpr);
      return JSON.stringify({ peakCssX: peakCol / dpr, peakH, x480: xOf(480), x500: xOf(500) });
    })()
  `);
  const p1 = JSON.parse(r1);
  console.log('  T1 峰值列:', r1);
  assert(p1.peakH > 0, `T1 波形有亮绿峰值列 (h=${p1.peakH})`);
  assert(Math.abs(p1.peakCssX - p1.x480) <= 2, `T1 峰值在 x(480)±2px — v112 lazer 显示偏移 +20ms 生效 (实际 ${p1.peakCssX.toFixed(1)} vs ${p1.x480.toFixed(1)}; 无偏移会在 ${p1.x500.toFixed(1)})`);

  // T2: 向上猛拖 500px → 顶边钳制 top >= 0
  await evalJs(`
    (() => {
      const h = __t104.q('[data-wave="header"]');
      const r = h.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      __t104.pd(h, cx, cy); __t104.pm(h, cx, cy - 500); __t104.pu(h);
    })();
    'ok'
  `);
  await sleep(300);
  const r2 = await evalJs(`__t104.q('[data-wave="panel"]').getBoundingClientRect().top`);
  console.log('  T2 上拖后 top =', r2);
  assert(r2 >= 0 && r2 < 2, `T2 向上猛拖后顶边钳制在视口内 (top=${r2})`);

  // T3: 向下拖 200px → 面板下移 200 (可停到游玩区上方)
  await evalJs(`
    (() => {
      const h = __t104.q('[data-wave="header"]');
      const r = h.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      __t104.pd(h, cx, cy); __t104.pm(h, cx, cy + 200); __t104.pu(h);
    })();
    'ok'
  `);
  await sleep(300);
  const r3 = await evalJs(`__t104.q('[data-wave="panel"]').getBoundingClientRect().top`);
  console.log('  T3 下拖后 top =', r3);
  assert(Math.abs(r3 - 200) < 3, `T3 向下拖动面板跟随 (top=${r3}, 期望 ≈200)`);

  // T4: 顶边大幅拉高 (200px) → 高度增加且顶边仍 >= 0
  await evalJs(`
    (() => {
      const h = __t104.q('[data-wave="resize"]');
      const r = h.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + 2;
      __t104.pd(h, cx, cy); __t104.pm(h, cx, cy - 200); __t104.pu(h);
    })();
    'ok'
  `);
  await sleep(300);
  const r4 = JSON.parse(await evalJs(`
    JSON.stringify({
      top: __t104.q('[data-wave="panel"]').getBoundingClientRect().top,
      cvH: __t104.q('[data-wave="canvas"]').getBoundingClientRect().height,
    })
  `));
  console.log('  T4 拉高后:', r4);
  assert(r4.cvH > 150, `T4 拉高生效 (canvas 高 ${r4.cvH})`);
  assert(r4.top >= 0, `T4 拉高后顶边不出屏 (top=${r4.top})`);

  // T5: ✕ 关闭 → 面板卸载
  await evalJs(`__t104.q('[data-wave="close"]').click(); 'ok'`);
  await sleep(300);
  const r5 = await evalJs(`JSON.stringify({ panel: !!__t104.q('[data-wave="panel"]'), open: window.__osuStore.wavePanelOpen })`);
  const p5 = JSON.parse(r5);
  assert(!p5.panel && !p5.open, `T5 ✕ 关闭生效 (panel=${p5.panel} open=${p5.open})`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V104_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V104_CDP_PASSED');
