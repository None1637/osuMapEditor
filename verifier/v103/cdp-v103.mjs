// CDP v103 端到端: 波形/频谱悬浮窗
//   T1 打开面板: 展开态出现且宽度与时间轴对齐   T2 波形模式 canvas 画出绿色波形
//   T3 切频谱模式: 后台算完后 canvas 有非黑像素   T4 标题拖动: Y 变 X 不变
//   T5 顶边拉伸: 高度增加   T6 折叠: 变右侧小窗(canvas 消失)   T7 小窗两轴拖动 + 展开恢复
// 运行: node verifier/v103/cdp-v103.mjs   (需要 7100 端口 dev server 已启动)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP_URL = 'http://localhost:7100/';
const DEBUG_PORT = 9423;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-v103-'));
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

  // 布景: 页内合成 1s 440Hz 正弦 WAV → setAudio, 等解码出 AudioBuffer
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
  for (let i = 0; i < 30 && !hasBuf; i++) {
    await sleep(300);
    hasBuf = await evalJs('!!window.__osuStore.getAudioBuffer()');
  }
  assert(hasBuf, '布景: 合成 WAV 解码出 AudioBuffer (getAudioBuffer 非空)');

  // 页内事件助手
  await evalJs(`
    window.__t103 = (() => {
      const q = (sel) => document.querySelector(sel);
      const pd = (el, x, y) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, clientX: x, clientY: y }));
      const pm = (el, x, y) => el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: x, clientY: y }));
      const pu = (el) => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
      return { q, pd, pm, pu };
    })();
    'ok'
  `);

  // T1: 打开面板 → 展开态出现, 宽度/左缘与时间轴 canvas 对齐
  await evalJs(`window.__osuStore.setWavePanelOpen(true); 'ok'`);
  await sleep(400);
  const r1 = await evalJs(`
    (() => {
      const panel = __t103.q('[data-wave="panel"]');
      const waveCv = __t103.q('[data-wave="canvas"]');
      const tlCv = Array.from(document.querySelectorAll('canvas')).find(x => x.className.includes('h-[92px]'));
      if (!panel || !waveCv || !tlCv) return JSON.stringify({ err: 'missing' });
      const pr = panel.getBoundingClientRect(), tr = tlCv.getBoundingClientRect();
      // v108 适配: 左栏布局后时间轴上方放不下面板, 默认停在时间轴下方游玩区顶 (不再断言"上方")
      return JSON.stringify({ dLeft: Math.abs(pr.left - tr.left), dW: Math.abs(pr.width - tr.width), above: pr.bottom <= tr.top + 1, below: pr.top >= tr.bottom - 1, top: pr.top });
    })()
  `);
  const p1 = JSON.parse(r1);
  console.log('  T1 对齐:', r1);
  assert(!p1.err && p1.dLeft < 1 && p1.dW < 1, `T1 面板宽度/左缘与时间轴对齐 (dLeft=${p1.dLeft} dW=${p1.dW})`);
  assert(p1.below && p1.top >= 0, `T1 面板默认停在时间轴下方游玩区顶且在屏内 (v108 适配; below=${p1.below} top=${p1.top})`);

  // T2: 波形模式 → canvas 出现亮绿像素 (正弦波)
  await sleep(400);
  const r2 = await evalJs(`
    (() => {
      const cv = __t103.q('[data-wave="canvas"]');
      const g = cv.getContext('2d');
      const img = g.getImageData(0, 0, cv.width, cv.height).data;
      let maxG = 0;
      for (let i = 0; i < img.length; i += 4) if (img[i + 1] > maxG) maxG = img[i + 1];
      return maxG;
    })()
  `);
  console.log('  T2 maxG =', r2);
  assert(r2 > 150, `T2 波形模式画出亮绿波形 (maxG=${r2})`);

  // T3: 切频谱 → 等后台算完, canvas 出现非黑像素
  await evalJs(`__t103.q('[data-wave="mode-spectro"]').click(); 'ok'`);
  let r3 = 0;
  for (let i = 0; i < 40 && r3 <= 60; i++) {
    await sleep(300);
    r3 = await evalJs(`
      (() => {
        const cv = __t103.q('[data-wave="canvas"]');
        const g = cv.getContext('2d');
        const img = g.getImageData(0, 0, cv.width, cv.height).data;
        let mx = 0;
        for (let i = 0; i < img.length; i += 4) { const v = img[i] + img[i + 1] + img[i + 2]; if (v > mx) mx = v; }
        return mx;
      })()
    `);
  }
  console.log('  T3 频谱最大亮度 =', r3);
  assert(r3 > 60, `T3 频谱模式画出非黑像素 (最大亮度=${r3})`);

  // T4: 拖标题条 → top 上移 30, left 不变 (React pointermove 批量更新, 事件与读 rect 分两步)
  const t4before = JSON.parse(await evalJs(`
    (() => {
      const h = __t103.q('[data-wave="header"]');
      const panel = __t103.q('[data-wave="panel"]');
      const r = h.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      __t103.pd(h, cx, cy); __t103.pm(h, cx + 60, cy - 30); __t103.pu(h);
      return JSON.stringify({ top: panel.getBoundingClientRect().top, left: panel.getBoundingClientRect().left });
    })()
  `));
  await sleep(300);
  const t4after = JSON.parse(await evalJs(`
    (() => { const p = __t103.q('[data-wave="panel"]').getBoundingClientRect(); return JSON.stringify({ top: p.top, left: p.left }); })()
  `));
  const p4 = { dTop: t4before.top - t4after.top, dLeft: Math.abs(t4after.left - t4before.left) };
  console.log('  T4 拖动:', JSON.stringify(p4));
  assert(Math.abs(p4.dTop - 30) < 2, `T4 标题拖动 Y 上移 30 (实际 ${p4.dTop})`);
  assert(p4.dLeft < 1, `T4 X 不动 (实际偏移 ${p4.dLeft})`);

  // T5: 顶边拉伸 → 画布高度 92 → 112
  const t5before = await evalJs(`
    (() => {
      const h = __t103.q('[data-wave="resize"]');
      const r = h.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + 2;
      __t103.pd(h, cx, cy); __t103.pm(h, cx, cy - 20); __t103.pu(h);
      return __t103.q('[data-wave="canvas"]').getBoundingClientRect().height;
    })()
  `);
  await sleep(300);
  const t5after = await evalJs(`__t103.q('[data-wave="canvas"]').getBoundingClientRect().height`);
  console.log('  T5 拉伸:', JSON.stringify({ before: t5before, after: t5after }));
  assert(Math.abs(t5after - (t5before + 20)) < 2, `T5 顶边上拉 20 → 高度 +20 (${t5before}→${t5after})`);

  // T6: 折叠 → fixed 小窗出现, 展开态/canvas 消失
  await evalJs(`__t103.q('[data-wave="collapse"]').click(); 'ok'`);
  await sleep(300);
  const r6 = await evalJs(`JSON.stringify({
    mini: !!__t103.q('[data-wave="mini"]'),
    panel: !!__t103.q('[data-wave="panel"]'),
    cv: !!__t103.q('[data-wave="canvas"]'),
  })`);
  const p6 = JSON.parse(r6);
  console.log('  T6 折叠:', r6);
  assert(p6.mini && !p6.panel && !p6.cv, 'T6 折叠后为右侧小窗, 大窗与 canvas 消失');

  // T7: 小窗两轴拖动 → 位置两轴都变; 展开 → 大窗恢复
  const t7before = await evalJs(`
    (() => {
      const mini = __t103.q('[data-wave="mini"]');
      const grip = mini.querySelector('div');
      const r = mini.getBoundingClientRect();
      __t103.pd(grip, r.left + 30, r.top + 12);
      __t103.pm(grip, r.left + 30 - 80, r.top + 12 + 50);
      __t103.pu(grip);
      return JSON.stringify({ left: r.left, top: r.top });
    })()
  `);
  await sleep(300);
  const t7after = await evalJs(`
    (() => {
      const r = __t103.q('[data-wave="mini"]').getBoundingClientRect();
      __t103.q('[data-wave="expand"]').click();
      return JSON.stringify({ left: r.left, top: r.top });
    })()
  `);
  const b7 = JSON.parse(t7before), a7 = JSON.parse(t7after);
  const p7 = { dX: b7.left - a7.left, dY: a7.top - b7.top };
  console.log('  T7 小窗拖动:', JSON.stringify(p7));
  assert(Math.abs(p7.dX - 80) < 2 && Math.abs(p7.dY - 50) < 2, `T7 小窗两轴拖动 (dX=${p7.dX} dY=${p7.dY})`);
  await sleep(300);
  const back = await evalJs(`JSON.stringify({ panel: !!__t103.q('[data-wave="panel"]'), cv: !!__t103.q('[data-wave="canvas"]') })`);
  const pb = JSON.parse(back);
  assert(pb.panel && pb.cv, 'T7 展开后大窗恢复');

  console.log('== 页面异常: ' + exceptions.length, exceptions.slice(0, 3).join(' | '));
  assert(exceptions.length === 0, '全程无未捕获异常');
} finally {
  try { edge.kill(); } catch { /* noop */ }
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* noop */ }
}
if (failures) { console.error(`\nVERIFIER_V103_CDP_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V103_CDP_PASSED');
