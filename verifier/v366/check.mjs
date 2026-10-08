// 验证器 v366: SV 绿线边界处放置预览 ≠ 落盘 — 用户反馈"当前时间正好位于改变 SV 的绿线上时,
//  放置预览异常使用上一根绿线的 SV"。根因不是边界比较 (< vs <=; svPointAt/timingAt 本来就是
//  包含式, 绿线精确时间上该绿线生效, 与 osu 一致), 而是【时间基准分裂】: 预览各路径
//  (v318 幽灵滑条 length / pendingSliderTimeline 时间轴幻影 / renderer drawPendingSlider 截断)
//  全部用 store.currentTime 取 SV/算长度, 落盘物件却是 o.time = round(snapPlacementTime(...))
//  (就近吸附, 可落到 currentTime 之前), 渲染/实际行为用 sliderVelocityAt(o.time)。绿线落在吸附
//  tick 与 currentTime 之间时两侧 SV 不同 → 预览 ≠ 落盘 (±1ms seek 即可复现, 时长差一整倍)。
// 修复 (统一为落盘语义 — 物件恰在绿线上时该绿线生效):
//  1. placementLength 内部先把基准时间吸附+取整 (t = round(snapPlacementTime(...)) = 落盘 o.time
//     同公式), timingAt/vel/tickPx/snapSliderLength 全部以 t 为准; 所有调用方 (幽灵/finishSlider/
//     finishFreehandSlider/renderer 截断/pendingSliderTimeline) 自动一致。红线 (BPM) 同类问题由
//     同一机制覆盖 (snapAcrossRedLine 吸到下一红线起点时 vel/tick 用新红线 beatLength, 与落盘同源)。
//  2. pendingSliderTimeline: time = round(snapPlacementTime(...)), vel 用该 time (= 落盘时刻)。
//  3. EditorCanvas 幽灵: 撤销 v363 的 ghostTime = max(snap, now) 钳制 (它让幽灵渲染时间与落盘时间
//     不同源, 反而加重分裂), 幽灵 time 改回落盘时间公式。
//  4. renderer 主渲染循环: 放置幽灵 (id<0) 抗淡出 — dt 钳到 <0 (按"即将到来"渲染, dtRaw>=0 时
//     alpha 强制 1), 取代 v363 钳制的抗淡出作用, 且不改变幽灵的 timing 身份 (combo 排序也与落盘一致)。
// 运行: npm run build 后 node verifier/v366/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: placementLength/pendingSliderTimeline 基准时间 = 落盘时刻 (吸附+取整)');
{
  const sp = read('src/osu/sliderPath.ts');
  assert(/export function placementLength\([\s\S]{0,300}?const t = Math\.round\(snapPlacementTime\(points, currentTime, beatSnap\)\);/.test(sp),
    'placementLength 内部先吸附+取整基准时间 (= 落盘 o.time 同公式)');
  assert(/const t = Math\.round\(snapPlacementTime\(points, currentTime, beatSnap\)\);\s+const \{ red \} = timingAt\(points, t\);\s+const vel = sliderVelocityAt\(points, t, sliderMultiplier\);/.test(sp),
    'placementLength 的 timing/vel 以吸附后时刻 t 为准');
  assert(/const snapped = snapSliderLength\(points, t, sliderMultiplier, geometryLength, beatSnap\);/.test(sp),
    'snapSliderLength 同样以 t 为参考时刻 (lazer referenceTime = 滑条头)');
  assert(/const time = Math\.round\(snapPlacementTime\(points, currentTime, beatSnap\)\);\s+const vel = sliderVelocityAt\(points, time, sliderMultiplier\);/.test(sp),
    'pendingSliderTimeline: time 取整且 vel 用落盘时刻');
}

section('源码: 幽灵 time = 落盘时间公式 (v363 钳制撤销), 抗淡出移到 renderer');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(!/ghostTime/.test(ec), 'EditorCanvas 不再有 ghostTime 钳制 (幽灵与落盘同时间源)');
  assert(/time: Math\.round\(snapTime\(store\.currentTime\)\), newCombo: store\.placeNewCombo/.test(ec), '圆圈幽灵 time = 落盘公式');
  assert(/time: Math\.round\(snapPlacementTime\(bm\.timingPoints, store\.currentTime, store\.beatSnap\)\),/.test(ec), '滑条幽灵 time = 落盘公式');
  const rd = read('src/osu/renderer.ts');
  assert(/const ghost = o\.id < 0;/.test(rd) && /const dt = ghost \? Math\.min\(dtRaw, -0\.001\) : dtRaw;/.test(rd),
    'renderer: 放置幽灵 (id<0) dt 钳到 <0 (按即将到来渲染)');
  assert(/const alpha = ghost && dtRaw >= 0 \? 1 : alphaAt\(bm, o, time\);[\s\S]{0,200}?if \(alpha <= 0/.test(rd),
    'renderer: 幽灵吸附到过去 tick 时 alpha 强制 1, 在 alpha<=0 剔除之前生效');
}

section('CDP: SV 绿线 ±0ms/±1ms + off-grid + 红线 预览=落盘 (length/velocity/时长)');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9499;
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
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient && window.__osuSnap && window.__osuSnap.sliderVelocityAt)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪 (含 __osuSnap.sliderVelocityAt)');
    await sleep(800); // 布局稳定

    // 场景执行器: 给定 timing 附加点 + currentTime, 真实鼠标放滑条 (头点 + 幻影 450 client px + 右键落盘),
    //   右键前一刻取 pendingSliderTimeline 预览, 右键后取落盘物件, 返回对照数据
    const run = async (name, extraPoints, currentTime) => await evalJs(`(async () => {
      const store = window.__osuStore;
      const snap = window.__osuSnap;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const rc = c.getBoundingClientRect();
      const mk = (time, beatLength, uninherited) => ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0 });
      const pts = [mk(500, 500, true), mk(1000, -100, false), ...${JSON.stringify(extraPoints)}.map(p => mk(p[0], p[1], p[2]))]
        .sort((a, b) => a.time - b.time);
      store.load({ ...store.beatmap, timingPoints: pts, hitObjects: [] }, store.audioUrl);
      store.clearSelection(); store.tool = 'slider'; store.beatSnap = 4; store.distanceLock = false;
      store.pause && store.pause();
      store.seek(${currentTime});
      const headCx = rc.left + rc.width * 0.25, headCy = rc.top + rc.height / 2;
      const fireC = (type, x, y) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
      fireC('mousemove', headCx, headCy); fireC('mousedown', headCx, headCy); fireC('mouseup', headCx, headCy);
      // 幻影点放在 osu 坐标 +160px 处 (经 __osuToClient 换算) — 各 SV/BPM  regime 下都稳居 tick 桶中央,
      //   避开 v218 "超几何 1ms 退一格" 边界, 保证预览/落盘几何差 (落点吸附漂移) 不改长度桶
      const p0 = store.pendingSlider[0];
      let tail = window.__osuToClient(p0.x + 160, p0.y);
      fireC('mousemove', tail.x, tail.y);
      await sleep(250);
      if (!store.pendingCursor) { fireC('mousemove', tail.x + 1, tail.y); await sleep(250); } // 偶发幻影未注册重试
      // v368 回归 flaky 加固: 幻影-头距离应 ≈160 osu px; 偏差大 (偶发布局未稳/坐标换算漂移) 时按当前
      //   布局重算 tail 再悬停一次, 并让后续右键落点也用新 tail, 保证预览/落盘几何同桶
      const pc0 = store.pendingCursor;
      if (pc0 && Math.abs(Math.hypot(pc0.x - p0.x, pc0.y - p0.y) - 160) > 40) {
        tail = window.__osuToClient(p0.x + 160, p0.y);
        fireC('mousemove', tail.x, tail.y);
        await sleep(250);
      }
      const sm = store.beatmap.difficulty.sliderMultiplier;
      const pv = snap.pendingSliderTimeline(store.beatmap.timingPoints, sm, store.pendingSlider, store.pendingCursor, store.currentTime, 4, false, 1);
      const pvVel = snap.sliderVelocityAt(store.beatmap.timingPoints, pv.time, sm);
      const pc = store.pendingCursor;
      const geoHint = pc ? Math.hypot(pc.x - p0.x, pc.y - p0.y) : -1; // v368 回归 flaky 诊断: 幻影-头 osu 距离
      c.dispatchEvent(new MouseEvent('contextmenu', { clientX: tail.x, clientY: tail.y, button: 2, bubbles: true, cancelable: true }));
      await sleep(120);
      const objs = store.beatmap.hitObjects;
      const o = objs[objs.length - 1];
      if (!o || o.type !== 'slider') return { name: '${name}', error: 'no slider placed' };
      const oVel = snap.sliderVelocityAt(store.beatmap.timingPoints, o.time, sm);
      return { name: '${name}', pvTime: pv.time, oTime: o.time, pvDur: pv.end - pv.time, oDur: o.length / oVel,
        pvVel, oVel, len: o.length, geoHint, curT: store.currentTime };
    })()`);

    const check = (r, label) => {
      if (r.error) { assert(false, `${label}: 落盘失败 (${r.error})`); return; }
      const diag = `(geoHint=${r.geoHint?.toFixed(0)} curT=${r.curT} pvVel=${r.pvVel?.toFixed(3)} oVel=${r.oVel?.toFixed(3)})`;
      assert(Math.abs(r.pvTime - r.oTime) <= 0.5, `${label}: 预览时刻 ${r.pvTime} = 落盘时刻 ${r.oTime} ${diag}`);
      assert(Math.abs(r.pvVel - r.oVel) < 1e-9, `${label}: 预览/落盘同一 velocity (${r.pvVel.toFixed(4)} px/ms; 修复前绿线夹在两时刻之间时差 2 倍) ${diag}`);
      assert(Math.abs(r.pvDur - r.oDur) <= 1.5, `${label}: 预览时长 ${r.pvDur.toFixed(1)}ms = 落盘时长 ${r.oDur.toFixed(1)}ms (len=${r.len}) ${diag}`);
      assert(r.len >= 20, `${label}: 落盘长度有效 (len=${r.len})`);
    };

    // A: SV 绿线在 1/4 网格上 (T_g=3000, SV 1.0x→2.0x), seek 精确时间 ±0ms/±1ms 三组 (用户原话场景)
    check(await run('A:T_g-1ms', [[3000, -50, false]], 2999), 'A: 绿线精确时间-1ms (就近吸附跨过绿线)');
    check(await run('A:T_g+0ms', [[3000, -50, false]], 3000), 'A: 绿线精确时间±0ms (物件恰在绿线上, 该绿线生效)');
    check(await run('A:T_g+1ms', [[3000, -50, false]], 3001), 'A: 绿线精确时间+1ms');

    // B: SV 绿线 off-grid (T_g=3060), currentTime=3060 → 吸附落 3000 (绿线之前): 预览曾用新 SV, 落盘用旧
    check(await run('B:off-grid', [[3060, -50, false]], 3060), 'B: off-grid 绿线, 吸附到绿线前 tick');

    // C: SV 绿线 off-grid (T_g=3100), currentTime=3099 → 吸附落 3125 (绿线之后): 用户报告方向 — 预览曾用上一根绿线 SV
    check(await run('C:off-grid', [[3100, -50, false]], 3099), 'C: off-grid 绿线, 吸附跨过绿线到后 tick');

    // D: 红线 (BPM) 同类问题 — red2@5000 beatLength 1000 (BPM 减半), currentTime=4999 → snapAcrossRedLine 吸到 5000
    check(await run('D:red-line', [[5000, 1000, true]], 4999), 'D: 红线前 1ms, 吸附到红线起点 (新 beatLength 生效)');

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

console.log(failures ? `\nVERIFIER_V366_FAILED: ${failures} 处失败` : '\nVERIFIER_V366_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
