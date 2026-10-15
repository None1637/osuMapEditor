// 验证器 v424: 批量删除选中滑条锚点 (soulten 反馈: 框选一串锚点不能一次性删)
//  - App 'delete' 分支: 节点选区非空 → store.deleteSelectedNodes() (物件+节点同选优先节点);
//    否则维持 deleteSelected() 删物件/绿线现状; 右键单点删除不变。
//  - store.deleteSelectedNodes: withRedPartners 同坐标整组删 (v401 语义) / 头尾数组平移 /
//    剩余 <2 删整物件 / resolveSliderCurveType (manualCurveType 例外) / resnapSliderLength /
//    invalidatePath / 一次 undo / 清节点选区保物件选区 / lockNotes 不动。
// 运行: npm run build 后 node verifier/v424/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v424/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v424/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V424_TESTS_*)
fs.unlinkSync(out);

section('源码: 纯函数/store/App 路由/帮助文案');
{
  const sp = read('src/osu/sliderPath.ts');
  assert(/v424: 批量删除选中锚点/.test(sp), 'v424 版本注释');
  assert(/export function deleteSliderPoints/.test(sp), 'deleteSliderPoints 导出');
  assert(/return next\.length >= 2 \? next : null/.test(sp), '剩余 <2 返回 null');
  assert(/pts\.filter/.test(sp), '不改入参 (filter 新数组)');

  const st = read('src/osu/store.ts');
  assert(/deleteSelectedNodes\(\)/.test(st), 'store.deleteSelectedNodes');
  assert(/withRedPartners\(bm, this\.selectedNodes\)/.test(st), '同坐标配对组整组展开 (v401 语义)');
  assert(/delIds\.add\(id\)/.test(st) && /!delIds\.has\(o\.id\)/.test(st), '剩余 <2 删整物件');
  assert(/!this\.manualCurveType\.has\(o\.id\)[\s\S]{0,80}?resolveSliderCurveType/.test(st), 'curveType 同口径 (manualCurveType 例外)');
  assert(/resnapSliderLength\(bm, o, this\.beatSnap\)/.test(st), 'resnapSliderLength (v406 尾吸附开关)');
  assert(/invalidatePath\(o\.id\)/.test(st), 'invalidatePath');
  assert(/this\.pushUndo\(\);[\s\S]{0,500}?deleteSliderPoints/.test(st), '一次 undo (pushUndo 在循环外)');
  assert(/this\.selectedNodes\.clear\(\); \/\/ 清空节点选区, 物件选区保留/.test(st), '清节点选区保物件选区');
  assert(/this\.lockNotes/.test(st.match(/deleteSelectedNodes\(\) \{[\s\S]*?\n  \}/)?.[0] ?? ''), 'lockNotes 时不动');

  const app = read('src/App.tsx');
  assert(/case 'delete':[\s\S]{0,260}?store\.selectedNodes\.size\) \{ store\.deleteSelectedNodes\(\); return; \}[\s\S]{0,80}?store\.deleteSelected\(\); return;/.test(app), 'Delete 路由: 节点优先, 否则删物件');

  const hk = read('src/osu/hotkeys.ts');
  assert(/id: 'delete'.*选中锚点/.test(hk), '快捷键帮助补锚点说明');

  // 右键单点删除路径不变 (v400)
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v400: 右键头部 = 删除头节点/.test(ec), '右键删头 (v400) 保留');
}

section('CDP: 选锚点按 Delete → 整组删 / 剩 <2 删整物件 / undo 还原');
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

    // A: 5 点滑条 (含 1,2 红配对), 只选 idx=1 → Delete 整组删 {1,2} → 剩 3 点, 头不变
    const rA = await evalJs(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const store = window.__osuStore;
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      const mk = { id: 975001, type: 'slider', x: 100, y: 100, time: t, newCombo: true, comboSkip: 0,
        hitSound: 0, curveType: 'B',
        curvePoints: [{ x: 200, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }, { x: 400, y: 100 }],
        slides: 1, length: 300 };
      store.load({ ...base, hitObjects: [mk] }, store.audioUrl, null);
      store.pause && store.pause();
      store.tool = 'select';
      store.select([975001]);
      store.setSelectedNodes([[975001, 1]]); // 只选对中一个 → v401 整组
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      await sleep(200);
      const o = store.beatmap.hitObjects.find(x => x.id === 975001);
      return { exists: !!o, x: o?.x, cp: o?.curvePoints?.length, nodeSel: store.nodeSelectionCount,
        objSel: store.selected.has(975001) };
    })()`);
    assert(rA.exists && rA.cp === 2, `A: 红配对整组删 (剩头+2 曲线点; 实际 ${rA.cp})`);
    assert(rA.x === 100, 'A: 头未动');
    assert(rA.nodeSel === 0, 'A: 节点选区清空');
    assert(rA.objSel, 'A: 物件选区保留');

    // B: undo 还原, 再全选节点 Delete → 剩 <2 → 整物件删除
    const rB = await evalJs(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const store = window.__osuStore;
      store.undo();
      await sleep(100);
      const o1 = store.beatmap.hitObjects.find(x => x.id === 975001);
      const restored = o1 && o1.curvePoints.length === 4;
      store.setSelectedNodes([[975001, 0], [975001, 1], [975001, 2], [975001, 3], [975001, 4]]);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      await sleep(200);
      return { restored, gone: !store.beatmap.hitObjects.some(x => x.id === 975001) };
    })()`);
    assert(rB.restored, 'B: undo 还原 4 曲线点');
    assert(rB.gone, 'B: 剩余 <2 → 整滑条删除');

    // C: 无节点选区时 Delete 维持删物件现状
    const rC = await evalJs(`(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const store = window.__osuStore;
      store.undo();
      await sleep(100);
      const o = store.beatmap.hitObjects.find(x => x.id === 975001);
      store.select([975001]);
      store.setSelectedNodes([]); // 空节点选区
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      await sleep(200);
      return { back: !!o, gone: !store.beatmap.hitObjects.some(x => x.id === 975001) };
    })()`);
    assert(rC.back && rC.gone, 'C: 节点选区为空 → 维持删物件现状');

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 300));
  } finally {
    await killIsolated(electron, profile);
  }
}

console.log(failures ? `\nVERIFIER_V424_FAILED: ${failures} 处失败` : '\nVERIFIER_V424_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
