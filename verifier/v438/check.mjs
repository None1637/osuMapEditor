// 验证器 v438: 未选中滑条的全部锚点 (含头节点) 直接互动 — 拖曳 + 右键删点
// 需求 (soulten): 「想在沒有選取滑條的時候直接跟滑條點互動 (拖曳 刪除)」
// 改动:
//   1) unselectedSliderNodePress 废除头节点排除 (v378 的 hitNode.idx === 0 守卫移除) —
//      未选滑条按头 = 选中该滑条 + 拖头节点 (v369「按头 = 物件拖拽」语义由本版取代; 拖整条请抓滑条身);
//   2) playfieldAnchorHit 未选分支同样不再排除头 (穿透链锚点>可交互UI>物件 优先级保持);
//   3) sliderAnchorContextPress 删除实现抽至 deleteSliderAnchor, 新增未选滑条锚点右键路径
//      (跨滑条最近优先, 排除已选; v400 同款语义: 头可删/下一点变新头/仅剩 2 点吞掉; 不改选区)。
// 运行: npm run build 后 node verifier/v438/check.mjs
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

section('源码: 未选滑条全锚点可拖 (头节点排除废除)');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v438: 头节点 \(idx 0\) 也直接可拖/.test(ec), 'v438 版本注释');
  assert(!/hitNode\.idx === 0/.test(ec), 'unselectedSliderNodePress 不再排除头节点');
  const fn = ec.match(/const unselectedSliderNodePress = \(p: Pt[\s\S]*?\n  \};/)?.[0] ?? '';
  assert(/store\.select\(\[hitNode\.objId\]\)/.test(fn) && /return singleSliderNodePress\(p, mods\)/.test(fn), '命中锚点自动选中并进入节点编辑 (不变)');
  const ah = ec.match(/store\.playfieldAnchorHit = \(cx, cy, mods\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
  assert(/return !mods\.shiftKey && !store\.selected\.has\(hitNode\.objId\);/.test(ah), '穿透命中探测含头节点 (v404 优先级链保持)');
}

section('源码: 右键未选滑条锚点直接删点');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v438: 未选中滑条的锚点同样直接右键删点/.test(ec), 'v438 右键版本注释');
  const fn = ec.match(/const sliderAnchorContextPress = \(p: Pt\): boolean => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert(/const deleteSliderAnchor = \(so: HitObject, i: number\)/.test(fn), '删除实现抽共用函数');
  assert(/deleteSliderPoint\(ctrl, 0\)/.test(fn), '头节点可删 (v400 语义保留)');
  assert(/!store\.selected\.has\(o\.id\)/.test(fn) && /nearestNode\(sliders, offs, p, devicePxPerOsu\(\)\)/.test(fn), '未选滑条锚点候选 (排除已选, 跨滑条最近; v452 适配: 调用带 k 实参)');
  assert(/deleteSliderAnchor\(ho, hitNode\.idx\);\s*return true;/.test(fn), '命中未选锚点直接删点并吞事件');
}

