// 验证器 v431: 修「独立弹窗点击穿透到背后的物件/锚点」
// 根因: EditorCanvas window 捕获监听 (v361/v378/v404 穿透链) —
//   1) onDown: v378 让 anchorFirst (锚点命中) 压过控件判定, 而 [data-dialog] 排除排在 anchorFirst
//      之后, 弹窗正好压在锚点上时左键穿透 (选中锚点/开拖);
//   2) onCtx: 右键完全没有对话框排除 — 弹窗上右键穿透删锚点/红转白 (sliderAnchorContextPress)。
// 修复: onDown 在 anchorFirst 计算之前 return ([data-dialog]); onCtx 同款排除;
//   非 DraggableDialog 的弹窗根元素补 data-dialog (SongLibrary/FirstRunWizard/UnsavedDialog/
//   SkinListPanel/SkinPicker/LangFirstRun)。hover/wheel 无穿透: 弹窗渲染在 App 根层,
//   画布 onMouseMove/onWheel 是画布容器上的 React 监听, 事件不经过弹窗。
// 运行: npm run build 后 node verifier/v431/check.mjs
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

section('源码: EditorCanvas 穿透链弹窗排除');
{
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/v431: 弹窗 \(data-dialog\) 挡住一切画布穿透/.test(ec), 'v431 onDown 注释');
  const down = ec.match(/const onDown = \(e: MouseEvent\) => \{[\s\S]*?\n    \};\n    const onCtx/)?.[0] ?? '';
  assert(down.length > 0, 'onDown 段可解析');
  const iDlg = down.indexOf("if (el.closest('[data-dialog]')) return;");
  const iAnchor = down.indexOf('const anchorFirst');
  assert(iDlg >= 0, 'onDown 有 [data-dialog] 排除');
  assert(iDlg >= 0 && iDlg < iAnchor, '[data-dialog] 排除先于 anchorFirst 计算 (弹窗压过锚点)');
  const ctx = ec.match(/const onCtx = \(e: MouseEvent\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
  assert(/el\.closest\('\[data-dialog\]'\)\) return; \/\/ v431/.test(ctx), 'onCtx 右键有 [data-dialog] 排除');
}

section('源码: 全部弹窗根元素带 data-dialog');
{
  assert(/data-dialog=\{testid\}/.test(read('src/components/DraggableDialog.tsx')), 'DraggableDialog 自带 data-dialog (Rotate/Scale/Duplicate/多边形/连打/分割/显示/音量等共用)');
  assert(/data-dialog="song-library"/.test(read('src/components/SongLibrary.tsx')), 'SongLibrary 根带标记');
  assert(/data-dialog="first-run-wizard"/.test(read('src/components/FirstRunWizard.tsx')), 'FirstRunWizard 根带标记');
  assert(/data-dialog="unsaved"/.test(read('src/components/UnsavedDialog.tsx')), 'UnsavedDialog 根带标记');
  assert(/data-dialog="skin-list"/.test(read('src/components/SkinListPanel.tsx')), 'SkinListPanel 根带标记');
  assert(/data-dialog="skin-picker"/.test(read('src/components/SkinPicker.tsx')), 'SkinPicker 根带标记');
  assert(/data-dialog="lang-first-run"/.test(read('src/components/LangFirstRun.tsx')), 'LangFirstRun 根带标记');
}

