// 验证器 v365: 锁定间距 (distanceLock) 滑条尾长统一按节拍细分吸附 (用户确认 v364 症状时锁定间距开着,
//  要求锁定间距也不按整拍吸附) — placementLength distanceLock 分支: 网格 = distanceSpacing × 细分步长
//  (normal 分支同一 sliderLengthSnapDivisor 网格; lazer DistanceSnapProvider.GetBeatSnapDistance 与倍率
//  无关、消费方自乘倍率, 即此语义)。spacing=1.0 与关闭锁定间距完全一致; v218/v219 规则 (超几何退一格/
//  亚步长对齐 1 步允许超几何) 在该分支同样适用。原 v145/v160 "吸整拍" 语义废弃 (v364 D 段已同步更新)。
//  影响面 = placementLength 全部调用方 (v318 幽灵滑条/finishSlider/finishFreehandSlider/v82 时间轴幻影),
//  预览=落盘自动一致; 圆圈/物件放置间距不走此函数, 不受影响。
// 运行: npm run build 后 node verifier/v365/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: distanceLock 分支 = 间距倍率 × 细分网格');
{
  const sp = read('src/osu/sliderPath.ts');
  assert(/const stepPx = tickPx \* distanceSpacing;/.test(sp), '步长 = 间距倍率 × 细分 tick');
  assert(/let steps = Math\.round\(geometryLength \/ stepPx\);\n\s+if \(steps \* stepPx > geometryLength \+ vel \* 1\) steps -= 1;/.test(sp), '就近取步 + 超几何 1ms 退一格 (v218 规则同分支适用)');
  assert(/steps === 1 && stepPx > geometryLength \+ vel \* 1\) return Math\.max\(1, snapped\);/.test(sp), 'v219 同款例外: 亚步长对齐 1 步允许超几何');
  assert(!/let beats = Math\.round\(geometryLength \/ beatPx\);/.test(sp), '旧整拍吸附公式已移除');
  assert(/const tickPx = vel \* red\.beatLength \/ sliderLengthSnapDivisor\(beatSnap\);[\s\S]{0,200}if \(distanceLock && distanceSpacing > 0 && tickPx > 0\)/.test(sp), 'distanceLock 分支与非锁定共用同一 sliderLengthSnapDivisor 网格');
}

