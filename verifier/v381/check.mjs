// 验证器 v381: 设置/UI 类五项用户反馈
//  v386 适配: 需求2/3 的两个 editorPrefs 开关 UI 从快捷键设置面板「通用」区挪到菜单栏「设置」菜单
//  (checkbox 菜单项), 相关断言已同步改为「HotkeyPanel 不再含 + 主进程菜单含」; 行为断言不变。
//  1) 显示设置新增「时间轴 SV / 音量标记」开关 (displaySettings.timelineSvSample, 默认开 = 现状) —
//     关 = 上方时间轴不画 hitsound 粉药丸 (采样集+音量) 与绿线 SV 药丸, SV 药丸命中测试同步关闭
//     (Timelines.tsx 收集/绘制/命中三处门控; DisplayPanel.tsx 加开关行)。
//  2) 设置面板 (快捷键面板) 新增「通用」区: 数值框拖动调值总开关 (editorPrefs.dragAdjustNumbers,
//     默认开 = v258/v269 现状) — 关 = DraftNum 按下不进入拖动调值, 滚轮/键入保留
//     (新模块 src/osu/editorPrefs.ts; DraggableDialog.tsx onPointerDown 门控)。
//  3) 通用区「物件移动死区 2px」开关 (editorPrefs.moveDeadzone2px, 默认开 = 2px 现状; 关 = 1px) —
//     EditorCanvas applyObjectDrag 死区阈值取 prefs; 顺带修复: 原死区内仍实时改写坐标
//     (moved=false 不 emit/不入 undo, 松手 cancelDragNoop 弹空快照不还原 → 1px 微拖静默移位),
//     现死区内直接不应用位移。包围框手柄/滑条锚点拖拽不走此死区 (各自 moved 逻辑不动)。
//  4) hover 滑条锚点位置信息 — EditorCanvas refreshHover 把 hover 锚点同步到 store.hoverNode
//     (Alt 层最近锚点 + 非 Alt 悬停选中滑条手柄, 命中同 mousedown nearestCtrlPoint);
//     右上角 SelectionInfoPanel 新增 hover 分支显示 滑条点序号 + x/y 坐标
//     (优先级: 节点选区 > hover > 物件/预览; 出画布/拖拽中清空)。
//  5) 枚举下拉框滚轮循环 — 新模块 src/osu/selectWheel.ts 全局捕获 wheel: 悬停 <select> 滚动切选项,
//     末尾循环回开头 (反向亦然); 原生 setter + change 事件驱动 React 受控组件; 改键捕获态让位。
//     App.tsx 挂载一次, 覆盖全部枚举框 (节拍细分/网格类型/语言/音效集/皮肤样式/转换弹窗等)。
// 运行: npm run build 后 node verifier/v381/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs'; // v383: 环境归一共享 helper

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 需求1 时间轴 SV/音量开关');
{
  const ds = read('src/osu/displaySettings.ts');
  assert(/timelineSvSample: boolean/.test(ds), 'displaySettings 新增 timelineSvSample');
  assert(/timelineSvSample: true,\s*\/\/ v381/.test(ds), '默认开 (保持现状)');
  assert(/timelineSvSample: p\.timelineSvSample !== false/.test(ds), '持久化载入回退默认开');
  const tl = read('src/components/Timelines.tsx');
  assert(/if \(displaySettings\.timelineSvSample\) \{\s*\n\s*const sp = samplePill/.test(tl), '粉药丸收集门控');
  assert(/displaySettings\.timelineSvSample 关 = SV 药丸不画[\s\S]{0,200}?if \(displaySettings\.timelineSvSample\) \{/.test(tl), 'SV 药丸绘制门控');
  assert(/if \(displaySettings\.timelineSvSample\) for \(const p of svPoints/.test(tl), 'SV 药丸命中测试门控');
  const dp = read('src/components/DisplayPanel.tsx');
  assert(/key: 'timelineSvSample'/.test(dp), 'DisplayPanel 开关行');
}

section('源码: 需求2/3 通用偏好 (editorPrefs + 面板 + 消费点)');
{
  const ep = read('src/osu/editorPrefs.ts');
  assert(/dragAdjustNumbers: p\.dragAdjustNumbers !== false/.test(ep), '拖动调值默认开');
  assert(/moveDeadzone2px: p\.moveDeadzone2px !== false/.test(ep), '死区 2px 默认开');
  const dd = read('src/components/DraggableDialog.tsx');
  assert(/if \(!editorPrefs\.dragAdjustNumbers\) return; \/\/ v381/.test(dd), 'DraftNum 按下门控 (关 = 不进入拖动)');
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/Math\.abs\(dx\) \+ Math\.abs\(dy\) > \(editorPrefs\.moveDeadzone2px \? 1 : 0\)\) d\.moved = true/.test(ec), '物件拖拽死区阈值取 prefs (开 2px / 关 1px)');
  assert(/if \(!d\.moved\) return;/.test(ec), '死区内不应用位移 (修复静默移位)');
  const hp = read('src/components/HotkeyPanel.tsx');
  // v386: 两个开关 UI 挪到菜单栏「设置」菜单 — HotkeyPanel 不再含通用区, 主进程菜单含 checkbox 项
  assert(!/PREF_ROWS|data-pref-toggle|pref-general-section/.test(hp), '快捷键面板不再含通用区开关 (v386 挪位)');
  const mc = read('electron/main.cjs');
  assert(/menu\.drag_adjust_numbers"\), type: "checkbox"/.test(mc) && /menu\.move_deadzone"\), type: "checkbox"/.test(mc), '设置菜单含两项 checkbox (v386)');
  const st = read('src/osu/store.ts');
  assert(/setEditorPref\(k: EditorPrefKey, v: boolean\)/.test(st), 'store.setEditorPref');
}

