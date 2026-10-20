// 验证器 v482: 物件时间轴小滑条「光标是拖尾形状但拉不了尾段」修复 (soulten)
//   根因: v463 头尾重叠一律头优先 (mousedown 命中头圆即跳过 hitTestTail), 小滑条
//   (尾到头 < RAD+3=27px) 尾端 8px 热区整个被头圆覆盖 → 拖尾永不触发; 而悬停光标只看
//   hitTestTail 仍显示 ew-resize → 光标与行为不一致。
//   修复: hitTestTail 返回距离 d, mousedown/悬停光标共用距离裁决 — 尾更近拖尾, 头更近头优先
//   (v463 点头附近仍头优先的语义保留)。
// 运行: npm run build 后 node verifier/v482/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码');
{
  const tl = read('src/components/Timelines.tsx');
  assert(/hitTestTail = \(e: React\.MouseEvent\): \{ id: number; d: number \} \| null/.test(tl), 'hitTestTail 返回 {id, d}');
  assert(/const headDist = \(id: number, e: React\.MouseEvent\): number/.test(tl), 'headDist 头圆距离助手');
  assert(/const tailId = tailHit && \(headId === null \|\| tailHit\.d < headDist\(headId, e\)\) \? tailHit\.id : null;/.test(tl),
    'mousedown 头尾距离裁决');
  assert(/const tailWins = tailHit && \(headId === null \|\| tailHit\.d < headDist\(headId, e\)\);/.test(tl),
    '悬停光标同一裁决');
  assert(/ref\.current\.style\.cursor = tailWins \|\| \(pill && !pill\.tp\.uninherited\)/.test(tl), 'ew-resize 走 tailWins');
}

section('CDP: 小滑条拖尾生效 / 点头仍头优先 / 光标一致');
{
  const PORT = 9495;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { /* not ready */ }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);

    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = base.timingPoints.find(p => p.uninherited);
      const vel = 100 * base.difficulty.sliderMultiplier / red0.beatLength;
      const c = [...document.querySelectorAll('canvas')].find(c => Math.abs(c.getBoundingClientRect().height - 92) < 2);
      const r = c.getBoundingClientRect();
      const win = 6000 / (base.editor.timelineZoom || 1);
      // 小滑条: 尾在屏上距头 ~14px (< RAD+3=27 → 头圆热区覆盖尾; > 8 → 尾热区仍有专属像素)
      const dur = 14 / r.width * win;
      const t = Math.round(red0.time + red0.beatLength * 8);
      const mk = { id: 482001, type: 'slider', x: 100, y: 100, time: t,
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: 200, y: 100 }], slides: 1, length: Math.max(1, Math.round(vel * dur)) };
      store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [mk] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select'; store.beatSnap = 4;
      store.seek(t + 150); store.clearSelection();
      const t0w = store.currentTime - win / 2;
      const hx = r.left + ((t - t0w) / win) * r.width;
      const o0 = store.beatmap.hitObjects.find(x => x.id === 482001);
      const endMs = o0.time + o0.length / vel * o0.slides;
      const tx = r.left + ((endMs - t0w) / win) * r.width;
      const y = r.top + 20;
      const out = { pxOff: tx - hx };
      // 1) 悬停尾端 → ew-resize; 悬停头 → pointer (光标与行为一致)
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: tx, clientY: y, buttons: 0, bubbles: true }));
      out.cursorTail = c.style.cursor;
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: hx, clientY: y, buttons: 0, bubbles: true }));
      out.cursorHead = c.style.cursor;
      // 2) 按住尾端正中右拖 → 拖尾改折返 (v482 前: 被头优先抢走 = 整体移动)
      const slides0 = o0.slides, time0 = o0.time;
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: tx, clientY: y, button: 0, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: tx + 60, clientY: y, buttons: 1, bubbles: true }));
      await sleep(150);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: tx + 60, clientY: y, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: tx + 60, clientY: y, bubbles: true }));
      await sleep(80);
      const o1 = store.beatmap.hitObjects.find(x => x.id === 482001);
      out.tailDrag = { slides0, slides1: o1.slides, timeMoved: o1.time !== time0 };
      // 3) 按住头圆心拖动 → 头优先 = 整体移动, 不改折返 (v463 语义保留)
      const slidesB = o1.slides, timeB = o1.time;
      const t0w2 = store.currentTime - win / 2;
      const hx2 = r.left + ((o1.time - t0w2) / win) * r.width;
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: hx2, clientY: y, button: 0, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: hx2 + 120, clientY: y, buttons: 1, bubbles: true }));
      await sleep(150);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: hx2 + 120, clientY: y, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: hx2 + 120, clientY: y, bubbles: true }));
      await sleep(80);
      const o2 = store.beatmap.hitObjects.find(x => x.id === 482001);
      out.headDrag = { slidesB, slides2: o2.slides, timeMoved: o2.time !== timeB };
      return out;
    })()`);

    assert(out.pxOff > 8 && out.pxOff < 27, `布景: 尾距头 ${out.pxOff.toFixed(1)}px (8~27 区间才能分别命中)`);
    assert(out.cursorTail === 'ew-resize', `悬停尾端 = ew-resize (实际 ${out.cursorTail})`);
    assert(out.cursorHead !== 'ew-resize', `悬停头 ≠ ew-resize (实际 ${out.cursorHead})`);
    assert(out.tailDrag.slides1 > out.tailDrag.slides0 && !out.tailDrag.timeMoved,
      `拖尾端正中: 折返 ${out.tailDrag.slides0}→${out.tailDrag.slides1} 且时间不动 (实际 ${JSON.stringify(out.tailDrag)})`);
    assert(out.headDrag.timeMoved && out.headDrag.slides2 === out.headDrag.slidesB,
      `拖头圆心: 整体移动且折返不变 (实际 ${JSON.stringify(out.headDrag)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V482_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V482_ALL_TESTS_PASSED');