section('CDP: spacing×beatSnap 矩阵 / 预览=落盘 / v219 例外 / spacing=1.0 等价非锁定');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9498;
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

    // 校准 beatPx (锁定关, d=1 超短滑条 → v219 对齐 1 tick = beatPx/2)
    const calib = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const rc = c.getBoundingClientRect();
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      const fireC = (type, x, y, btn = 0) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: btn, bubbles: true, cancelable: true }));
      const headCx = rc.left + rc.width * 0.25, headCy = rc.top + rc.height / 2;
      store.load({ ...store.beatmap, hitObjects: [] }, store.audioUrl);
      store.clearSelection(); store.tool = 'slider'; store.beatSnap = 1; store.distanceLock = false;
      store.pause && store.pause();
      store.seek(red.time + red.beatLength * 8);
      fireC('mousemove', headCx, headCy); fireC('mousedown', headCx, headCy); fireC('mouseup', headCx, headCy);
      fireC('mousemove', headCx + 60, headCy); await sleep(120);
      c.dispatchEvent(new MouseEvent('contextmenu', { clientX: headCx + 60, clientY: headCy, button: 2, bubbles: true, cancelable: true }));
      await sleep(120);
      const o = store.beatmap.hitObjects[store.beatmap.hitObjects.length - 1];
      return { beatPx: o.length * 2, beatLength: red.beatLength };
    })()`);
    console.log(`  info: beatPx=${calib.beatPx} beatLength=${calib.beatLength.toFixed(1)}`);

    // A: 函数矩阵 — spacing ∈ {1.0, 1.5} × d ∈ {2, 4} × 几何扫描: 结果在 spacing×细分网格,
    //    ≤ 几何 (或 v219 例外 1 步), 且 spacing=1.0 时与非锁定逐值相等
    const rA = await evalJs(`(() => {
      const store = window.__osuStore;
      const snap = window.__osuSnap;
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      const T = red.time + red.beatLength * 8;
      const sm = store.beatmap.difficulty.sliderMultiplier;
      const beatPx = ${calib.beatPx};
      const rows = [];
      for (const d of [2, 4]) {
        const tickPx = beatPx / snap.sliderLengthSnapDivisor(d);
        for (const spacing of [1.0, 1.5]) {
          const stepPx = tickPx * spacing;
          let bad = 0, n = 0, eqUnlock = 0, overGeo = 0;
          for (let geo = 40; geo <= 1300; geo += 40) {
            const len = snap.placementLength(store.beatmap.timingPoints, T, sm, geo, true, spacing, d);
            n++;
            const k = len / stepPx;
            const v219 = len === Math.round(stepPx) && stepPx > geo + beatPx / red.beatLength; // 1 步且步长超几何
            if (Math.abs(k - Math.round(k)) > 0.05) bad++;
            if (len > geo && !v219) overGeo++;
            if (spacing === 1.0) {
              const un = snap.placementLength(store.beatmap.timingPoints, T, sm, geo, false, 1, d);
              if (len === un) eqUnlock++;
            }
          }
          rows.push({ d, spacing, stepPx: Math.round(stepPx * 10) / 10, n, bad, overGeo, eqUnlock });
        }
      }
      return rows;
    })()`);
    for (const r of rA) {
      assert(r.bad === 0, `A: d=1/${r.d} spacing=${r.spacing} 扫描 ${r.n} 个几何全部落在 ${r.stepPx}px 步网格 (偏离 ${r.bad})`);
      assert(r.overGeo === 0, `A: d=1/${r.d} spacing=${r.spacing} 除 v219 例外外不超几何 (违规 ${r.overGeo})`);
      if (r.spacing === 1.0) assert(r.eqUnlock === r.n, `A: d=1/${r.d} spacing=1.0 与非锁定逐值相等 (${r.eqUnlock}/${r.n})`);
    }

    // B: v219 例外在 distanceLock 下生效 — 几何不足 1 步 → 对齐 1 步 (允许超几何)
    const rB = await evalJs(`(() => {
      const store = window.__osuStore;
      const snap = window.__osuSnap;
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      const T = red.time + red.beatLength * 8;
      const sm = store.beatmap.difficulty.sliderMultiplier;
      const beatPx = ${calib.beatPx};
      const tickPx = beatPx / snap.sliderLengthSnapDivisor(2); // d=2 → div=4
      const stepPx = tickPx * 1.5;
      const len = snap.placementLength(store.beatmap.timingPoints, T, sm, 100, true, 1.5, 2); // 100 ≪ 1 步
      return { len, stepPx: Math.round(stepPx * 10) / 10 };
    })()`);
    assert(rB.len === Math.round(rB.stepPx), `B: 亚步长几何 (100px ≪ ${rB.stepPx}px) → 对齐 1 步 ${rB.len} (v219 例外, 允许超几何)`);

    // C: 真实交互 — distanceLock 开, spacing {1.0, 1.5} × d {2, 4}: 预览 = 落盘, 尾端在步网格
    const rC = await evalJs(`(async () => {
      const store = window.__osuStore;
      const snap = window.__osuSnap;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const rc = c.getBoundingClientRect();
      const red = store.beatmap.timingPoints.find(p => p.uninherited);
      const T = red.time + red.beatLength * 8;
      const sm = store.beatmap.difficulty.sliderMultiplier;
      const beatPx = ${calib.beatPx};
      const headCx = rc.left + rc.width * 0.25, headCy = rc.top + rc.height / 2;
      const fireC = (type, x, y, btn = 0) => c.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: btn, bubbles: true, cancelable: true }));
      const rows = [];
      for (const d of [2, 4]) {
        for (const spacing of [1.0, 1.5]) {
          store.load({ ...store.beatmap, hitObjects: [] }, store.audioUrl);
          store.clearSelection(); store.tool = 'slider'; store.beatSnap = d;
          store.setEditorField('distanceSpacing', spacing);
          store.distanceLock = true;
          store.pause && store.pause();
          store.seek(T);
          fireC('mousemove', headCx, headCy); fireC('mousedown', headCx, headCy); fireC('mouseup', headCx, headCy);
          fireC('mousemove', headCx + 450, headCy); // ≈136 osu px 几何
          await sleep(250);
          const pv = snap.pendingSliderTimeline(store.beatmap.timingPoints, sm, store.pendingSlider, store.pendingCursor, store.currentTime, d, true, spacing);
          c.dispatchEvent(new MouseEvent('contextmenu', { clientX: headCx + 450, clientY: headCy, button: 2, bubbles: true, cancelable: true }));
          await sleep(120);
          const objs = store.beatmap.hitObjects;
          const o = objs[objs.length - 1];
          const stepPx = beatPx / snap.sliderLengthSnapDivisor(d) * spacing;
          rows.push({ d, spacing, pvOffMs: pv.end - pv.time, len: o?.length, k: o ? o.length / stepPx : -1, stepPx: Math.round(stepPx * 10) / 10 });
        }
      }
      store.distanceLock = false; store.setEditorField('distanceSpacing', 1);
      return rows;
    })()`);
    for (const r of rC) {
      const vel = calib.beatPx / calib.beatLength;
      assert(Math.abs(r.pvOffMs - r.len / vel) < 1.5, `C: d=1/${r.d} spacing=${r.spacing} 预览时长 ${r.pvOffMs.toFixed(1)}ms = 落盘 ${(r.len / vel).toFixed(1)}ms (len=${r.len})`);
      assert(Math.abs(r.k - Math.round(r.k)) < 0.05, `C: d=1/${r.d} spacing=${r.spacing} 落盘尾端在 ${r.stepPx}px 步网格 (k=${r.k.toFixed(2)})`);
    }

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

console.log(failures ? `\nVERIFIER_V365_FAILED: ${failures} 处失败` : '\nVERIFIER_V365_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
