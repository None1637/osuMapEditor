// CDP v105 端到端: 波形窗右侧竖标题条 + 右上角模式按钮 + 半透明背景
//   T1 画布仍全宽对齐时间轴   T2 竖标题条在右缘(宽≈18), 拖它 Y 跟随
//   T3 模式按钮在波形右上角浮层   T4 波形背景半透明 (alpha≈140) 且波形像素不透明
//   T5 频谱静音处半透明 / 强信号处不透明   T6 ✕ 仍可关闭
// 运行: node verifier/v105/cdp-v105.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9425;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v105-'));
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

  // 布景: 1s 440Hz 正弦 WAV
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
      for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(0.7 * 32767 * Math.sin(2 * Math.PI * 440 * i / sr)), true);
      s.setAudio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
      s.seek(500);
      return 'ok';
    })()
  `);
  let hasBuf = false;
  for (let i = 0; i < 30 && !hasBuf; i++) { await sleep(300); hasBuf = await evalJs('!!window.__osuStore.getAudioBuffer()'); }
  assert(hasBuf, '布景: 合成 WAV 解码出 AudioBuffer');

  await evalJs(`
    window.__t105 = (() => {
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

  // T1: 画布仍全宽 = 时间轴宽
  const r1 = JSON.parse(await evalJs(`
    (() => {
      const cv = __t105.q('[data-wave="canvas"]').getBoundingClientRect();
      const tl = Array.from(document.querySelectorAll('canvas')).find(x => x.className.includes('h-[92px]')).getBoundingClientRect();
      return JSON.stringify({ dLeft: Math.abs(cv.left - tl.left), dW: Math.abs(cv.width - tl.width) });
    })()
  `));
  console.log('  T1 对齐:', r1);
  assert(r1.dLeft < 1 && r1.dW < 1, `T1 画布全宽对齐时间轴 (dLeft=${r1.dLeft} dW=${r1.dW})`);

  // T2: 竖标题条在右缘 (宽≈18, 高=面板高), 拖它 Y 跟随
  const t2before = await evalJs(`
    (() => {
      const h = __t105.q('[data-wave="header"]');
      const r = h.getBoundingClientRect();
      const panelR = __t105.q('[data-wave="panel"]').getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      __t105.pd(h, cx, cy); __t105.pm(h, cx + 40, cy + 60); __t105.pu(h);
      return JSON.stringify({ w: r.width, rightGap: Math.abs(panelR.right - r.right), top: panelR.top });
    })()
  `);
  await sleep(300);
  const t2b = JSON.parse(t2before);
  const t2top = await evalJs(`__t105.q('[data-wave="panel"]').getBoundingClientRect().top`);
  console.log('  T2 标题条:', t2before, '拖动后 top:', t2top);
  assert(Math.abs(t2b.w - 18) < 2 && t2b.rightGap < 1, `T2 竖标题条贴右缘宽≈18 (w=${t2b.w} rightGap=${t2b.rightGap})`);
  assert(Math.abs(t2top - (t2b.top + 60)) < 3, `T2 拖竖标题条 Y 跟随 (${t2b.top}→${t2top})`);

  // T3: 模式按钮浮在波形右上角
  const r3 = JSON.parse(await evalJs(`
    (() => {
      const b = __t105.q('[data-wave="mode-spectro"]').getBoundingClientRect();
      const cv = __t105.q('[data-wave="canvas"]').getBoundingClientRect();
      return JSON.stringify({ withinTop: b.top >= cv.top && b.top <= cv.top + 16, withinRight: b.right <= cv.right && b.right >= cv.right - 100 });
    })()
  `));
  console.log('  T3 模式按钮:', r3);
  assert(r3.withinTop && r3.withinRight, 'T3 模式按钮浮在波形右上角');

  // T4: 波形背景半透明 (最透明像素 alpha≈140), 波形柱不透明 (alpha=255)
  const r4 = JSON.parse(await evalJs(`
    (() => {
      const cv = __t105.q('[data-wave="canvas"]');
      const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let minA = 255, maxA = 0, maxG = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (img[i + 3] < minA) minA = img[i + 3];
        if (img[i + 3] > maxA) maxA = img[i + 3];
        if (img[i + 1] > maxG) maxG = img[i + 1];
      }
      return JSON.stringify({ minA, maxA, maxG });
    })()
  `));
  console.log('  T4 波形 alpha:', r4);
  assert(Math.abs(r4.minA - 140) <= 6, `T4 波形背景半透明 alpha≈140 (实际 ${r4.minA})`);
  assert(r4.maxA === 255 && r4.maxG > 150, `T4 波形柱不透明亮绿 (maxA=${r4.maxA} maxG=${r4.maxG})`);

  // T5: 频谱 — 静音/未算到处半透明, 强信号处不透明
  await evalJs(`__t105.q('[data-wave="mode-spectro"]').click(); 'ok'`);
  let r5 = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    r5 = JSON.parse(await evalJs(`
      (() => {
        const cv = __t105.q('[data-wave="canvas"]');
        const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let minA = 255, maxA = 0, maxB = 0;
        for (let i = 0; i < img.length; i += 4) {
          if (img[i + 3] < minA) minA = img[i + 3];
          if (img[i + 3] > maxA) maxA = img[i + 3];
          const v = img[i] + img[i + 1] + img[i + 2];
          if (v > maxB) maxB = v;
        }
        return JSON.stringify({ minA, maxA, maxB });
      })()
    `));
    if (r5.maxB > 200) break;
  }
  console.log('  T5 频谱 alpha:', r5);
  assert(Math.abs(r5.minA - 140) <= 6, `T5 频谱静音处半透明 alpha≈140 (实际 ${r5.minA})`);
  assert(r5.maxA > 200 && r5.maxB > 200, `T5 频谱强信号近不透明且明亮 (maxA=${r5.maxA} maxB=${r5.maxB}; alpha 随强度 140→255)`);

  // T6: ✕ 关闭
  await evalJs(`__t105.q('[data-wave="close"]').click(); 'ok'`);
  await sleep(300);
  const r6 = await evalJs(`JSON.stringify({ panel: !!__t105.q('[data-wave="panel"]'), open: window.__osuStore.wavePanelOpen })`);
  const p6 = JSON.parse(r6);
  assert(!p6.panel && !p6.open, `T6 ✕ 关闭生效 (panel=${p6.panel} open=${p6.open})`);

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V105_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V105_CDP_PASSED');
