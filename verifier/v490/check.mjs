// 验证器 v490: 多选滑条锚点的复制粘贴 — 从「插进当前滑条」改为「在光标处创建使用这些锚点的新滑条」
//   - pasteNodesAsNewSlider: 无选中滑条要求; 首锚点落光标 (取整); 时间 = 粘贴时刻吸附节拍网格;
//     长度 resnap; 一次 undo; 选中新滑条; 源滑条不变
// 运行: npm run build 后 node verifier/v490/check.mjs
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
  const st = read('src/osu/store.ts');
  assert(/private pasteNodesAsNewSlider\(atTime: number\)/.test(st), 'pasteNodesAsNewSlider 存在');
  assert(!/pasteNodesIntoSlider/.test(st), '旧 pasteNodesIntoSlider 已移除');
  assert(!/insertAnchorGroup|nearestOnSegment|computeStackOffsets/.test(st), 'store 不再引用插入管线 (已清理)');
}

section('CDP: 锚点粘贴创建新滑条');
{
  const PORT = 9503;
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

    // 源滑条 (100,100) L → (200,100) → (200,200); 选锚点 1,2 (200,100)/(200,200) 复制
    // → 剪贴板相对 (200,100): [(0,0),(0,100)]; 光标 (300,320) → 新滑条 (300,320)+(300,420)
    const out = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red0 = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red0.time + red0.beatLength * 4);
      const src = { id: 490001, type: 'slider', x: 100, y: 100, time: t, newCombo: true, comboSkip: 0,
        hitSound: 0, curveType: 'L', curvePoints: [{ x: 200, y: 100 }, { x: 200, y: 200 }], slides: 1, length: 200 };
      store.load({ ...base, timingPoints: [{ ...red0 }], hitObjects: [src] }, store.audioUrl);
      store.pause && store.pause(); store.tool = 'select';
      const out = {};
      // 多选锚点 1,2 → 复制
      store.selectedNodes.set(490001, new Set([1, 2]));
      store.copy();
      await sleep(100);
      // 清空一切选择 (证明无选中滑条要求) + 置光标 + 定位时刻
      store.select([]);
      store.selectedNodes.clear();
      const t2 = Math.round(red0.time + red0.beatLength * 12 + red0.beatLength / 4 + 0.3); // 非网格时刻 (验证吸附)
      store.seek(t2);
      store.cursorOsu = { x: 300.4, y: 319.6 };
      const before = store.beatmap.hitObjects.length;
      store.paste(store.currentTime);
      await sleep(200);
      const bm2 = store.beatmap;
      const src2 = bm2.hitObjects.find(o => o.id === 490001);
      const neo = bm2.hitObjects.find(o => o.id !== 490001);
      out.count = bm2.hitObjects.length - before;
      out.srcUnchanged = src2 && src2.x === 100 && src2.y === 100 && src2.curvePoints.length === 2
        && src2.curvePoints[0].x === 200 && src2.curvePoints[1].y === 200;
      out.neo = neo ? { type: neo.type, x: neo.x, y: neo.y, cps: neo.curvePoints, time: neo.time,
        len: neo.length, selected: store.selected.has(neo.id), selCount: store.selected.size } : null;
      out.expectTime = Math.round(window.__osuSnap.snapPlacementTime(bm2.timingPoints, store.currentTime, store.beatSnap));
      // undo 一步还原
      store.undo();
      await sleep(150);
      const bm3 = store.beatmap;
      out.undone = bm3.hitObjects.length === before && bm3.hitObjects.every(o => o.id === 490001);
      return out;
    })()`);

    assert(out.count === 1, `粘贴新增 1 个物件 (实际 ${out.count})`);
    assert(out.srcUnchanged === true, '源滑条完全不变 (不再插入当前滑条)');
    assert(out.neo && out.neo.type === 'slider', `新物件是滑条 (${JSON.stringify(out.neo)})`);
    assert(out.neo && out.neo.x === 300 && out.neo.y === 320, `首锚点落光标取整 (300,320) (实际 ${out.neo && out.neo.x},${out.neo && out.neo.y})`);
    assert(out.neo && out.neo.cps.length === 1 && out.neo.cps[0].x === 300 && out.neo.cps[0].y === 420,
      `第二锚点保持相对偏移 (300,420) (实际 ${out.neo && JSON.stringify(out.neo.cps)})`);
    assert(out.neo && out.neo.time === out.expectTime, `时间吸附节拍网格 (期望 ${out.expectTime}, 实际 ${out.neo && out.neo.time})`);
    assert(out.neo && out.neo.len > 50, `长度已 resnap (实际 ${out.neo && out.neo.len})`);
    assert(out.neo && out.neo.selected && out.neo.selCount === 1, '粘贴后选中新滑条');
    assert(out.undone === true, 'undo 一步还原');

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile);
  }
}

if (failures > 0) { console.error(`\nVERIFIER_V490_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V490_ALL_TESTS_PASSED');
