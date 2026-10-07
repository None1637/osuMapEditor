// 验证器 v360: 多滑条点快捷键旋转/缩放 (TransformDialog 节点模式) + 时间轴覆盖区锚点穿透
// 需求 (soulten):
//   1) 讓多個滑條點也能快捷鍵縮放旋轉 — Ctrl+Shift+R/S 旋转/缩放窗口在有选中锚点时作用于锚点
//      (原点 = 锚点包围盒中心 F08 语义; store 新增节点预览会话 begin/preview/commit/endNodeTransformPreview,
//      与物件版 v301 同构; 实时预览 + 一次应用一次 undo + 关窗回滚);
//   2) 重疊到時間軸的滑條點不能點擊取消/拖動 — 画布全幅垫底、时间轴半透明覆盖 (v129 预留带上 111px),
//      TopTimeline mousedown 先询问 EditorCanvas 注册的 store.playfieldNodePress (Alt = 切换选中/框选,
//      无修饰 = 整组拖拽; 命中即 return 不再 seek/选物件)。onMouseDown 的 Alt/整组拖分支抽为
//      nodeAltPress/nodeGroupDragPress 共用。
// 运行: npm run build 后 node verifier/v360/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: store 节点预览会话 + 穿透桥');
{
  const src = read('src/osu/store.ts');
  assert(/beginNodeTransformPreview\(\)/.test(src) && /snapshotNodes\(bm, withRedPartners/.test(src), 'beginNodeTransformPreview (快照含红锚点对)');
  assert(/lens: new Map/.test(src), '备份含滑条长度 (预览 resnap 回滚用)');
  assert(/previewNodeTransform\(fn/.test(src) && /restoreNodeTransformBackup/.test(src), 'previewNodeTransform (回滚后变换)');
  assert(/commitNodeTransform\(fn/.test(src) && /this\.pushUndo\(\); \/\/ 快照 = 预览前/.test(src), 'commitNodeTransform (undo 快照 = 预览前)');
  assert(/endNodeTransformPreview\(\)/.test(src), 'endNodeTransformPreview');
  assert(/nodeBackupCenter/.test(src), '原点 = 锚点包围盒中心 (F08)');
  assert(/playfieldNodePress: \(\(clientX/.test(src), 'playfieldNodePress 桥字段');
}

section('源码: TransformDialog 节点模式');
{
  const src = read('src/components/TransformDialog.tsx');
  assert(/const nodeMode = mode !== 'symmetry' && store\.nodeSelectionCount > 0/.test(src), 'nodeMode 判定');
  assert(/if \(nodeMode\) store\.beginNodeTransformPreview\(\); else store\.beginTransformPreview\(\)/.test(src), '按模式开预览会话');
  assert(/store\.previewNodeTransform\(\(p, c\) => rotatePt/.test(src) && /store\.previewNodeTransform\(\(p, c\) => scalePt/.test(src), '节点实时预览 (旋转+缩放)');
  assert(/commitNode\(\(p, c\) => rotatePt\(p, c, angle\)\)/.test(src) && /commitNode\(\(p, c\) => scalePt\(p, c, factor, factorY\)\)/.test(src), '节点提交 (旋转+缩放)');
  assert(/mode !== 'symmetry' && !nodeMode/.test(src) && /transform\.node_mode_hint/.test(src), '节点模式隐藏原点行 + 提示');
}

section('源码: 穿透 (EditorCanvas 注册 + TopTimeline 询问)');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/const nodeAltPress = \(p: Pt/.test(ec) && /const nodeGroupDragPress = \(p: Pt\): boolean/.test(ec), 'Alt/整组拖抽函数');
  assert(/store\.playfieldNodePress = \(cx, cy, mods\)/.test(ec), '注册 playfieldNodePress');
  assert(/if \(store\.tool !== 'select' \|\| store\.canvasDragging/.test(ec), '穿透仅 select 工具 + 非拖拽中');
  const tl = read('src/components/Timelines.tsx');
  assert(/store\.playfieldNodePress\?\.\(e\.clientX, e\.clientY, e\)\) return/.test(tl), 'TopTimeline mousedown 先询问穿透');
}

section('源码: i18n');
{
  const zh = read('src/i18n/dicts/zh-CN/transform.ts');
  assert(/'transform\.node_mode_hint': '作用于选中的滑条锚点 \(原点 = 锚点包围盒中心\)'/.test(zh), 'zh-CN: node_mode_hint');
}

section('CDP: 时间轴覆盖区锚点拖拽/取消 + 节点缩放窗口');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9467;
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
      ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap && window.__osuToClient)').catch(() => false);
    }
    if (!ready) throw new Error('应用未就绪');

    // 造一条锚点落在上方时间轴覆盖带的滑条: 反解 client 坐标 -> osu 坐标
    const setup = await evalJs(`(() => {
      const store = window.__osuStore;
      const tl = document.querySelector('canvas[class*="h-[92px]"]');
      const tr = tl.getBoundingClientRect();
      const p0 = window.__osuToClient(0, 0), px = window.__osuToClient(1, 0), py = window.__osuToClient(0, 1);
      const szx = px.x - p0.x, szy = py.y - p0.y;
      const osuX = (tr.left + tr.width / 2 - p0.x) / szx;
      const osuY = (tr.top + tr.height / 2 - p0.y) / szy; // 锚点在时间轴条正中
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      const slider = { id: 960001, type: 'slider', x: Math.round(osuX), y: Math.round(osuY + 200), time: t,
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [{ x: Math.round(osuX), y: Math.round(osuY) }], slides: 1, length: 220 };
      store.load({ ...base, hitObjects: [slider] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t);
      store.toggleSelectedNode(960001, 1); // 选中覆盖带里的锚点
      const pt = window.__osuToClient(slider.curvePoints[0].x, slider.curvePoints[0].y);
      return { osuX: slider.curvePoints[0].x, osuY: slider.curvePoints[0].y, clientX: pt.x, clientY: pt.y,
        inTimeline: pt.y >= tr.top && pt.y <= tr.bottom, szx };
    })()`);
    assert(setup.inTimeline, `锚点位于时间轴覆盖带 (client y=${setup.clientY.toFixed(0)})`);

    // A: 时间轴上按下锚点 -> 穿透整组拖 (mousemove/mouseup 走 window 监听)
    const drag = await evalJs(`(() => {
      const store = window.__osuStore;
      const tl = document.querySelector('canvas[class*="h-[92px]"]');
      tl.dispatchEvent(new MouseEvent('mousedown', { clientX: ${setup.clientX}, clientY: ${setup.clientY}, button: 0, bubbles: true, cancelable: true }));
      const started = store.canvasDragging;
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: ${setup.clientX} + 60, clientY: ${setup.clientY}, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: ${setup.clientX} + 60, clientY: ${setup.clientY}, bubbles: true }));
      const o = store.beatmap.hitObjects.find(x => x.id === 960001);
      return { started, newX: o.curvePoints[0].x };
    })()`);
    assert(drag.started, '时间轴上按下锚点 = 穿透开始拖拽 (canvasDragging)');
    assert(Math.abs(drag.newX - (setup.osuX + 60 / setup.szx)) <= 8, `拖拽经过时间轴仍移动锚点 (x ${setup.osuX} → ${drag.newX}, 期望 ≈ +${(60 / setup.szx).toFixed(0)})`);

    // B: Alt+点击覆盖带锚点 = 取消选中; 且时间轴不 seek (穿透 return)
    const alt = await evalJs(`(() => {
      const store = window.__osuStore;
      const o = store.beatmap.hitObjects.find(x => x.id === 960001);
      if (!store.selectedNodes.get(960001)?.has(1)) store.toggleSelectedNode(960001, 1);
      const pt = window.__osuToClient(o.curvePoints[0].x, o.curvePoints[0].y);
      const t0 = store.currentTime;
      const tl = document.querySelector('canvas[class*="h-[92px]"]');
      tl.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, altKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, bubbles: true }));
      return { stillSelected: !!(store.selectedNodes.get(960001)?.has(1)), seeked: store.currentTime !== t0 };
    })()`);
    assert(!alt.stillSelected, 'Alt+点击覆盖带锚点 = 取消选中');
    assert(!alt.seeked, '穿透命中后时间轴不再 seek');

    // C: 节点版预览/提交/回滚 (缩放窗口语义)
    const tf = await evalJs(`(() => {
      const store = window.__osuStore;
      const bm = store.beatmap;
      const o = bm.hitObjects.find(x => x.id === 960001);
      store.toggleSelectedNode(960001, 1); // 重选锚点
      const orig = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      const cx = (o.x + orig.x) / 2, cy = (o.y + orig.y) / 2; // 快照只含选中节点 idx1... 中心=单点自身
      store.beginNodeTransformPreview();
      store.previewNodeTransform((p, c) => ({ x: c.x + (p.x - c.x) * 2, y: c.y + (p.y - c.y) * 2 }));
      const previewed = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      store.endNodeTransformPreview(); // 关窗回滚
      const restored = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      store.beginNodeTransformPreview();
      store.commitNodeTransform((p, c) => ({ x: c.x + (p.x - c.x) * 2, y: c.y + (p.y - c.y) * 2 }));
      store.endNodeTransformPreview();
      const committed = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      store.undo(); // 一次 undo 撤回提交
      const undone = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      return { orig, previewed, restored, committed, undone };
    })()`);
    // 单点快照: 中心=点自身, 缩放不动点 (验证会话机制: 预览≠原值与否都行, 关键在还原链) — 改用位移函数验证
    assert(tf.restored.x === tf.orig.x && tf.restored.y === tf.orig.y, `endNodeTransformPreview 回滚 (${JSON.stringify(tf.restored)} = ${JSON.stringify(tf.orig)})`);
    assert(tf.undone.x === tf.orig.x && tf.undone.y === tf.orig.y, `提交后一次 undo 还原 (${JSON.stringify(tf.undone)})`);

    const tf2 = await evalJs(`(() => {
      const store = window.__osuStore;
      const bm = store.beatmap;
      const o = bm.hitObjects.find(x => x.id === 960001);
      if (!store.selectedNodes.get(960001)?.has(1)) store.toggleSelectedNode(960001, 1);
      store.beginNodeTransformPreview();
      store.previewNodeTransform((p, c) => ({ x: p.x + 40, y: p.y - 30 }));
      const moved = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      store.previewNodeTransform((p, c) => ({ x: p.x + 10, y: p.y + 10 })); // 改参数 = 相对基准不叠加
      const rebased = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      store.endNodeTransformPreview();
      const restored = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      store.beginNodeTransformPreview();
      store.commitNodeTransform((p, c) => ({ x: p.x + 25, y: p.y }));
      store.endNodeTransformPreview();
      const committed = { x: o.curvePoints[0].x, y: o.curvePoints[0].y };
      store.undo();
      const o2 = store.beatmap.hitObjects.find(x => x.id === 960001); // undo 换快照, 旧引用失效
      return { moved, rebased, restored, committed, undone: { x: o2.curvePoints[0].x, y: o2.curvePoints[0].y }, origX: committed.x - 25, origY: committed.y };
    })()`);
    assert(tf2.moved.x === tf2.origX + 40 && tf2.moved.y === tf2.origY - 30, `预览按参数变换 (+40,-30 实得 ${JSON.stringify(tf2.moved)})`);
    assert(tf2.rebased.x === tf2.origX + 10 && tf2.rebased.y === tf2.origY + 10, `改参数相对基准不叠加 (+10,+10 实得 ${JSON.stringify(tf2.rebased)})`);
    assert(tf2.restored.x === tf2.origX && tf2.restored.y === tf2.origY, '预览关窗回滚');
    assert(tf2.committed.x === tf2.origX + 25 && tf2.committed.y === tf2.origY, `提交生效 (+25 实得 ${JSON.stringify(tf2.committed)})`);
    assert(tf2.undone.x === tf2.origX && tf2.undone.y === tf2.origY, `提交一次 undo 还原 (undone=${JSON.stringify(tf2.undone)}, orig=${tf2.origX},${tf2.origY})`);

    // D: 对话框节点模式 UI (隐藏原点行)
    const dlg = await evalJs(`(async () => {
      const store = window.__osuStore;
      if (!store.selectedNodes.get(960001)?.has(1)) store.toggleSelectedNode(960001, 1);
      store.openTransformDialog('scale');
      await new Promise(r => setTimeout(r, 300));
      const el = document.querySelector('[data-dialog="scale-dlg"]');
      const hasOrigin = !!document.querySelector('[data-tf="origin-selection"]');
      store.closeTransformDialog();
      return { open: !!el, hasOrigin };
    })()`);
    assert(dlg.open, '节点选中时缩放窗口可打开');
    assert(dlg.open && !dlg.hasOrigin, '节点模式隐藏原点选择 (恒锚点包围盒中心)');
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

console.log(failures ? `\nVERIFIER_V360_FAILED: ${failures} 处失败` : '\nVERIFIER_V360_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
