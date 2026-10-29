// v515: 放置/预览可吸附到选中参考滑条的尾点；拖拽仍排除选中物件防自锁
// 运行: npm run build 后 node verifier/v515/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

console.log('== A: 源码契约');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert((src.match(/v515:/g) ?? []).length >= 2, 'snapPlacement 与控制点均标记 v515');
  assert((src.match(/objectSnapPoints\(bm0, bm0\.hitObjects\.filter\(o => isVisibleAt/g) ?? []).length === 1, '控制点不再排除选中参考滑条');
  assert(/snapDragDelta\(dragPts, objectSnapPoints\(bm, bm\.hitObjects\.filter\(o => !store\.selected\.has\(o\.id\)/.test(src), '拖拽仍排除选中物件防自锁');
}

console.log('== B: CDP 选中参考滑条尾吸附');
{
  const PORT = 9529;
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT);
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = targets.find(t => t.type === 'page' && /127\.0\.0\.1:\d+/.test(t.url));
      } catch { }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('找不到 Electron 页面目标');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise(resolve => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);

    const result = await evalJs(`(async () => {
      const s = window.__osuStore;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const base = s.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const slider = { id: 515001, type: 'slider', x: 100, y: 100, time: 5000, newCombo: true, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: 200, y: 100 }], slides: 1, length: 100 };
      const c = document.querySelector('canvas.cursor-crosshair');
      const reset = tool => {
        s.load({ ...base, hitObjects: [slider], timingPoints: [{ ...red, time: 0 }] }, s.audioUrl);
        s.pause(); s.seek(5000); s.select([515001]); s.setSelectedNodes([]);
        s.tool = tool; s.pendingSlider = []; s.pendingSpinner = null; s.pendingCursor = null;
        s.gridSnap = false; s.distanceLock = false; s.objectSnapEnabled = true; s.geoEnabled = false;
        s.canvasDragging = false; s.emit();
      };
      const move = async (x, y) => {
        const pt = window.__osuToClient(x, y);
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x, clientY: pt.y, bubbles: true }));
        await sleep(100);
      };
      const out = {};
      reset('circle');
      await move(203, 102);
      out.preview = s.placementPreview ? { ...s.placementPreview } : null;
      const pt = window.__osuToClient(203, 102);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true }));
      await sleep(60);
      const circle = s.beatmap.hitObjects.find(o => o.type === 'circle');
      out.placed = circle ? { x: circle.x, y: circle.y } : null;

      reset('slider');
      s.pendingSlider = [{ x: 50, y: 50 }];
      await move(203, 102);
      out.ctrl = s.pendingCursor ? { ...s.pendingCursor } : null;
      s.objectSnapEnabled = false;
      await move(203, 102);
      out.disabled = s.pendingCursor ? { ...s.pendingCursor } : null;
      return out;
    })()`);

    assert(result.preview?.x === 200 && result.preview?.y === 100, `圆圈预览吸到选中滑条尾 (${JSON.stringify(result.preview)})`);
    assert(result.placed?.x === 200 && result.placed?.y === 100, `实际落盘也吸到尾点 (${JSON.stringify(result.placed)})`);
    assert(result.ctrl?.x === 200 && result.ctrl?.y === 100, `滑条控制点预览吸到尾点 (${JSON.stringify(result.ctrl)})`);
    assert(Math.abs(result.disabled?.x - 203) < 0.3 && Math.abs(result.disabled?.y - 102) < 0.3,
      `总开关关闭后不吸，仅保留坐标换算误差 (${JSON.stringify(result.disabled)})`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V515_FAILED: ${failures} 处失败` : '\nVERIFIER_V515_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
