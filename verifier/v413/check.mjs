// 验证器 v413: Ctrl+点击互动物件不生成滑条锚点 (落空才插点, 物件上 = 多选切换)
// 背景: v326 让 Ctrl+左键点击任何位置都给选中滑条插锚点 — 导致按住 Ctrl 无法点选多个滑条
//   (Ctrl+点到物件身上反而在选中滑条上生成了锚点)。soulten: 别在物件上生成滑条点,
//   没有选到互动物件可以生; 锚点手柄上的 Ctrl 拖拽/切红 (v118) 保留。
// 修复: singleSliderNodePress 的 Ctrl 插点分支前置 hitTest — 命中互动物件 return false
//   放行给 objectPress (Ctrl+点击 = toggleSelect 多选); 空白处维持 v326 插点。
// v439 适配: 「命中对象是本滑条自己」不再放行 — v413 把选中滑条自己的本体也算作互动物件,
//   导致选中滑条后 Ctrl+点滑条身加不了点 (soulten 回归反馈)。现命中本滑条 (hit.id === so.id)
//   继续插点 (v326 stable 语义), 命中其他物件才 return false 走多选; 新增 CDP 用例 B2。
// 运行: npm run build 后 node verifier/v413/check.mjs
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

section('源码: Ctrl 插点前置物件命中守卫 (v439: 本滑条身除外)');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v439: 命中对象是本滑条自己/.test(ec), 'v439 版本注释');
  const fn = ec.match(/const singleSliderNodePress = \(p: Pt[\s\S]*?\n  \};/)?.[0] ?? '';
  // v495→v497 适配: hitTestAll 穿透重叠为误改已还原, 恢复 hitTest 顶层命中守卫;
  //   v496 在 ctrl 分支前置了 allowBlankInsert 守卫 (时间轴穿透不空白插点), 放宽开头匹配
  assert(/if \(mods\.ctrlKey \|\| mods\.metaKey\) \{[\s\S]*?const hitObj = hitTest\(p\.x, p\.y\);\s*if \(hitObj && hitObj\.id !== so\.id\) return false;/.test(fn), 'Ctrl+命中其他物件 → 放行多选; 命中本滑条身 → 继续插点 (v439/v497)');
  assert(/newPts = \[\.\.\.ctrl\.slice\(0, best \+ 1\), raw, \.\.\.ctrl\.slice\(best \+ 1\)\]/.test(fn), '空白插点逻辑保留 (v326)');
}

section('CDP: Ctrl+点物件 = 多选 / Ctrl+点空白 = 插点 / Ctrl+点锚点 = 切红保留');
{
  const PORT = 9494;
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

    // 滑条 A (选中) + 圆圈 B (未选, 附近) + 一段空白区
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      store.load({ ...base, hitObjects: [
        { id: 965001, type: 'slider', x: 100, y: 100, time: t, newCombo: true, comboSkip: 0, hitSound: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
        { id: 965002, type: 'circle', x: 200, y: 250, time: t + 10, newCombo: false, comboSkip: 0, hitSound: 0 },
      ] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t + 5);
      store.select([965001]);
      store.setSelectedNodes([]);
    })()`);

    // A: Ctrl+点击圆圈 B — 多选 (A,B 都选中), 滑条 A 不插点
    const rA = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(200, 250);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
      const a = store.beatmap.hitObjects.find(x => x.id === 965001);
      return { selA: store.selected.has(965001), selB: store.selected.has(965002), pts: a.curvePoints.length };
    })()`);
    assert(rA.selA && rA.selB, 'A: Ctrl+点物件 = 多选 (两个都选中)');
    assert(rA.pts === 1, `A: 物件上不生成锚点 (curvePoints 仍 ${rA.pts})`);

    // B2 (v439 新增): Ctrl+点击选中滑条自己的本体 — 继续插点 (v413 误把本滑条身也放行, 加不了点)
    const rB2 = await evalJs(`(() => {
      const store = window.__osuStore;
      store.select([965001]); // 回到只选滑条
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(200, 100); // 滑条身中点 (直线路径正中, 距两端锚点 100px)
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
      const a = store.beatmap.hitObjects.find(x => x.id === 965001);
      return { pts: a.curvePoints.length, selOnlyA: store.selected.size === 1 && store.selected.has(965001) };
    })()`);
    assert(rB2.pts === 2, `B2: Ctrl+点本滑条身 = 插锚点 (v439; curvePoints → ${rB2.pts})`);
    assert(rB2.selOnlyA, 'B2: 选区未被改动');
    // 复位: 还原滑条到初始 1 控制点 (后续 B/C 用例基于初始状态断言)
    await evalJs(`(() => {
      const store = window.__osuStore;
      const a = store.beatmap.hitObjects.find(x => x.id === 965001);
      a.curvePoints = [{ x: 300, y: 100 }]; a.curveType = 'L';
      store.select([965001]);
      store.emit();
    })()`);

    // B: Ctrl+点击空白 (400,300 附近无物件) — 给选中的滑条插点 (v326 保留)
    const rB = await evalJs(`(() => {
      const store = window.__osuStore;
      store.select([965001]); // 回到只选滑条
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(420, 320);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
      const a = store.beatmap.hitObjects.find(x => x.id === 965001);
      return { pts: a.curvePoints.length };
    })()`);
    assert(rB.pts === 2, `B: Ctrl+点空白 = 插锚点 (curvePoints → ${rB.pts})`);

    // C: Ctrl+点击锚点手柄 (尾点) — 仍切红 (v118 保留), 不多选也不插点
    const rC = await evalJs(`(() => {
      const store = window.__osuStore;
      const a = store.beatmap.hitObjects.find(x => x.id === 965001);
      const tail = a.curvePoints[a.curvePoints.length - 1];
      const n0 = a.curvePoints.length;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(tail.x, tail.y);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
      const a2 = store.beatmap.hitObjects.find(x => x.id === 965001);
      return { n0, n1: a2.curvePoints.length, selOnlyA: store.selected.size === 1 && store.selected.has(965001) };
    })()`);
    assert(rC.n1 === rC.n0 + 1, `C: Ctrl+点锚点 = 切红 (${rC.n0} → ${rC.n1})`);
    assert(rC.selOnlyA, 'C: 选区未被改动');

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

console.log(failures ? `\nVERIFIER_V413_FAILED: ${failures} 处失败` : '\nVERIFIER_V413_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
