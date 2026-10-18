// 验证器 v379: 旋转/缩放窗口四项修复 (全部来自用户反馈)
//  1) 无选区也可经快捷键打开旋转/缩放窗口 (先开窗后选物件) — openTransformDialog 去掉
//     旋转/缩放的选区守卫 (对称窗口仍需选区); 未选中时预览/应用 = no-op (commitTransformPreview
//     空选区直接 return, 不产生空 undo 快照); 窗口开着时选中物件经 selKey effect 重立会话即生效。
//     原生编辑菜单「旋转.../缩放...」启用条件 hasSelection → hasMap (electron/main.cjs)。
//  2) 预览→拖曳→关窗后撤销能一步步回到最初谱面 — 根因: beginDrag 走 pushUndo 先回滚预览
//     再快照 (物件瞬回预览前 = 需求3「拖曳回原点」), 且 tfBackup 基准不随拖曳更新, 关窗
//     endTransformPreview 把拖拽位移一并抹掉、undo 链错位。修复: beginDrag 遇预览会话时
//     快照直接取当前(预览)态; commitDrag 确认拖拽发生后把预览固化为独立 undo 步
//     (快照=预览前基准, 插在拖拽快照之下), 撤销链 当前 →(undo 拖拽)→ 预览态 →(undo 预览)→ 最初。
//  3) 窗口开着时 Ctrl+Z/Ctrl+Y 可用 + 拖曳不弹回原点 — App.tsx 预览会话快捷键屏蔽名单
//     放行 undo/redo; store.undo/redo 预览会话感知 (先回滚未提交预览再撤销/重做, 事后以
//     新状态重立基准, 窗口保持打开)。拖曳不弹回原点见 2) 的 beginDrag 改动。
//  4) 预览不因拖曳中断 — commitDrag 固化后以拖拽后几何重立预览基准 (beginTransformPreview/
//     beginNodeTransformPreview), 拖完继续调值预览相对新基准; 关窗回滚到拖拽后状态 (不再抹掉拖拽)。
//     节点模式 (tfNodeBackup) 同构处理。
// 运行: npm run build 后 node verifier/v379/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs'; // v383: 环境归一共享 helper

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 需求1 无选区开窗 + 空选区 no-op');
{
  const st = read('src/osu/store.ts');
  assert(/v379[:\s][^]*?无选区也可开窗/.test(st) && /if \(m === 'symmetry' && !this\.selected\.size\) return;/.test(st),
    'openTransformDialog: 旋转/缩放去选区守卫 (对称仍守卫)');
  assert(!/if \(!this\.selected\.size && !\(m !== 'symmetry'/.test(st), 'openTransformDialog: 旧守卫已移除');
  const commit = st.match(/commitTransformPreview\(fn[\s\S]{0,900}?\n  \}/)?.[0] ?? '';
  assert(/v379/.test(commit) && /!this\.selectedObjects\(\)\.length/.test(commit), 'commitTransformPreview: 空选区 no-op (不产生空 undo 快照)');
  const menu = read('electron/main.cjs');
  assert(/edit-open-rotate[\s\S]{0,80}map\)/.test(menu) && /edit-open-scale[\s\S]{0,80}map\)/.test(menu), '原生菜单旋转/缩放项 hasMap 即启用');
}

section('源码: 需求2/3/4 拖拽与预览会话');
{
  const st = read('src/osu/store.ts');
  assert(/private pushSnapshot\(\)/.test(st), 'pushSnapshot 抽出 (pushUndo/beginDrag 共用)');
  const bd = st.match(/beginDrag\(\) \{[\s\S]{0,600}?\n  \}/)?.[0] ?? '';
  assert(/dragPreviewSession/.test(bd) && /this\.pushSnapshot\(\); else this\.pushUndo\(\)/.test(bd), 'beginDrag: 预览会话中快照取当前(预览)态 (不先回滚)');
  const cd = st.match(/commitDrag\(\) \{[\s\S]{0,1400}?\n  \}/)?.[0] ?? '';
  assert(/restoreTransformBackup/.test(cd) && /undoStack\.push\(s0, s1\)/.test(cd) && /beginTransformPreview\(\)/.test(cd),
    'commitDrag: 预览固化独立 undo 步 + 拖拽后重立基准');
  assert(/restoreNodeTransformBackup/.test(cd) && /beginNodeTransformPreview\(\)/.test(cd), 'commitDrag: 节点会话同构处理');
  const cn = st.match(/cancelDragNoop\(\) \{[\s\S]{0,400}?\n  \}/)?.[0] ?? '';
  assert(/dragPreviewSession = null/.test(cn), 'cancelDragNoop: 清预览会话标记 (纯点击无副作用)');
  const ud = st.match(/  undo\(\) \{[\s\S]{0,700}?\n  \}/)?.[0] ?? '';
  assert(/restoreTransformBackup/.test(ud) && /beginTransformPreview/.test(ud), 'undo: 预览会话感知 (回滚→撤销→重立基准)');
  const rd = st.match(/  redo\(\) \{[\s\S]{0,700}?\n  \}/)?.[0] ?? '';
  assert(/restoreTransformBackup/.test(rd) && /beginTransformPreview/.test(rd), 'redo: 预览会话感知');
  const app = read('src/App.tsx');
  const branch = app.match(/if \(store\.transformDialog\) \{[\s\S]{0,700}?\n      \}/)?.[0] ?? '';
  assert(/id0 === 'undo'/.test(branch) && /id0 === 'redo'/.test(branch), 'App: 窗口开着时放行 Ctrl+Z / Ctrl+Y');
}

