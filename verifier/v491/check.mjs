// 验证器 v491: 拖物件到时间轴左右边缘自动滚动 (stable: 拖著物件到邊緣會讓時間軸移動)
//   - markerDragRef +x1/scrollMs/scrollAccum/lastDelta; applyMarkerDrag 三处共用 (mousemove/window 兜底/帧循环)
//   - 帧循环: 指针在边缘 40px 容差内 → edgeScrollVelocity/Ramp (lazer handleScrollViaDrag 同 v102 框选参数)
//     seek 实际生效量计入 scrollMs → 物件跟随推出原视窗; 播放中不滚
// 运行: npm run build 后 node verifier/v491/check.mjs
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
  const c = read('src/components/Timelines.tsx');
  assert(/x1: number; scrollMs: number; scrollAccum: number; lastDelta: number;/.test(c), 'markerDragRef 滚动字段');
  assert(/const applyMarkerDrag = \(\)/.test(c) && /\+ md\.scrollMs/.test(c), 'applyMarkerDrag 计入 scrollMs');
  assert(/if \(markerDragRef\.current\) handleMarkerMove/.test(c), 'window 兜底跟踪物件拖拽');
  assert(/edgeScrollVelocity\(mdk\.x1 - r\.left, r\.width\)/.test(c), '帧循环边缘滚动 (lazer 参数)');
  assert(/mdk\.scrollMs \+= store\.currentTime - tBefore/.test(c), 'scrollMs 记实际滚动量 (seek 钳制安全)');
  assert(/mdk && mdk\.moved && !store\.playing/.test(c), '播放中不滚 (视图跟音频钟)');
}

section('CDP: 拖到右边缘时间轴自动滚动, 物件越出原视窗');
{
  const PORT = 9504;
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
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');
    await normalizeEnv(evalJs);

    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = base.timingPoints.find(p => p.uninherited);
      const tc = Math.round(red0.time + red0.beatLength * 8);
      const circle = { id: 491001, type: 'circle', x: 256, y: 192, time: tc, newCombo: true, comboSkip: 0, hitSound: 0 };
      store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [circle] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select'; store.seek(tc);
      await sleep(150);
      const out = { tc, t0: store.currentTime, win: 6000 / (store.beatmap.editor.timelineZoom || 1) };
      const canvas = [...document.querySelectorAll('canvas')].find(c => c.className.includes('h-[92px]'));
      if (!canvas) return { ...out, fail: 'no timeline canvas' };
      const rect = canvas.getBoundingClientRect();
      // 物件圆心 px (窗口以 currentTime 为中心)
      const pxOf = (t) => rect.left + ((t - (store.currentTime - out.win / 2)) / out.win) * rect.width;
      const fire = (type, x, y) => canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
      // 按下物件 (圆心命中, y 在物件行内)
      fire('mousedown', pxOf(tc), rect.top + 20);
      await sleep(80);
      out.armed = store.canvasDragging === true;
      // 拖到右边缘 5px 内 (edge 容差 40px 内 → 满速)
      fire('mousemove', rect.right - 5, rect.top + 20);
      await sleep(120);
      out.movedTime = store.beatmap.hitObjects[0].time;
      // 按住不动 900ms — 帧循环应持续右滚
      const ct0 = store.currentTime;
      await sleep(900);
      out.scrolled = store.currentTime - ct0;
      out.edgeTime0 = out.t0 + out.win / 2; // 不滚动时能到达的最右时刻
      out.finalTime = store.beatmap.hitObjects[0].time;
      out.finalCt = store.currentTime;
      // 松开 = commit
      fire('mouseup', rect.right - 5, rect.top + 20);
      await sleep(120);
      out.draggingAfterUp = store.canvasDragging;
      store.undo();
      await sleep(120);
      out.undoTime = store.beatmap.hitObjects[0].time;
      return out;
    })()`);

    assert(out.armed === true, `mousedown 命中物件进入拖拽 (${out.fail || 'armed'})`);
    assert(out.movedTime > out.tc, `拖到右边缘物件时间前移 (${out.tc} → ${out.movedTime})`);
    assert(out.scrolled > 300, `按住边缘 900ms 时间轴自动滚动 >300ms (实际 ${out.scrolled && out.scrolled.toFixed(0)}ms)`);
    assert(out.finalTime > out.edgeTime0 + 200,
      `物件被推出原视窗右缘 ${out.edgeTime0} (实际 ${out.finalTime}, +${out.finalTime - out.edgeTime0}ms)`);
    // 物件仍在指针附近 (指针时刻 = currentTime + win/2 - 5px 对应 ms, 吸附误差 ≤ 1 beat)
    const pointerT = out.finalCt + out.win / 2;
    assert(Math.abs(out.finalTime - pointerT) < 600, `物件跟随指针 (物件 ${out.finalTime}, 指针 ≈${pointerT.toFixed(0)})`);
    assert(out.draggingAfterUp === false, 'mouseup 结束拖拽');
    assert(out.undoTime === out.tc, `undo 一步还原 (${out.undoTime} = ${out.tc})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V491_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V491_ALL_TESTS_PASSED');