section('CDP: 未选滑条头拖拽 / 右键删点 (尾/头/仅2点吞掉/落空删物件)');
{
  const PORT = 9496;
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

    // 438001: 两点直线 (100,100)→(300,100); 438002: 四点折线 (100,260)→(220,260)→(340,260)→(460,260)
    await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      store.load({ ...base, hitObjects: [
        { id: 438001, type: 'slider', x: 100, y: 100, time: t, newCombo: true, comboSkip: 0, hitSound: 0,
          curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 200 },
        { id: 438002, type: 'slider', x: 100, y: 260, time: t, newCombo: false, comboSkip: 0, hitSound: 0,
          curveType: 'L', curvePoints: [{ x: 220, y: 260 }, { x: 340, y: 260 }, { x: 460, y: 260 }], slides: 1, length: 360 },
      ] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t + 5);
      store.clearSelection(); store.setSelectedNodes([]);
    })()`);

    // A: 无修饰拖拽未选滑条的头节点 (100,100) — 自动选中 + 头随拖动位移, 尾点不动
    const rA = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const c = document.querySelector('canvas.cursor-crosshair');
      const o = store.beatmap.hitObjects.find(x => x.id === 438001);
      const tail0 = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      const pt = window.__osuToClient(o.x, o.y);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + 60, clientY: pt.y, bubbles: true }));
      await sleep(200);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 60, clientY: pt.y, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + 60, clientY: pt.y, bubbles: true }));
      await sleep(80);
      const o2 = store.beatmap.hitObjects.find(x => x.id === 438001);
      return { sel: [...store.selected], dx: o2.x - 100, // 头初始 x=100; 位移 = 60 视觉px / 缩放 (≈30+ osu px)
        tailSame: o2.curvePoints[0].x === tail0.x && o2.curvePoints[0].y === tail0.y,
        nodeSel: [...(store.selectedNodes.get(438001) ?? [])] };
    })()`);
    assert(rA.sel.length === 1 && rA.sel[0] === 438001, `A: 按头自动选中该滑条 (选中 ${JSON.stringify(rA.sel)})`);
    assert(rA.dx > 15, `A: 头节点随拖动位移 (dx=${rA.dx} osu px; 修复前按头 = 物件整拖/无节点拖动)`);
    assert(rA.tailSame, 'A: 尾点不动 (是头节点拖拽不是物件整体拖拽)');
    assert(rA.nodeSel.length === 1 && rA.nodeSel[0] === 0, `A: 节点选区 = 头节点 (实际 ${JSON.stringify(rA.nodeSel)})`);

    // B: 右键未选滑条 438002 的中锚点 (220,260) — 直接删点, 选区不动 (仍选 438001), 物件保留
    const rB = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas.cursor-crosshair');
      const n0 = store.beatmap.hitObjects.find(x => x.id === 438002).curvePoints.length;
      const pt = window.__osuToClient(220, 260);
      c.dispatchEvent(new MouseEvent('contextmenu', { clientX: pt.x, clientY: pt.y, button: 2, bubbles: true, cancelable: true }));
      const o = store.beatmap.hitObjects.find(x => x.id === 438002);
      return { n0, n1: o ? o.curvePoints.length : -1, exists: !!o, sel: [...store.selected] };
    })()`);
    assert(rB.n0 === 3 && rB.n1 === 2, `B: 右键未选中锚点 = 删点 (${rB.n0} → ${rB.n1})`);
    assert(rB.exists && rB.sel.length === 1 && rB.sel[0] === 438001, 'B: 物件保留, 选区不变 (不先选中)');

    // C: 右键未选滑条 438002 的头节点 (100,260) — 删头, 下一点 (340,260) 变新头 (v400 语义; B 后余 3 点不受吞点规则限制)
    const rC = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(100, 260);
      c.dispatchEvent(new MouseEvent('contextmenu', { clientX: pt.x, clientY: pt.y, button: 2, bubbles: true, cancelable: true }));
      const o = store.beatmap.hitObjects.find(x => x.id === 438002);
      return { exists: !!o, hx: o?.x, hy: o?.y, n: o?.curvePoints.length };
    })()`);
    assert(rC.exists && rC.hx === 340 && rC.hy === 260 && rC.n === 1,
      `C: 右键未选头节点 = 删头 (新头 ${rC.hx},${rC.hy} 余 ${rC.n} 点)`);

    // D: 右键两点滑条 438001 的头 — 仅剩 2 点不可删, 吞掉 (物件/点数不变)
    const rD = await evalJs(`(() => {
      const store = window.__osuStore;
      const o0 = store.beatmap.hitObjects.find(x => x.id === 438001);
      const n0 = o0.curvePoints.length;
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(o0.x, o0.y);
      c.dispatchEvent(new MouseEvent('contextmenu', { clientX: pt.x, clientY: pt.y, button: 2, bubbles: true, cancelable: true }));
      const o1 = store.beatmap.hitObjects.find(x => x.id === 438001);
      return { n0, n1: o1 ? o1.curvePoints.length : -1, exists: !!o1 };
    })()`);
    assert(rD.exists && rD.n1 === rD.n0, `D: 仅剩 2 点右键头 = 吞掉不删 (点数 ${rD.n0} → ${rD.n1}, 物件保留)`);

    // E: 右键 438001 滑条身中段 (远离锚点) — 落空, 走通用删除删整个物件 (v30 行为不变)
    const rE = await evalJs(`(() => {
      const store = window.__osuStore;
      const o0 = store.beatmap.hitObjects.find(x => x.id === 438001);
      const mid = { x: (o0.x + o0.curvePoints[0].x) / 2, y: o0.y }; // 身中段, 距两端 ≫10px
      const c = document.querySelector('canvas.cursor-crosshair');
      const pt = window.__osuToClient(mid.x, mid.y);
      c.dispatchEvent(new MouseEvent('contextmenu', { clientX: pt.x, clientY: pt.y, button: 2, bubbles: true, cancelable: true }));
      return { gone: !store.beatmap.hitObjects.some(x => x.id === 438001) };
    })()`);
    assert(rE.gone, 'E: 右键滑条身 (未命中锚点) = 通用删除整个物件 (v30 不变)');

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

console.log(failures ? `\nVERIFIER_V438_FAILED: ${failures} 处失败` : '\nVERIFIER_V438_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