section('源码: i18n + LF');
{
  const dict = read('src/i18n/dicts/zh-CN/transform.ts');
  assert(/'transform\.no_selection_hint'/.test(dict), 'zh-CN 收录 transform.no_selection_hint');
  const td = read('src/components/TransformDialog.tsx');
  assert(/transform\.no_selection_hint/.test(td), 'TransformDialog 空选区提示 (英文默认在代码内)');
  for (const f of ['src/osu/store.ts', 'src/App.tsx', 'src/components/TransformDialog.tsx', 'src/i18n/dicts/zh-CN/transform.ts', 'electron/main.cjs'])
    assert(!read(f).includes('\r'), `${f} 无 CRLF`);
}

section('CDP: 四项行为实测');
{
  const PORT = 9479;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const { proc: electron, profile } = launchIsolatedElectron(root, PORT); // v383: 隔离 userData, 不碰真实 settings/localStorage
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
    await normalizeEnv(evalJs); // v383: 就绪等待 + 环境归一 (语言 en / 默认皮肤 / 关曲库与首跑框 / 清污染键)

    // setup: 造谱 (滑条 379001 + 单点 379002) — 持久化状态归一已由 normalizeEnv 完成 (v378 教训)
    const setup = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t0 = Math.round(red.time + red.beatLength * 4);
      const s1 = { id: 379001, type: 'slider', x: 200, y: 150, time: t0, newCombo: true, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: 320, y: 150 }], slides: 1, length: 120 };
      const c2 = { id: 379002, type: 'circle', x: 420, y: 320, time: t0, newCombo: true, comboSkip: 0, hitSound: 0 };
      store.load({ ...base, hitObjects: [s1, c2] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select'; store.lockNotes = false;
      store.setDisplayFlag('selectionBounds', true); // 包围框开关持久化, 显式归一
      const p0 = window.__osuToClient(0, 0), px = window.__osuToClient(1, 0), py = window.__osuToClient(0, 1);
      // 共用工具挂 window, 后续 evalJs 段复用
      window.__v379 = {
        sleep,
        szx: px.x - p0.x, szy: py.y - p0.y,
        // 全字段快照 (数值保留原浮点; 比较用归一化)
        geo: () => store.beatmap.hitObjects.map(o => ({ id: o.id, type: o.type, x: o.x, y: o.y, time: o.time, len: o.length ?? null,
          cps: (o.curvePoints ?? []).map(p => [p.x, p.y]), slides: o.slides ?? null, nc: o.newCombo, hs: o.hitSound })),
        norm: (g) => JSON.stringify(g, (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v),
        geoEq: function (a, b) { return this.norm(a) === this.norm(b); },
        setNum: (dlg, name, v) => {
          const inp = document.querySelector('[data-dialog="' + dlg + '"] input[data-conv="' + name + '"]');
          if (!inp) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(inp, String(v));
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        },
        key: (key, opts = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })),
        // 画布物件拖拽: 起点 osu 坐标, 位移视觉 px; onDown/afterDown 回调在按下后/移动后取几何
        dragObj: async (ox, oy, dx, dy) => {
          const c = document.querySelector('canvas.cursor-crosshair');
          const pt = window.__osuToClient(ox, oy);
          c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
          await sleep(80);
          const afterDown = window.__v379.geo();
          c.dispatchEvent(new MouseEvent('mousemove', { clientX: pt.x + dx, clientY: pt.y + dy, bubbles: true }));
          await sleep(300);
          c.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + dx, clientY: pt.y + dy, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x + dx, clientY: pt.y + dy, bubbles: true }));
          await sleep(150);
          return { afterDown, after: window.__v379.geo() };
        },
      };
      store.seek(t0);
      await sleep(400);
      return { t0 };
    })()`);

    // ---- 需求1: 无选区快捷键开窗 → 调值/应用 no-op → 选中后即生效 ----
    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore, V = window.__v379, sleep = V.sleep;
      store.clearSelection(); store.setSelectedNodes([]);
      const S0 = V.geo();
      V.key('R', { ctrlKey: true, shiftKey: true });
      await sleep(300);
      const opened = store.transformDialog === 'rotate' && !!document.querySelector('[data-dialog="rotate-dlg"]');
      const undo0 = store.canUndo;
      V.setNum('rotate-dlg', 'angle', 30); // 无选区调值
      await sleep(250);
      const noopPreview = V.geoEq(V.geo(), S0);
      const btn = document.querySelector('[data-dialog="rotate-dlg"] [data-tf="apply-rotate"]');
      btn && btn.click(); // 无选区应用
      await sleep(250);
      const noopApply = V.geoEq(V.geo(), S0) && store.canUndo === undo0; // 不产生空 undo 快照
      // v463 适配: 「应用旋转」点击后自动关窗 (含无选区 no-op) — 后续用例需重开窗口
      const closedByApply = store.transformDialog === null;
      if (closedByApply) { store.openTransformDialog('rotate'); await sleep(300); }
      // 窗口开着时选中物件 → 改值即生效
      store.select([379001]);
      await sleep(300);
      V.setNum('rotate-dlg', 'angle', 90);
      await sleep(250);
      const effectiveAfterSelect = !V.geoEq(V.geo(), S0);
      const stillOpen = store.transformDialog === 'rotate';
      V.key('Escape'); // 关窗回滚 (未提交)
      await sleep(250);
      const rollback = store.transformDialog === null && V.geoEq(V.geo(), S0);
      // 缩放窗口同样无选区可开
      V.key('S', { ctrlKey: true, shiftKey: true });
      await sleep(300);
      const scaleOpened = store.transformDialog === 'scale' && !!document.querySelector('[data-dialog="scale-dlg"]');
      V.key('Escape');
      await sleep(200);
      return { opened, noopPreview, noopApply, effectiveAfterSelect, stillOpen, rollback, scaleOpened, closed: store.transformDialog === null };
    })()`);
    assert(r1.opened, '1a: 无选区 Ctrl+Shift+R 打开旋转窗口');
    assert(r1.noopPreview, '1b: 无选区调值预览无效果');
    assert(r1.noopApply, '1c: 无选区点应用 = no-op (几何不变且无空 undo 快照)');
    assert(r1.effectiveAfterSelect && r1.stillOpen, '1d: 窗口开着时选中物件, 改值即生效 (预览出现)');
    assert(r1.rollback, '1e: Esc 关窗回滚未提交预览');
    assert(r1.scaleOpened && r1.closed, '1f: 无选区 Ctrl+Shift+S 打开缩放窗口');

    // ---- 需求2+3b+4: 预览 → 拖曳 → 调值不中断 → 关窗 → 撤销链回最初 ----
    const r2 = await evalJs(`(async () => {
      const store = window.__osuStore, V = window.__v379, sleep = V.sleep;
      store.clearSelection(); store.setSelectedNodes([]);
      store.select([379001]);
      const S0 = V.geo();
      V.key('R', { ctrlKey: true, shiftKey: true });
      await sleep(300);
      V.setNum('rotate-dlg', 'angle', 90);
      await sleep(250);
      const S1 = V.geo(); // 预览态
      const previewOk = !V.geoEq(S1, S0);
      // 拖曳预览态的滑条头 (按下瞬间不应弹回原点 = 需求3b)
      const o = store.beatmap.hitObjects.find(x => x.id === 379001);
      const drag = await V.dragObj(o.x, o.y, 40, 25);
      const noSnapBack = V.geoEq(drag.afterDown, S1); // 按下后几何 = 预览态
      const S2 = drag.after;
      const dragMoved = !V.geoEq(S2, S1);
      const ddx = S2[0].x - S1[0].x, ddy = S2[0].y - S1[0].y;
      const dragDelta = Math.abs(ddx - 40 / V.szx) <= 3 && Math.abs(ddy - 25 / V.szy) <= 3;
      // 需求4: 拖完后预览会话仍在 — 改值生效, 归零回到拖拽后基准
      const dlgStillOpen = store.transformDialog === 'rotate';
      V.setNum('rotate-dlg', 'angle', 45);
      await sleep(250);
      const previewAlive = !V.geoEq(V.geo(), S2);
      V.setNum('rotate-dlg', 'angle', 0);
      await sleep(250);
      const backToDragBase = V.geoEq(V.geo(), S2); // 预览基准 = 拖拽后几何 (修复前: 回到预览前 S0, 拖曳被抹)
      // 关窗 (预览已固化 + 当前在基准上, 关窗无变化)
      V.key('Escape');
      await sleep(250);
      const closeKeeps = store.transformDialog === null && V.geoEq(V.geo(), S2);
      // 撤销链: S2 →(undo 拖曳)→ S1 →(undo 预览)→ S0 → 空栈不动
      V.key('z', { ctrlKey: true }); await sleep(200);
      const U1 = V.geo(); const u1ok = V.geoEq(U1, S1);
      V.key('z', { ctrlKey: true }); await sleep(200);
      const U2 = V.geo(); const u2ok = V.geoEq(U2, S0);
      const u3empty = !store.canUndo;
      V.key('z', { ctrlKey: true }); await sleep(200);
      const u3stable = V.geoEq(V.geo(), S0);
      return { previewOk, noSnapBack, dragMoved, dragDelta, ddx, ddy, dlgStillOpen, previewAlive, backToDragBase,
        closeKeeps, u1ok, u2ok, u3empty, u3stable,
        dbg: { S0: V.norm(S0), S1: V.norm(S1), S2: V.norm(S2), U1: V.norm(U1), U2: V.norm(U2) } };
    })()`);
    assert(r2.previewOk, '2a: 预览生效 (角度 90)');
    assert(r2.noSnapBack, '3b: 开窗预览中按下拖曳, 物件不弹回原点 (修复前: pushUndo 先回滚预览 = 瞬回原位)');
    assert(r2.dragMoved && r2.dragDelta, `2b: 拖曳位移精确 (实测 dx ${r2.ddx?.toFixed(1)}, dy ${r2.ddy?.toFixed(1)})`);
    assert(r2.dlgStillOpen && r2.previewAlive, '4a: 拖曳后窗口会话仍在, 改值预览继续生效');
    assert(r2.backToDragBase, '4b: 预览基准 = 拖拽后几何 (调回 0 返回拖拽后状态, 拖曳不被抹掉)');
    assert(r2.closeKeeps, '2c: 关窗保持拖拽后状态 (预览已在拖曳起步时固化)');
    assert(r2.u1ok, '2d: 撤销第 1 步 = 撤拖拽, 回到预览态');
    assert(r2.u2ok, '2e: 撤销第 2 步 = 撤预览, 回到最初谱面');
    assert(r2.u3empty && r2.u3stable, '2f: 撤销链耗尽后状态稳定 (最初谱面)');
    if (!r2.u1ok || !r2.u2ok) console.log('  dbg:', JSON.stringify(r2.dbg));

    // ---- 需求3a: 窗口开着时 Ctrl+Z / Ctrl+Y ----
    const r3 = await evalJs(`(async () => {
      const store = window.__osuStore, V = window.__v379, sleep = V.sleep;
      // 重载清栈
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t0 = ${setup.t0};
      const s1 = { id: 379001, type: 'slider', x: 200, y: 150, time: t0, newCombo: true, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: 320, y: 150 }], slides: 1, length: 120 };
      const c2 = { id: 379002, type: 'circle', x: 420, y: 320, time: t0, newCombo: true, comboSkip: 0, hitSound: 0 };
      store.load({ ...base, hitObjects: [s1, c2] }, store.audioUrl);
      store.seek(t0); store.clearSelection(); store.setSelectedNodes([]);
      store.select([379001]);
      const S0 = V.geo();
      // 先做一次普通拖拽 (产生一个 undo 步)
      const o = store.beatmap.hitObjects.find(x => x.id === 379001);
      const d0 = await V.dragObj(o.x, o.y, 30, 0);
      const D1 = d0.after;
      const dragOk = !V.geoEq(D1, S0) && store.canUndo;
      // 开窗 + 预览 (不提交)
      V.key('R', { ctrlKey: true, shiftKey: true });
      await sleep(300);
      V.setNum('rotate-dlg', 'angle', 60);
      await sleep(250);
      const previewOn = !V.geoEq(V.geo(), D1);
      // 开窗状态 Ctrl+Z — 应撤销上一次拖拽 (预览先回滚)
      V.key('z', { ctrlKey: true });
      await sleep(250);
      const undoWorks = V.geoEq(V.geo(), S0) && store.transformDialog === 'rotate';
      // 开窗状态 Ctrl+Y 重做
      V.key('y', { ctrlKey: true });
      await sleep(250);
      const redoWorks = V.geoEq(V.geo(), D1) && store.transformDialog === 'rotate';
      V.key('Escape');
      await sleep(250);
      return { dragOk, previewOn, undoWorks, redoWorks, closed: store.transformDialog === null,
        dbgAfterUndo: !undoWorks ? V.norm(V.geo()) : undefined };
    })()`);
    assert(r3.dragOk && r3.previewOn, '3a-setup: 拖拽入 undo + 开窗预览生效');
    assert(r3.undoWorks, '3a: 窗口开着时 Ctrl+Z 正常撤销 (预览回滚 + 撤销上一次拖拽)');
    assert(r3.redoWorks, '3a: 窗口开着时 Ctrl+Y 正常重做');
    assert(r3.closed, '3a: Esc 关窗正常');

    // ---- 节点模式同构: 节点预览 + 节点拖曳 + 撤销链 ----
    const r5 = await evalJs(`(async () => {
      const store = window.__osuStore, V = window.__v379, sleep = V.sleep;
      const base = store.beatmap;
      const t0 = ${setup.t0};
      const s1 = { id: 379001, type: 'slider', x: 200, y: 150, time: t0, newCombo: true, comboSkip: 0, hitSound: 0,
        curveType: 'L', curvePoints: [{ x: 320, y: 150 }], slides: 1, length: 120 };
      const c2 = { id: 379002, type: 'circle', x: 420, y: 320, time: t0, newCombo: true, comboSkip: 0, hitSound: 0 };
      store.load({ ...base, hitObjects: [s1, c2] }, store.audioUrl);
      store.seek(t0); store.clearSelection(); store.setSelectedNodes([]);
      store.select([379001]);
      store.setSelectedNodes([[379001, 0], [379001, 1]]); // 两个锚点 (单点旋转/缩放绕自身 = 无效果)
      const S0 = V.geo();
      V.key('R', { ctrlKey: true, shiftKey: true });
      await sleep(300);
      const nodeMode = !!document.querySelector('[data-dialog="rotate-dlg"]');
      V.setNum('rotate-dlg', 'angle', 30);
      await sleep(250);
      const N1 = V.geo();
      const previewOk = !V.geoEq(N1, S0);
      // 拖曳预览态的尾锚点 (idx 1): 按下不弹回 (节点版 3b)
      const o = store.beatmap.hitObjects.find(x => x.id === 379001);
      const cp = o.curvePoints[0];
      const drag = await V.dragObj(cp.x, cp.y, 30, 15);
      const noSnapBack = V.geoEq(drag.afterDown, N1);
      const N2 = drag.after;
      // v379 修正: 复选 2 锚点时按下落在节点黄框内 = 整组拖 (v309), 两个锚点一起动 (头为选中锚点 0, 随之移动);
      //   断言整组位移一致即可 (单锚点拖拽不适用本场景 — 单锚点旋转/缩放绕自身无效果)
      const dN0x = N2[0].x - N1[0].x, dN0y = N2[0].y - N1[0].y;
      const dN1x = N2[0].cps[0][0] - N1[0].cps[0][0], dN1y = N2[0].cps[0][1] - N1[0].cps[0][1];
      const dragMoved = !V.geoEq(N2, N1) && Math.abs(dN0x - dN1x) < 0.02 && Math.abs(dN0y - dN1y) < 0.02
        && Math.abs(dN1x - 30 / V.szx) <= 3 && Math.abs(dN1y - 15 / V.szy) <= 3;
      V.key('Escape');
      await sleep(250);
      const closeKeeps = V.geoEq(V.geo(), N2);
      V.key('z', { ctrlKey: true }); await sleep(200);
      const u1ok = V.geoEq(V.geo(), N1);
      V.key('z', { ctrlKey: true }); await sleep(200);
      const u2ok = V.geoEq(V.geo(), S0);
      return { nodeMode, previewOk, noSnapBack, dragMoved, closeKeeps, u1ok, u2ok };
    })()`);
    assert(r5.nodeMode && r5.previewOk, '5a: 节点模式窗口预览生效');
    assert(r5.noSnapBack, '5b: 节点预览中拖锚点不弹回 (节点版需求3b)');
    assert(r5.dragMoved, '5c: 节点拖曳生效 (复选锚点黄框内 = 整组拖, 两锚点等位移)');
    assert(r5.closeKeeps && r5.u1ok && r5.u2ok, '5d: 节点版撤销链: 当前 → 预览态 → 最初');

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 400));
  } finally {
    await killIsolated(electron, profile); // v383: 杀进程 + 回收临时 profile
  }
}

console.log(failures ? `\nVERIFIER_V379_FAILED: ${failures} 处失败` : '\nVERIFIER_V379_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