section('源码: 需求4 hover 锚点位置信息');
{
  const st = read('src/osu/store.ts');
  assert(/hoverNode: \{ objId: number; idx: number \} \| null = null/.test(st), 'store.hoverNode 字段');
  assert(/setHoverNode\(v: \{ objId: number; idx: number \} \| null\)/.test(st), 'store.setHoverNode (同值不 emit)');
  const ec = read('src/components/EditorCanvas.tsx');
  assert(/store\.setHoverNode\(hoverNodeRef\.current\)/.test(ec), 'refreshHover 同步 hoverNode');
  assert(/store\.setHoverNode\(null\); \/\/ v381: 光标出游玩区/.test(ec), '出画布清空');
  const tl = read('src/components/Timelines.tsx');
  assert(/store\.hoverNode/.test(tl) && /timeline\.hover_node/.test(tl), '信息面板 hover 分支');
}

section('源码: 需求5 枚举框滚轮循环');
{
  const sw = read('src/osu/selectWheel.ts');
  assert(/window\.addEventListener\('wheel', onWheel, \{ capture: true, passive: false \}\)/.test(sw), '全局捕获 wheel');
  assert(/% enabled\.length\]/.test(sw), '取模首尾循环');
  assert(/Object\.getOwnPropertyDescriptor\(HTMLSelectElement\.prototype, 'value'\)/.test(sw), '原生 setter 绕过 React value tracker');
  assert(/hotkeyCaptureActive\(\)/.test(sw), '改键捕获态让位');
  const app = read('src/App.tsx');
  assert(/useEffect\(\(\) => installSelectWheelCycle\(\), \[\]\)/.test(app), 'App 挂载安装');
}

