// 验证器 v441: Alt 选取 (点选/框选锚点) 不再清空普通物件选区
// 需求 (soulten): 「使用alt選取會導致普通選取的物件選取狀態被清空(讓alt選取操作不會清空普通選取的狀態)」
// 改动: 删除两处 v265 遗留的「进 Alt 层即清物件选区」—
//   1) nodeAltPress (Alt+点锚点/Alt+点滑条本体/Alt+空白起框选 入口);
//   2) syncMarqueeMode 物件框选→节点框选迁移 (框选中途按下 Alt)。
//   节点/物件选区并存后的安全性: Delete 与旋转/缩放/镜像快捷键本就节点选区优先 (App.tsx 路由,
//   deleteSelectedNodes 保留物件选区); 「Alt+空白点击不改节点选区」的既有行为不变 (mousedown 不重算,
//   框选经 mousemove 实时重算)。v440 的「只框已选滑条锚点」依赖本版才能生效。
// 运行: npm run build 后 node verifier/v441/check.mjs
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

section('源码: Alt 路径不再清物件选区');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v441: Alt 点选\/框选不再清空物件选区/.test(ec), 'v441 版本注释 (nodeAltPress)');
  assert(/v441: 迁移到 Alt 节点框选不再清物件选区/.test(ec), 'v441 版本注释 (syncMarqueeMode)');
  const alt = ec.match(/const nodeAltPress = \(p: Pt[\s\S]*?\n  \};/)?.[0] ?? '';
  assert(alt.length > 0 && !/store\.selected\.clear\(\)/.test(alt), 'nodeAltPress 无 selected.clear');
  const sync = ec.match(/const syncMarqueeMode = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert(sync.length > 0 && !/store\.selected\.clear\(\)/.test(sync), 'syncMarqueeMode 无 selected.clear');
  assert(/store\.setSelectedNodes\(\[\]\); \/\/ 蓝框 = 物件框选: 清节点选区/.test(sync), '节点→物件迁移仍清节点选区 (既有语义不变)');
}

section('CDP: Alt 点选/框选/迁移 物件选区全保留');
{
  const PORT = 9499;
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

    // 441001 滑条 (100,100)-(300,100); 441002 圆圈 (200,300)
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      store.load({ ...base, hitObjects: [
        { id: 441001, type: 'slider', x: 100, y: 100, time: t, newCombo: true, comboSkip: 0, hitSound: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
        { id: 441002, type: 'circle', x: 200, y: 300, time: t + 10, newCombo: false, comboSkip: 0, hitSound: 0 },
      ] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t + 5);
      store.select([441001, 441002]);
      store.setSelectedNodes([]);
    })()`);

    // A: Alt+点击尾锚点 (300,100) — 节点选中切换生效, 物件选区保留 (修复核心)
    const rA = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(300, 100);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, altKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, altKey: true, bubbles: true }));
      return { nodeSel: [...(store.selectedNodes.get(441001) ?? [])], objSel: [...store.selected].sort() };
    })()`);
    assert(rA.nodeSel.length === 1 && rA.nodeSel[0] === 1, `A: Alt+点锚点仍切换节点选中 (实际 ${JSON.stringify(rA.nodeSel)})`);
    assert(rA.objSel.length === 2 && rA.objSel.includes(441001) && rA.objSel.includes(441002),
      `A: 物件选区保留 (实际 ${JSON.stringify(rA.objSel)}; v441 前被清空)`);

    // B: Alt+空白单击 (不起框) — 物件选区与节点选区都不动
    const rB = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(460, 40);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, altKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, altKey: true, bubbles: true }));
      return { nodeCount: store.nodeSelectionCount, objSel: [...store.selected].sort() };
    })()`);
    assert(rB.objSel.length === 2, `B: Alt+空白单击物件选区保留 (实际 ${JSON.stringify(rB.objSel)})`);
    assert(rB.nodeCount === 1, `B: 节点选区不被空白单击改动 (仍 ${rB.nodeCount}; 既有语义)`);

    // C: Alt+拖框选 — 物件选区保留, 节点选区按框重算 (v440: 选区含滑条 441001 → 只框它)
    const rC = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const p0 = window.__osuToClient(50, 50), p1 = window.__osuToClient(400, 340);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: p0.x, clientY: p0.y, button: 0, altKey: true, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
      await sleep(150);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
      await sleep(50);
      return { nodeCount: store.nodeSelectionCount, objSel: [...store.selected].sort() };
    })()`);
    assert(rC.objSel.length === 2, `C: Alt+框选物件选区保留 (实际 ${JSON.stringify(rC.objSel)})`);
    assert(rC.nodeCount === 2, `C: 框到 441001 的两个锚点 (实际节点数 ${rC.nodeCount})`);

    // D: 物件框选中途按 Alt 迁移节点框选 (syncMarqueeMode) — 物件选区保留
    const rD = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.setSelectedNodes([]);
      const c = document.querySelector('canvas.cursor-crosshair');
      const p0 = window.__osuToClient(460, 340), p1 = window.__osuToClient(480, 350); // 空白处小框 (不框到物件)
      // Shift+空白起手 = 物件框选且保留现有选区 (base)
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: p0.x, clientY: p0.y, button: 0, shiftKey: true, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: p1.x, clientY: p1.y, shiftKey: true, bubbles: true }));
      await sleep(80);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true })); // 中途按 Alt → 迁移
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
      await sleep(80);
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: p1.x, clientY: p1.y, altKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
      await sleep(50);
      return { objSel: [...store.selected].sort() };
    })()`);
    assert(rD.objSel.length === 2 && rD.objSel.includes(441001) && rD.objSel.includes(441002),
      `D: 框选中途按 Alt 物件选区保留 (实际 ${JSON.stringify(rD.objSel)}; v441 前迁移即清空)`);

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

console.log(failures ? `\nVERIFIER_V441_FAILED: ${failures} 处失败` : '\nVERIFIER_V441_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
