// v513: 已选滑条与另一滑条/物件重叠时 Ctrl 插点；其它离轨锚点不误插
// 运行: npm run build 后 node verifier/v513/check.mjs
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
  assert(/const onOwnTrack = sliderHitAt\(bm, so/.test(src), '自身轨道使用 v512 同口径测量');
  assert(/nearestNode\(otherSliders, offs, p, devicePxPerOsu\(\)\)/.test(src), '其它滑条离轨锚点交还后续处理');
  assert(/opts\?\.allowBlankInsert === false/.test(src), '时间轴禁止空白插点语义保留');
  assert(!/const hitObj = hitTestAll\(/.test(src), '不恢复 v495 已撤销的 hitTestAll 穿透');
}

console.log('== B: CDP 重叠插点真值表');
{
  const PORT = 9527;
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
      const c = document.querySelector('canvas.cursor-crosshair');
      const line = (id, x1, y1, x2, y2) => ({ id, type: 'slider', x: x1, y: y1, time: 5000, newCombo: true, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: x2, y: y2 }], slides: 1, length: Math.hypot(x2 - x1, y2 - y1) });
      const circle = (id, x, y) => ({ id, type: 'circle', x, y, time: 5000, newCombo: false, comboSkip: 0, hitSound: 0 });
      const curved = (id) => ({ id, type: 'slider', x: 400, y: 100, time: 5000, newCombo: true, comboSkip: 0, hitSound: 0,
        curveType: 'B', curvePoints: [{ x: 450, y: 200 }, { x: 500, y: 100 }], slides: 1, length: 160 });
      const load = (objects, selected) => {
        s.load({ ...base, hitObjects: objects, timingPoints: [{ ...red, time: 0 }] }, s.audioUrl);
        s.pause(); s.tool = 'select'; s.seek(5000); s.playfieldPanEnabled = false;
        s.select([selected]); s.setSelectedNodes([]);
      };
      const click = async (x, y) => {
        const pt = window.__osuToClient(x, y);
        c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
        await sleep(60);
      };
      const pts = id => s.beatmap.hitObjects.find(o => o.id === id)?.curvePoints.length;
      const out = {};

      load([line(513001, 100, 100, 300, 100), circle(513002, 200, 100)], 513001);
      await click(200, 100);
      out.circleOverlap = { pts: pts(513001), a: s.selected.has(513001), other: s.selected.has(513002) };

      load([line(513011, 100, 100, 300, 100), line(513012, 200, 40, 200, 260)], 513011);
      await click(200, 100);
      out.sliderOverlap = { pts: pts(513011), a: s.selected.has(513011), other: s.selected.has(513012) };

      load([line(513021, 100, 100, 300, 100), circle(513022, 400, 300)], 513021);
      await click(400, 300);
      out.onlyOther = { pts: pts(513021), a: s.selected.has(513021), other: s.selected.has(513022) };

      load([line(513031, 100, 100, 300, 100), curved(513032)], 513031);
      await click(450, 200);
      out.otherAnchor = { aPts: pts(513031), bAnchorCopies: s.beatmap.hitObjects.find(o => o.id === 513032).curvePoints.filter(p => p.x === 450 && p.y === 200).length,
        a: s.selected.has(513031), b: s.selected.has(513032) };

      load([line(513041, 400, 200, 500, 200), curved(513042)], 513041);
      await click(450, 200);
      out.ownTrackOtherAnchor = { pts: pts(513041), a: s.selected.has(513041), b: s.selected.has(513042) };

      load([line(513051, 100, 100, 300, 100)], 513051);
      await click(420, 320);
      out.blank = { pts: pts(513051), only: s.selected.size === 1 && s.selected.has(513051) };
      return out;
    })()`);

    assert(result.circleOverlap.pts === 2 && result.circleOverlap.a && !result.circleOverlap.other,
      `自身轨道叠圆圈仍插点 (${JSON.stringify(result.circleOverlap)})`);
    assert(result.sliderOverlap.pts === 2 && result.sliderOverlap.a && !result.sliderOverlap.other,
      `自身轨道叠另一滑条仍插点 (${JSON.stringify(result.sliderOverlap)})`);
    assert(result.onlyOther.pts === 1 && result.onlyOther.other,
      `仅命中其它物件不插点，走 Ctrl 多选 (${JSON.stringify(result.onlyOther)})`);
    assert(result.otherAnchor.aPts === 1 && result.otherAnchor.bAnchorCopies === 2 && result.otherAnchor.b && !result.otherAnchor.a,
      `其它离轨锚点交还其滑条（Ctrl 转红形成重合点对，非误插新位置） (${JSON.stringify(result.otherAnchor)})`);
    assert(result.ownTrackOtherAnchor.pts === 2 && result.ownTrackOtherAnchor.a && !result.ownTrackOtherAnchor.b,
      `自身轨道与离轨锚点重叠仍插点 (${JSON.stringify(result.ownTrackOtherAnchor)})`);
    assert(result.blank.pts === 2 && result.blank.only, `纯空白插点保持 (${JSON.stringify(result.blank)})`);
    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 异常:', e.stack || e.message);
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V513_FAILED: ${failures} 处失败` : '\nVERIFIER_V513_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