section('CDP: 五项行为实测');
{
  const PORT = 9481;
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
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs); // v383: 就绪等待 + 环境归一 (语言 en / 默认皮肤 / 关曲库 / 清污染键)

    // setup: 归一持久化状态 (localStorage/皮肤跨运行污染教训)
    await evalJs(`(() => {
      const store = window.__osuStore;
      window.__osuSetLang && window.__osuSetLang('en'); // 关首跑语言框
      localStorage.removeItem('osu-editor:hotkeys');
      window.__osuSkin && window.__osuSkin.resetSkinToDefault();
      store.pause && store.pause();
      store.tool = 'select'; store.lockNotes = false;
      store.setEditorPref('dragAdjustNumbers', true);
      store.setEditorPref('moveDeadzone2px', true);
      store.setDisplayFlag('timelineSvSample', true);
      // 合成 PointerEvent 无活动指针, setPointerCapture 会抛 NotFoundError — DraftNum 拖调测试打 noop 补丁
      Element.prototype.setPointerCapture = function () {};
      return true;
    })()`);
    await sleep(500);

    // ---- 需求1: 时间轴 SV/音量药丸开关 (拦截上时间轴 fillText 实测绘制文本) ----
    const r1 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const base = store.beatmap;
      store.load({ ...base,
        timingPoints: [
          { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
          { time: 2000, beatLength: -75, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 },
        ],
        hitObjects: [{ id: 9101, type: 'circle', time: 1500, x: 256, y: 192, hitSound: 0, newCombo: false, comboSkip: 0 }],
        editor: { ...base.editor, beatDivisor: 4, bookmarks: [] } }, null);
      store.pause && store.pause();
      store.seek(1500);
      const proto = CanvasRenderingContext2D.prototype;
      if (!proto.__v381Patched) {
        proto.__v381Patched = true;
        proto.__v381Log = [];
        const orig = proto.fillText;
        proto.fillText = function (t, x, y, mw) {
          try { if (this.canvas && String(this.canvas.className).includes('h-[92px]')) proto.__v381Log.push(String(t)); } catch {}
          return orig.call(this, t, x, y, mw);
        };
      }
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      proto.__v381Log.length = 0;
      await sleep(400);
      const on = [...proto.__v381Log];
      store.setDisplayFlag('timelineSvSample', false);
      proto.__v381Log.length = 0;
      await sleep(400);
      const off = [...proto.__v381Log];
      store.setDisplayFlag('timelineSvSample', true);
      proto.__v381Log.length = 0;
      await sleep(400);
      const back = [...proto.__v381Log];
      return { on, off, back };
    })()`);
    assert(r1.on.includes('120.0 BPM') && r1.on.includes('1.33x') && r1.on.some(t => /^N \d+$/.test(t)),
      `1a: 开关开 — BPM/SV/音量药丸都画 (on=${JSON.stringify(r1.on.slice(0, 12))})`);
    assert(r1.off.includes('120.0 BPM') && !r1.off.includes('1.33x') && !r1.off.some(t => /^N \d+$/.test(t)),
      `1b: 开关关 — BPM 红药丸保留, SV/音量药丸消失 (off=${JSON.stringify(r1.off.slice(0, 12))})`);
    assert(r1.back.includes('1.33x'), '1c: 重新开启后 SV 药丸恢复');

    // ---- 需求2: DraftNum 拖动调值开关 ----
    const r2 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.openConversion('duplicate');
      await sleep(300);
      const inp = document.querySelector('[data-conv="count"]');
      if (!inp) return { err: 'count input not found' };
      const drag = (dx) => {
        const r = inp.getBoundingClientRect();
        const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
        inp.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, clientX: x0, clientY: y0 }));
        inp.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, clientX: x0 + dx, clientY: y0 }));
        inp.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 7, clientX: x0 + dx, clientY: y0 }));
      };
      const v0 = parseFloat(inp.value);
      drag(25); // 开: 5px=1step → +5
      await sleep(120);
      const v1 = parseFloat(inp.value);
      store.setEditorPref('dragAdjustNumbers', false);
      drag(25); // 关: 拖动不改值
      await sleep(120);
      const v2 = parseFloat(inp.value);
      // 滚轮调值保留 (关拖动的情形下)
      inp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
      await sleep(120);
      const v3 = parseFloat(inp.value);
      store.setEditorPref('dragAdjustNumbers', true);
      drag(25); // 再开: 恢复
      await sleep(120);
      const v4 = parseFloat(inp.value);
      store.closeConversion();
      return { v0, v1, v2, v3, v4 };
    })()`);
    assert(!r2.err, '2a: 批量复制窗口 DraftNum 就位');
    assert(r2.v1 === r2.v0 + 5, `2b: 开关开 — 拖动 25px 调值 +5 (${r2.v0} -> ${r2.v1})`);
    assert(r2.v2 === r2.v1, `2c: 开关关 — 拖动不改值 (仍 ${r2.v2})`);
    assert(r2.v3 === r2.v1 + 1, `2d: 开关关 — 滚轮调值保留 (${r2.v1} -> ${r2.v3})`);
    assert(r2.v4 === r2.v3 + 5, `2e: 再开 — 拖动恢复 (${r2.v3} -> ${r2.v4})`);

    // ---- 需求3: 物件移动死区 2px/1px ----
    const r3 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      store.load({ ...base,
        timingPoints: [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
        hitObjects: [], editor: { ...base.editor, beatDivisor: 4, bookmarks: [] } }, null);
      store.pause && store.pause();
      store.setGridType('none'); store.gridSnap = false; store.setObjectSnapEnabled(false);
      store.distanceLock = false; store.geoEnabled = false;
      const c = document.querySelector('canvas.cursor-crosshair');
      // 放一个 circle
      store.tool = 'circle';
      const pt = window.__osuToClient(256, 192);
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true }));
      store.tool = 'select';
      const o = store.beatmap.hitObjects[store.beatmap.hitObjects.length - 1];
      if (!o) return { err: 'place failed' };
      store.select([o.id]);
      store.seek(o.time);
      const dragBy = async (dxOsu) => {
        const a = window.__osuToClient(o.x, o.y), b = window.__osuToClient(o.x + dxOsu, o.y);
        c.dispatchEvent(new MouseEvent('mousedown', { clientX: a.x, clientY: a.y, button: 0, bubbles: true, cancelable: true }));
        c.dispatchEvent(new MouseEvent('mousemove', { clientX: b.x, clientY: b.y, button: 0, buttons: 1, bubbles: true, cancelable: true }));
        await sleep(200); // rAF 节流: 帧循环应用
        c.dispatchEvent(new MouseEvent('mouseup', { clientX: b.x, clientY: b.y, button: 0, bubbles: true, cancelable: true }));
        await sleep(80);
      };
      const x0 = o.x;
      await dragBy(1); // 死区开 (2px): 1px 不动
      const x1 = o.x;
      await dragBy(2); // 死区开: 2px 动
      const x2 = o.x;
      store.setEditorPref('moveDeadzone2px', false);
      await dragBy(1); // 死区关: 1px 即动
      const x3 = o.x;
      store.setEditorPref('moveDeadzone2px', true);
      await dragBy(1); // 再开: 1px 又不动
      const x4 = o.x;
      return { x0, x1, x2, x3, x4 };
    })()`);
    assert(!r3.err, '3a: 放置+选中就位');
    assert(r3.x1 === r3.x0, `3b: 死区开 — 1px 不动 (${r3.x0} -> ${r3.x1})`);
    assert(r3.x2 === r3.x0 + 2, `3c: 死区开 — 2px 移动 (${r3.x0} -> ${r3.x2})`);
    assert(r3.x3 === r3.x2 + 1, `3d: 死区关 — 1px 即移动 (${r3.x2} -> ${r3.x3})`);
    assert(r3.x4 === r3.x3, `3e: 再开 — 1px 又不动 (仍 ${r3.x4})`);

    // ---- 需求4: hover 滑条锚点显示位置信息 ----
    const r4 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const base = store.beatmap;
      store.load({ ...base,
        timingPoints: [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
        hitObjects: [{ id: 9201, type: 'slider', x: 100, y: 100, time: 3000, newCombo: true, comboSkip: 0, hitSound: 0,
          curveType: 'L', curvePoints: [{ x: 200, y: 100 }], slides: 1, length: 100 }],
        editor: { ...base.editor, beatDivisor: 4, bookmarks: [] } }, null);
      store.pause && store.pause();
      store.tool = 'select';
      store.select([9201]);
      store.seek(3000);
      await sleep(200);
      const c = document.querySelector('canvas.cursor-crosshair');
      const panelText = () => {
        const p = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('w-40') && d.className.includes('font-mono'));
        return p ? p.textContent : '';
      };
      // 悬停在未命中处 (空白) — 不显示 hover 锚点
      let p = window.__osuToClient(400, 300);
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: p.x, clientY: p.y, bubbles: true }));
      await sleep(200);
      const blank = panelText();
      // 悬停选中滑条的锚点 (200,100) — 显示位置
      p = window.__osuToClient(200, 100);
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: p.x, clientY: p.y, bubbles: true }));
      await sleep(200);
      const hover = panelText();
      const hoverNode = store.hoverNode;
      // 移走 — hover 信息消失
      p = window.__osuToClient(400, 300);
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: p.x, clientY: p.y, bubbles: true }));
      await sleep(200);
      const cleared = panelText();
      return { blank, hover, hoverNode, cleared };
    })()`);
    assert(!/Slider Point #/.test(r4.blank), `4a: 空白处不显示锚点信息 ("${r4.blank}")`);
    assert(r4.hoverNode && r4.hoverNode.objId === 9201 && r4.hoverNode.idx === 1, `4b: hoverNode 上报 (实得 ${JSON.stringify(r4.hoverNode)})`);
    assert(/Slider Point #1\/1/.test(r4.hover) && /x:200 y:100/.test(r4.hover),
      `4c: hover 锚点显示序号+坐标 ("${r4.hover}")`);
    assert(!/Slider Point #/.test(r4.cleared), `4d: 移走后消失 ("${r4.cleared}")`);

    // ---- 需求5: 枚举下拉框滚轮循环 (网格类型: square/triangle/circle/none) ----
    const r5 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sel = document.querySelector('select[data-grid-input="type"]');
      if (!sel) return { err: 'grid type select not found' };
      store.setGridType('square');
      await new Promise(r => setTimeout(r, 150)); // 等 React 重渲染同步受控值, 否则首个滚轮读到旧 selectedIndex
      const seq = [store.gridType];
      const wheel = (dy) => { sel.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true })); seq.push(store.gridType); };
      wheel(120);  // square -> triangle
      wheel(120);  // -> circle
      wheel(120);  // -> none
      wheel(120);  // -> square (末尾循环回开头)
      wheel(-120); // square -> none (反向循环到末尾)
      wheel(-120); // -> circle
      return { seq };
    })()`);
    assert(!r5.err, '5a: 网格类型下拉就位');
    assert(JSON.stringify(r5.seq) === JSON.stringify(['square', 'triangle', 'circle', 'none', 'square', 'none', 'circle']),
      `5b: 滚轮逐项切换且首尾循环 (实得 ${JSON.stringify(r5.seq)})`);

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile); // v383: 杀进程 + 回收临时 profile
  }
}

section('改动文件无 CRLF');
{
  for (const f of ['src/osu/editorPrefs.ts', 'src/osu/selectWheel.ts', 'src/osu/displaySettings.ts', 'src/osu/store.ts',
    'src/components/DisplayPanel.tsx', 'src/components/HotkeyPanel.tsx', 'src/components/DraggableDialog.tsx',
    'src/components/EditorCanvas.tsx', 'src/components/Timelines.tsx', 'src/App.tsx',
    'src/i18n/dicts/zh-CN/display.ts', 'src/i18n/dicts/zh-CN/hotkey.ts', 'src/i18n/dicts/zh-CN/timeline.ts',
    'verifier/v381/check.mjs', 'verifier/v316/check.mjs', 'verifier/v368/check.mjs'])
    assert(!read(f).includes('\r'), `${f} 无 CRLF`);
}

console.log(failures ? `\nVERIFIER_V381_FAILED: ${failures} 处失败` : '\nVERIFIER_V381_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
