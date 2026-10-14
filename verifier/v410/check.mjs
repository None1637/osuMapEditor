// 验证器 v410: 不按 Alt 点选滑条锚点 (需求5)
//   选中滑条后: 无修饰单击锚点 = 选中该锚点 (单选替换, 物件选区保留); Shift+点击 = 整组加选/减选
//   (v401 altNodeToggleGroup 语义); Ctrl+点击保持现状 (单点拖 + 松手切红, 不动节点选区);
//   点选后拖拽仍可移动 (未过死区松手 = 纯点选); 直接命中未选锚点优先于节点黄框内整组拖 (v309 框内拖仅限未命中锚点)。
// 运行: npm run build 后 node verifier/v410/check.mjs  (CDP 段经 OSU_VERIFIER=1 不抢焦点)
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

section('源码: singleSliderNodePress 点选锚点');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v410: 不按 Alt 也能点选锚点/.test(ec), 'v410 版本注释');
  assert(/mods: \{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean \}/.test(ec), 'mods 含 shiftKey');
  const fn = ec.match(/const singleSliderNodePress = \(p: Pt[\s\S]*?\n  \};/)?.[0] ?? '';
  assert(/if \(!mods\.ctrlKey && !mods\.metaKey\) \{/.test(fn), '无修饰分支');
  assert(/if \(mods\.shiftKey\) \{[\s\S]{0,300}?altNodeToggleGroup\(ctrl, hitIdx/.test(fn), 'Shift+点击 = 整组加选/减选 (v401 语义)');
  assert(/store\.setSelectedNodes\(\[\[so\.id, hitIdx\]\]\)/.test(fn), '无修饰 = 单选替换为该锚点');
  assert(/nodesMoveDragRef\.current = \{[\s\S]{0,200}?anchor: \{ objId: so\.id, idx: hitIdx \}/.test(fn), '点选后拖拽走整组拖通道 (withRedPartners 带红对)');
  assert(/nodeDragRef\.current = \{ objId: so\.id, pointIndex: hitIdx, pairWith: redPairPartner\(ctrl, hitIdx\)[\s\S]{0,160}?toggleRed: mods\.ctrlKey \|\| mods\.metaKey/.test(fn), 'Ctrl 分支保持现状 (单点拖 + 松手切红)');
}

section('源码: nodeGroupDragPress 让位未选锚点');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v410: 直接命中未选锚点时不按黄框内整组拖/.test(ec), 'v410 让位注释');
  const grp = ec.match(/const nodeGroupDragPress = \(p: Pt\): boolean[\s\S]*?\n  \};/)?.[0] ?? '';
  assert(/if \(hitNode && !insideNode\) return false;/.test(grp), '命中未选锚点 → 放行点选');
  assert(/!insideNode && !insideBox/.test(grp), '黄框内 (未命中锚点) 整组拖保留 (v309)');
}

section('CDP: 无Alt点选/Shift多选/拖拽/Ctrl切红');
{
  const PORT = 9490;
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
    await evalJs(`window.__osuSkin && window.__osuSkin.resetSkinToDefault()`);
    await sleep(800);

    // 造一条 4 控制点 L 滑条 (游玩区中部), 选中物件, 清空节点选区
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const mk = { id: 963001, type: 'slider', x: 100, y: 100, time: Math.round(red.time + red.beatLength * 8),
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: 200, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 200 }], slides: 1, length: 320 };
      store.load({ ...base, hitObjects: [mk] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(mk.time);
      store.select([963001]);
      store.setSelectedNodes([]);
    })()`);

    // A: 无修饰单击锚点 (curvePoints[1] = idx 2) → 节点选区 = {963001: {2}}, 物件选区保留
    const rA = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(200, 200);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, bubbles: true }));
      const s = store.selectedNodes.get(963001);
      return { nodeSel: s ? [...s] : [], objSel: store.selected.has(963001), count: store.nodeSelectionCount };
    })()`);
    assert(rA.count === 1 && rA.nodeSel.length === 1 && rA.nodeSel[0] === 2, `A: 无Alt单击锚点 = 选中该锚点 (got ${JSON.stringify(rA.nodeSel)})`);
    assert(rA.objSel, 'A: 物件选区保留');

    // B: Shift+单击另一锚点 (curvePoints[0] = idx 1) → 加选, 节点选区 = {1,2}
    const rB = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(200, 100);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, shiftKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, shiftKey: true, bubbles: true }));
      const s = store.selectedNodes.get(963001);
      return { nodeSel: s ? [...s].sort() : [], count: store.nodeSelectionCount };
    })()`);
    assert(rB.count === 2 && rB.nodeSel.join(',') === '1,2', `B: Shift+单击 = 加选 (got ${JSON.stringify(rB.nodeSel)})`);

    // C: Shift+单击已选锚点 (idx 1) → 减选, 节点选区 = {2}
    const rC = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(200, 100);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, shiftKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, shiftKey: true, bubbles: true }));
      const s = store.selectedNodes.get(963001);
      return { nodeSel: s ? [...s] : [], count: store.nodeSelectionCount };
    })()`);
    assert(rC.count === 1 && rC.nodeSel[0] === 2, `C: Shift+单击已选 = 减选 (got ${JSON.stringify(rC.nodeSel)})`);

    // D: 无修饰拖拽已选锚点 (idx 2) → 节点随拖动位移 (整组拖通道), 选区不丢
    const rD = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(200, 200);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 40, clientY: pt.y + 40, bubbles: true }));
      await sleep(200); // rAF 帧循环应用 pending
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 40, clientY: pt.y + 40, bubbles: true }));
      await sleep(50);
      const o = store.beatmap.hitObjects.find(x => x.id === 963001);
      const s = store.selectedNodes.get(963001);
      return { cp: { ...o.curvePoints[1] }, nodeSel: s ? [...s] : [] };
    })()`);
    assert(rD.cp.x !== 200 || rD.cp.y !== 200, `D: 点选后拖拽仍位移 (curvePoints[1] = ${JSON.stringify(rD.cp)})`);
    assert(rD.nodeSel.length === 1 && rD.nodeSel[0] === 2, 'D: 拖拽后节点选区保留');

    // E: 无修饰单击另一未选锚点 (头点 idx 0) → 单选替换 (节点黄框内未选锚点不被整组拖抢走)
    const rE = await evalJs(`(() => {
      const store = window.__osuStore;
      const o = store.beatmap.hitObjects.find(x => x.id === 963001);
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(o.x, o.y);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, bubbles: true }));
      const s = store.selectedNodes.get(963001);
      return { nodeSel: s ? [...s] : [], count: store.nodeSelectionCount, objSel: store.selected.has(963001) };
    })()`);
    assert(rE.count === 1 && rE.nodeSel[0] === 0 && rE.objSel, `E: 单击未选锚点 = 单选替换 (got ${JSON.stringify(rE.nodeSel)})`);

    // F: Ctrl+单击白锚点 (idx 1) → 切红 (曲线点多一个), 节点选区不变 (Ctrl 不动选区)
    const rF = await evalJs(`(() => {
      const store = window.__osuStore;
      const o = store.beatmap.hitObjects.find(x => x.id === 963001);
      const n0 = o.curvePoints.length;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(o.curvePoints[0].x, o.curvePoints[0].y);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, ctrlKey: true, bubbles: true }));
      const s = store.selectedNodes.get(963001);
      return { n0, n1: o.curvePoints.length, nodeSel: s ? [...s] : [] };
    })()`);
    assert(rF.n1 === rF.n0 + 1, `F: Ctrl+单击 = 切红 (${rF.n0} → ${rF.n1})`);
    assert(rF.nodeSel.length === 1 && rF.nodeSel[0] === 0, 'F: Ctrl 不动节点选区');

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

console.log(failures ? `\nVERIFIER_V410_FAILED: ${failures} 处失败` : '\nVERIFIER_V410_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
