// 验证器 v440: 存在已选滑条时 Alt 框选只框已选滑条的锚点
// 需求 (soulten): 「點選slider(可複選slider) 存在被點選過的slider就只能框選被點選的slider的點」
// 改动: recomputeMarqueeSelection 节点框选收窄链最前加「物件选区里的滑条」口径 —
//   选区含滑条 → 框选候选只取这些滑条的锚点 (不再触发 v371b 第一框到滑条收窄);
//   无已选滑条 → 维持现状 (v371a Alt 点选滑条 / v371b 第一框到滑条)。
//   依赖 v441 (Alt 不再清物件选区) 才能在框选期间保持「已选滑条」集合。
// 运行: npm run build 后 node verifier/v440/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 已选滑条优先收窄');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v440: 物件选区里有滑条时最优先/.test(ec), 'v440 版本注释');
  const fn = ec.match(/const recomputeMarqueeSelection = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert(fn.length > 0, 'recomputeMarqueeSelection 存在');
  assert(/selSliderIds = new Set\(bm\.hitObjects\.filter\(o => o\.type === 'slider' && store\.selected\.has\(o\.id\)\)/.test(fn), '收集选区内滑条 id');
  const iSel = fn.indexOf('selSliderIds.size');
  const iAlt = fn.indexOf('store.altPickSliders.size');
  const iFirst = fn.indexOf('firstFramedSliderId');
  assert(iSel > 0 && iAlt > iSel && iFirst > iAlt, '收窄优先级: 已选滑条 > Alt 点选 (v371a) > 第一框到 (v371b)');
}

section('CDP: Alt 框选收窄到已选滑条');
{
  const PORT = 9498;
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
    await normalizeEnv(evalJs);
    await evalJs(`window.__osuSetLang && window.__osuSetLang('en')`);
    await sleep(800);

    // 440001 (100,100)-(300,100) 距框选起点近; 440002 (100,260)-(300,260) 远
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      const mk = (id, y) => ({ id, type: 'slider', x: 100, y, time: t, newCombo: false, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: 300, y }], slides: 1, length: 200 });
      store.load({ ...base, hitObjects: [mk(440001, 100), mk(440002, 260)] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t + 5);
      store.clearSelection(); store.setSelectedNodes([]);
    })()`);

    // 框选动作: Alt+从 (50,50) 拖到 (400,340) (覆盖两滑条全部锚点)
    const marquee = `(async (selIds) => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.clearSelection(); store.setSelectedNodes([]);
      if (selIds.length) store.select(selIds);
      const c = document.querySelector('canvas.cursor-crosshair');
      const p0 = window.__osuToClient(50, 50), p1 = window.__osuToClient(400, 340);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: p0.x, clientY: p0.y, button: 0, altKey: true, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
      await sleep(150);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
      await sleep(50);
      const ids = {};
      for (const [objId, s] of store.selectedNodes) ids[objId] = [...s].sort();
      return { ids, count: store.nodeSelectionCount, objSel: [...store.selected].sort() };
    })`;

    // A: 无选区 — 维持 v371b 第一框到收窄 (440001 距起点近)
    const rA = await evalJs(`(${marquee})([])`);
    assert(Object.keys(rA.ids).length === 1 && rA.ids['440001']?.length === 2,
      `A: 无已选滑条 → 第一框到滑条 (440001) 收窄不变 (实际 ${JSON.stringify(rA.ids)})`);

    // B: 只选 440002 (远处) — v440: 只框 440002 的锚点 (无 v440 时按第一框到会框到 440001)
    const rB = await evalJs(`(${marquee})([440002])`);
    assert(Object.keys(rB.ids).length === 1 && rB.ids['440002']?.length === 2,
      `B: 已选 440002 → 只框它的锚点 (实际 ${JSON.stringify(rB.ids)})`);
    assert(rB.objSel.length === 1 && rB.objSel[0] === 440002, 'B: 物件选区保留 (v441 前提)');

    // C: 复选两条滑条 — 两条的锚点都框进 (不再触发第一框到收窄)
    const rC = await evalJs(`(${marquee})([440001, 440002])`);
    assert(rC.ids['440001']?.length === 2 && rC.ids['440002']?.length === 2 && rC.count === 4,
      `C: 复选两滑条 → 两条锚点都框进 (实际 ${JSON.stringify(rC.ids)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    await killIsolated(electron, profile);
  }
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V440_FAILED: ${failures} 处失败` : '\nVERIFIER_V440_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