section('CDP: 弹窗上左键/右键不穿透, 关窗恢复');
{
  const PORT = 9501;
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
    await sleep(600);

    // 造一条 8 锚点滑条环绕游玩区中心 (纯白 L 折线, 无重复对), seek 使其锚点可交互;
    // 开显示设置面板 (DraggableDialog, 挂载后视口居中) — 弹窗必盖住中心区域若干锚点
    const setup = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      const red = base.timingPoints.find(p => p.uninherited);
      const t = Math.round(red.time + red.beatLength * 8);
      const mk = { id: 964310, type: 'slider', x: 256, y: 192, time: t,
        newCombo: true, comboSkip: 0, hitSound: 0, curveType: 'L',
        curvePoints: [
          { x: 136, y: 72 }, { x: 376, y: 72 }, { x: 376, y: 312 }, { x: 136, y: 312 },
          { x: 256, y: 72 }, { x: 376, y: 192 }, { x: 256, y: 312 }, { x: 136, y: 192 },
        ], slides: 1, length: 1200 };
      store.load({ ...base, timingPoints: [{ ...red }], hitObjects: [mk] }, store.audioUrl);
      store.pause && store.pause();
      store.tool = 'select';
      store.seek(t + 100);
      store.select([]);
      store.setDisplayPanelOpen(true);
      await sleep(400);
      const dlg = document.querySelector('[data-dialog="display-panel"]');
      if (!dlg) return { ok: false, why: 'display-panel 未打开' };
      const r = dlg.getBoundingClientRect();
      const o = store.beatmap.hitObjects.find(x => x.id === 964310);
      const ctrl = [{ x: o.x, y: o.y }, ...o.curvePoints];
      const inDlg = ctrl.map((p, i) => ({ i, c: window.__osuToClient(p.x, p.y) }))
        .filter(p => p.c && p.c.x > r.left + 6 && p.c.x < r.right - 6 && p.c.y > r.top + 6 && p.c.y < r.bottom - 6);
      const nonHead = inDlg.filter(p => p.i > 0);
      // padding 点: 弹窗底部内侧, 且 elementFromPoint 不在任何控件上
      let pad = null;
      for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const x = r.left + r.width * fx, y = r.bottom - 10;
        const el = document.elementFromPoint(x, y);
        if (el && dlg.contains(el) && !el.closest('button, input, select, textarea, a, label')) { pad = { x, y }; break; }
      }
      return { ok: !!(nonHead.length && pad), head: inDlg.find(p => p.i === 0)?.c ?? window.__osuToClient(o.x, o.y),
        anchor: nonHead[0]?.c, pad, dlgCount: inDlg.length };
    })()`);
    assert(setup.ok === true, `setup: 弹窗盖住非头锚点 (${setup.dlgCount ?? '?'} 锚点在窗内) 且有 padding 点${setup.why ? ' — ' + setup.why : ''}`);

    if (setup.ok) {
      // A: 左键点在弹窗覆盖的锚点上 — 不穿透: 选区/节点选区都不变 (修复前: v378 anchorFirst 穿透选中锚点)
      const rA = await evalJs(`(() => {
        const store = window.__osuStore;
        const x = ${setup.anchor.x}, y = ${setup.anchor.y};
        const el = document.elementFromPoint(x, y);
        el.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
        return { sel: store.selected.size, nodes: store.nodeSelectionCount,
          inDialog: !!(el && el.closest('[data-dialog]')) };
      })()`);
      assert(rA.inDialog, 'A: 落点元素在弹窗内 (前提)');
      assert(rA.sel === 0 && rA.nodes === 0, `A: 弹窗上左键不穿透到锚点 (selected=${rA.sel}, nodes=${rA.nodes}; 修复前 nodes>0)`);

      // B: 右键点在弹窗覆盖的锚点上 (选中单滑条) — 不删锚点 (修复前: onCtx 无排除, 白锚点被删 curvePoints-1)
      const rB = await evalJs(`(async () => {
        const store = window.__osuStore;
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        store.select([964310]);
        await sleep(100);
        const len0 = store.beatmap.hitObjects.find(o => o.id === 964310).curvePoints.length;
        const x = ${setup.anchor.x}, y = ${setup.anchor.y};
        const el = document.elementFromPoint(x, y);
        el.dispatchEvent(new MouseEvent('contextmenu', { clientX: x, clientY: y, button: 2, bubbles: true, cancelable: true }));
        await sleep(100);
        const len1 = store.beatmap.hitObjects.find(o => o.id === 964310).curvePoints.length;
        return { len0, len1, inDialog: !!(el && el.closest('[data-dialog]')) };
      })()`);
      assert(rB.inDialog, 'B: 落点元素在弹窗内 (前提)');
      assert(rB.len1 === rB.len0, `B: 弹窗上右键不删锚点 (curvePoints ${rB.len0} → ${rB.len1}; 修复前 -1)`);

      // C: 弹窗 padding 普通区左键 — 回归: 不 seek/不改选区 (旧 :551 控件排除语义保留)
      const rC = await evalJs(`(() => {
        const store = window.__osuStore;
        const t0 = store.currentTime;
        const x = ${setup.pad.x}, y = ${setup.pad.y};
        const el = document.elementFromPoint(x, y);
        el.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
        return { dTime: store.currentTime !== t0, nodes: store.nodeSelectionCount, dragging: !!store.canvasDragging };
      })()`);
      assert(!rC.dTime && rC.nodes === 0 && !rC.dragging, `C: padding 点击无副作用 (seek=${rC.dTime}, nodes=${rC.nodes}, dragging=${rC.dragging})`);

      // D: 关弹窗后同区域点击恢复画布交互 — 点滑条头部 (物件本体) 正常选中
      const rD = await evalJs(`(async () => {
        const store = window.__osuStore;
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        store.setDisplayPanelOpen(false);
        store.select([]);
        await sleep(300);
        const c = window.__osuToClient(256, 192);
        const el = document.elementFromPoint(c.x, c.y);
        el.dispatchEvent(new MouseEvent('mousedown', { clientX: c.x, clientY: c.y, button: 0, bubbles: true, cancelable: true }));
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: c.x, clientY: c.y, bubbles: true }));
        await sleep(100);
        return { sel: store.selected.has(964310), tag: el && el.tagName };
      })()`);
      assert(rD.sel, `D: 关窗后点击恢复选中物件 (target=${rD.tag})`);
    }

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

console.log(failures ? `\nVERIFIER_V431_FAILED: ${failures} 处失败` : '\nVERIFIER_V431_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
