// 验证器 v364: 放置滑条尾长吸附细分网格 — 全路径行为锁定 (调查结论: 当前构建无 "只吸 1/1" bug)
//  用户反馈: 拉滑条 (freehand 拖拉 / 点击放点后移动光标) 尾长只吸 1/1 整拍, 不吸当前细分。
//  CDP 实测结论 (本验证器锁定):
//   - 落盘 (finishSlider/finishFreehandSlider) 与两处预览 (v318 幽灵滑条 length / v82 顶部时间轴
//     pendingSliderTimeline 幻影条) 共用 placementLength → snapSliderLength, tick 网格 =
//     sliderLengthSnapDivisor(beatSnap) = 当前细分的 1/2 (v218, ×2 在配置内时), 全部正确吸附细分,
//     预览=落盘逐 ms 一致; "只吸 1/1" 不复现。
//   - 当时唯一产生"只吸 1/1"的路径是 distanceLock=true (锁定间距分支原设计吸附整拍, v145/v160) — 
//     用户随后确认症状时锁定间距确实开着; v365 起该分支按用户要求改为 间距倍率×节拍细分 网格
//     (本验证器 D 段已更新为 v365 新语义, 详细矩阵见 verifier/v365)。
//  附带: store.ts 调试暴露新增 __osuSnap (placementLength/pendingSliderTimeline 等纯函数),
//   供本验证器与后续排查直接断言吸附网格 (既有 __osuStore/__osuToClient 同款模式)。
// 运行: npm run build 后 node verifier/v364/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 吸附规则与调用链 (v218/v219 语义不动)');
{
  const sp = read('src/osu/sliderPath.ts');
  assert(/export function sliderLengthSnapDivisor\(beatSnap: number\): number \{\n\s+const half = beatSnap \* 2;\n\s+return BEAT_SNAP_OPTIONS\.includes\(half\) \? half : beatSnap;/.test(sp), '长度吸附细分 = 当前细分 1/2 (×2 在配置内), 否则退回当前细分');
  assert(/const div = sliderLengthSnapDivisor\(beatSnap\); \/\/ v218: 长度按当前细分的 1\/2 对齐/.test(sp), 'snapSliderLength 用 sliderLengthSnapDivisor (非整拍除数)');
  assert(/ticks === 1 && tickPx > geometryLength \+ vel \* 1/.test(sp), 'v219 例外保留: 亚 tick 几何对齐 1 tick (允许超几何)');
  const ec = read('src/components/EditorCanvas.tsx');
  const calls = ec.match(/placementLength\(bm\.timingPoints, store\.currentTime, bm\.difficulty\.sliderMultiplier,[\s\S]{0,120}?store\.beatSnap\)/g) ?? [];
  assert(calls.length >= 3, `幽灵/finishSlider/finishFreehandSlider 三处 placementLength 均传 store.beatSnap (${calls.length} 处)`);
  const tl = read('src/components/Timelines.tsx');
  assert(/pendingSliderTimeline\(bm\.timingPoints, bm\.difficulty\.sliderMultiplier,\n?\s+store\.pendingSlider, store\.pendingCursor, t, store\.beatSnap, store\.distanceLock, bm\.editor\.distanceSpacing\)/.test(tl), '顶部时间轴幻影条传 store.beatSnap');
  const st = read('src/osu/store.ts');
  assert(/__osuSnap.*placementLength, snapPlacementTime, pendingSliderTimeline, sliderLengthSnapDivisor, snapSliderLength/.test(st), '__osuSnap 调试暴露存在 (验证器直接断言吸附网格)');
}

section('CDP: 吸附网格扫描 / 交互预览=落盘 / freehand / distanceLock v365 新语义');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9497;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const electron = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: 'ignore' });
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
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(500);
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient && window.__osuSnap)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪 (含 __osuSnap)');
    await sleep(800); // 布局稳定

    // A: 纯函数扫描 — d ∈ {1,2,3,4,6,12} × 几何序列, 时间轴预览尾端必须落在 1/sliderLengthSnapDivisor(d)
    //    网格 (k 整数 ±0.05, len 取整 px 换算回 ms 有舍入), 且存在非整拍吸附 (证明不是只吸 1/1)
    const rA = await evalJs(`(() => {
      const store = window.__osuStore;
      const snap = window.__osuSnap;
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      const T = red.time + red.beatLength * 8;
      const sm = store.beatmap.difficulty.sliderMultiplier;
      const rows = [];
      for (const d of [1, 2, 3, 4, 6, 12]) {
        const div = snap.sliderLengthSnapDivisor(d);
        const tickMs = red.beatLength / div;
        let bad = 0, nonWhole = 0, n = 0;
        for (let geo = 30; geo <= 480; geo += 30) {
          const pv = snap.pendingSliderTimeline(store.beatmap.timingPoints, sm,
            [{ x: 128, y: 192 }, { x: 128 + geo, y: 192 }], null, T, d, false, 1);
          const off = pv.end - pv.time;
          const k = off / tickMs;
          n++;
          if (Math.abs(k - Math.round(k)) > 0.05) bad++;
          if (Math.abs(off / red.beatLength - Math.round(off / red.beatLength)) > 0.05) nonWhole++;
        }
        rows.push({ d, div, n, bad, nonWhole });
      }
      return rows;
    })()`);
    for (const r of rA) {
      assert(r.bad === 0, `A: beatSnap=1/${r.d} 扫描 ${r.n} 个几何全部落在 1/${r.div} 网格 (偏离 ${r.bad} 个)`);
      assert(r.nonWhole > 0, `A: beatSnap=1/${r.d} 存在非整拍吸附结果 (${r.nonWhole} 个) — 证明尾长不只吸 1/1`);
    }

    // B: 真实交互 (点击放头 + 幻影) — 预览 pendingSliderTimeline 与落盘 length 逐 ms 一致, 尾在细分网格
    const rB = await evalJs(`(async () => {
      const store = window.__osuStore;
      const snap = window.__osuSnap;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const rc = c.getBoundingClientRect();
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      const T = red.time + red.beatLength * 8;
      const sm = store.beatmap.difficulty.sliderMultiplier;
      const headCx = rc.left + rc.width * 0.25, headCy = rc.top + rc.height / 2;
      const fireC = (type, x, y, btn = 0) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: btn, bubbles: true, cancelable: true }));
      const rows = [];
      for (const d of [2, 3, 4]) {
        store.load({ ...store.beatmap, hitObjects: [] }, store.audioUrl);
        store.clearSelection(); store.tool = 'slider'; store.beatSnap = d; store.distanceLock = false;
        store.pause && store.pause();
        store.seek(T);
        fireC('mousemove', headCx, headCy); fireC('mousedown', headCx, headCy); fireC('mouseup', headCx, headCy);
        fireC('mousemove', headCx + 450, headCy); // ≈136 osu px 几何
        await sleep(250);
        const pv = snap.pendingSliderTimeline(store.beatmap.timingPoints, sm, store.pendingSlider, store.pendingCursor, store.currentTime, d, false, store.beatmap.editor.distanceSpacing);
        c.dispatchEvent(new MouseEvent('contextmenu', { clientX: headCx + 450, clientY: headCy, button: 2, bubbles: true, cancelable: true }));
        await sleep(120);
        const objs = store.beatmap.hitObjects;
        const o = objs[objs.length - 1];
        const vel = o.length / (pv.end - pv.time);
        const tickMs = red.beatLength / snap.sliderLengthSnapDivisor(d);
        const durMs = o.length / vel;
        rows.push({ d, pvOffMs: (pv.end - pv.time), durMs, pvTime: pv.time, oTime: o.time,
          k: durMs / tickMs, len: o.length, curveType: o.curveType });
      }
      return rows;
    })()`);
    for (const r of rB) {
      assert(Math.abs(r.pvOffMs - r.durMs) < 1.5, `B: beatSnap=1/${r.d} 预览时长 ${r.pvOffMs.toFixed(1)}ms = 落盘时长 ${r.durMs.toFixed(1)}ms (预览=落盘)`);
      assert(Math.abs(r.k - Math.round(r.k)) < 0.05, `B: beatSnap=1/${r.d} 落盘尾端在细分网格 (k=${r.k.toFixed(2)})`);
      assert(Math.abs(r.pvTime - r.oTime) <= 1, `B: beatSnap=1/${r.d} 预览起点 ${Math.round(r.pvTime)} = 落盘起点 ${r.oTime}`);
    }

    // C: freehand 按住拖拉 — 拖动中预览在细分网格, 松开后落盘也在细分网格
    const rC = await evalJs(`(async () => {
      const store = window.__osuStore;
      const snap = window.__osuSnap;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const rc = c.getBoundingClientRect();
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      const T = red.time + red.beatLength * 8;
      const sm = store.beatmap.difficulty.sliderMultiplier;
      const headCx = rc.left + rc.width * 0.25, headCy = rc.top + rc.height / 2;
      const fireC = (type, x, y, btn = 0) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: btn, bubbles: true, cancelable: true }));
      const fireW = (type, x, y) => window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      store.load({ ...store.beatmap, hitObjects: [] }, store.audioUrl);
      store.clearSelection(); store.tool = 'slider'; store.beatSnap = 4; store.distanceLock = false;
      store.pause && store.pause();
      store.seek(T);
      fireC('mousemove', headCx, headCy);
      fireC('mousedown', headCx, headCy);
      for (let i = 1; i <= 10; i++) { fireC('mousemove', headCx + i * 45, headCy + Math.sin(i / 10 * Math.PI) * 110); await sleep(25); }
      await sleep(250);
      const midPend = store.pendingSlider.length;
      const pv = snap.pendingSliderTimeline(store.beatmap.timingPoints, sm, store.pendingSlider, store.pendingCursor, store.currentTime, 4, false, store.beatmap.editor.distanceSpacing);
      const tickMs = red.beatLength / snap.sliderLengthSnapDivisor(4);
      const midK = (pv.end - pv.time) / tickMs;
      fireW('mouseup', headCx + 450, headCy);
      await sleep(150);
      const objs = store.beatmap.hitObjects;
      const o = objs[objs.length - 1];
      const vel = 1120 / red.beatLength; // 本谱该段 SV=4 (探针校准值); 仅用网格判定, 允许 ±5% vel 偏差
      const committedK = o ? (o.length / vel) / tickMs : -1;
      return { midPend, midK, committed: o ? { len: o.length, curveType: o.curveType } : null, committedK, tickMs };
    })()`);
    assert(rC.midPend > 2, `C: freehand 进行中 (拟合点 ${rC.midPend} > 2)`);
    assert(Math.abs(rC.midK - Math.round(rC.midK)) < 0.05, `C: freehand 拖动中时间轴预览尾端在 1/8 网格 (k=${rC.midK.toFixed(2)})`);
    assert(!!rC.committed && Math.abs(rC.committedK - Math.round(rC.committedK)) < 0.08, `C: freehand 落盘尾端在细分网格 (k=${rC.committedK.toFixed(2)}, len=${rC.committed?.len}, ${rC.committed?.curveType})`);

    // D: distanceLock 行为 — v365 有意变更: 用户确认症状时 distanceLock 开着, 要求锁定间距也统一按
    //    节拍细分吸附 (网格 = distanceSpacing × 细分步长, spacing=1.0 时 = 非锁定; 原 v145/v160 吸整拍语义废弃)。
    //    本段断言更新后的 v365 语义 (详细矩阵见 verifier/v365)。
    const rD = await evalJs(`(() => {
      const store = window.__osuStore;
      const snap = window.__osuSnap;
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      const T = red.time + red.beatLength * 8;
      const sm = store.beatmap.difficulty.sliderMultiplier;
      const tickPx = 1120 / snap.sliderLengthSnapDivisor(4); // 140 (beatPx 1120 探针校准, SV=4)
      // spacing=1.0: 272px ≈ 1.94 tick → 退一格 = 1 tick 140 (不再钳几何 272, 不再吸整拍)
      const sub = snap.placementLength(store.beatmap.timingPoints, T, sm, 272, true, 1, 4);
      // spacing=1.0: 2400px ≈ 17.1 tick → 17 tick = 2380 (≠ 整拍 2240)
      const over = snap.placementLength(store.beatmap.timingPoints, T, sm, 2400, true, 1, 4);
      // spacing=1.5: 2400px / (140×1.5=210) ≈ 11.4 步 → 11 步 = 2310
      const over15 = snap.placementLength(store.beatmap.timingPoints, T, sm, 2400, true, 1.5, 4);
      return { sub, over, over15, tickPx };
    })()`);
    assert(rD.sub === 140, `D: distanceLock spacing=1.0 亚拍几何 → 1 细分 tick (${rD.sub} = 140, v365: 不再钳几何/吸整拍)`);
    assert(rD.over === 2380, `D: distanceLock spacing=1.0 超拍几何 → 17 tick (${rD.over} = 2380, ≠ 整拍 2240)`);
    assert(rD.over15 === 2310, `D: distanceLock spacing=1.5 → 步长 1.5 tick (${rD.over15} = 11×210 = 2310)`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    electron.kill();
  }
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V364_FAILED: ${failures} 处失败` : '\nVERIFIER_V364_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
