// 验证器 v386: 两个 editorPrefs 开关从快捷键设置面板「通用」区挪到菜单栏「设置」菜单
//  背景: v381 加的「数值框拖动调值」(dragAdjustNumbers, 默认开) 与「物件移动死区 2px」
//   (moveDeadzone2px, 默认开) 开关放进了快捷键设置面板顶部通用区, 用户要求挪到菜单栏。
//  改动:
//   - electron/main.cjs: 设置菜单新增两个 checkbox 菜单项 (勾选状态渲染进程经
//     "editor-prefs-state" IPC 上报, editorPrefsState 默认全开); 点击 → menu-cmd
//     { type:'settings-toggle-editor-pref', key } 转发渲染进程; MENU_LABELS 三语标签。
//   - electron/preload.cjs + src/osu/electronBridge.ts: menuEditorPrefsState 通道 +
//     settings-toggle-editor-pref 命令类型。
//   - src/osu/electronMenu.ts: handleMenuCommand 处理翻转 (store.setEditorPref)。
//   - src/App.tsx: 订阅 store 上报 editorPrefs 勾选状态 (值变化才发, 同 timing-menu-state 模式)。
//   - src/components/HotkeyPanel.tsx: 删除通用区 (PREF_ROWS/pref-general-section);
//     src/i18n/dicts/zh-CN/hotkey.ts: 删 pref.* 键 (菜单文案在主进程 MENU_LABELS, zh-TW 同步内嵌)。
//  数据层 (editorPrefs.ts / store.setEditorPref / DraftNum 门控 / 死区阈值) 不变。
// 运行: npm run build 后 node verifier/v386/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { launchIsolatedElectron, killIsolated, normalizeEnv } from '../_lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: 菜单/IPC 链路');
{
  const mc = read('electron/main.cjs');
  assert(/ipcMain\.on\("editor-prefs-state"/.test(mc), '主进程 editor-prefs-state 监听');
  assert(/menu\.drag_adjust_numbers"\), type: "checkbox", checked: editorPrefsState\.dragAdjustNumbers/.test(mc), '设置菜单 checkbox: 拖动调值');
  assert(/menu\.move_deadzone"\), type: "checkbox", checked: editorPrefsState\.moveDeadzone2px/.test(mc), '设置菜单 checkbox: 移动死区');
  assert(/settings-toggle-editor-pref", key: "dragAdjustNumbers"/.test(mc) && /settings-toggle-editor-pref", key: "moveDeadzone2px"/.test(mc), '点击发送 menu-cmd 翻转命令');
  assert(/"menu\.drag_adjust_numbers": \{ en:.*zh-CN.*zh-TW/.test(mc) && /"menu\.move_deadzone": \{ en:.*zh-CN.*zh-TW/.test(mc), 'MENU_LABELS 三语标签');
  const pl = read('electron/preload.cjs');
  assert(/menuEditorPrefsState: \(s\) => ipcRenderer\.send\("editor-prefs-state", s\)/.test(pl), 'preload 桥接 menuEditorPrefsState');
  const eb = read('src/osu/electronBridge.ts');
  assert(/menuEditorPrefsState\(state: ElectronEditorPrefsState\)/.test(eb), 'bridge 类型 menuEditorPrefsState');
  assert(/\{ type: 'settings-toggle-editor-pref'; key: 'dragAdjustNumbers' \| 'moveDeadzone2px' \}/.test(eb), 'bridge 命令类型');
  const em = read('src/osu/electronMenu.ts');
  assert(/case 'settings-toggle-editor-pref': store\.setEditorPref\(cmd\.key, !editorPrefs\[cmd\.key\]\)/.test(em), 'electronMenu 翻转处理');
  const app = read('src/App.tsx');
  assert(/api\.menuEditorPrefsState\(\{ dragAdjustNumbers: editorPrefs\.dragAdjustNumbers, moveDeadzone2px: editorPrefs\.moveDeadzone2px \}\)/.test(app), 'App 勾选状态上报');
}

section('源码: 快捷键面板通用区移除 + i18n 清理');
{
  const hp = read('src/components/HotkeyPanel.tsx');
  assert(!/PREF_ROWS|data-pref-toggle|pref-general-section/.test(hp), 'HotkeyPanel 不再含通用区开关');
  assert(!/from '@\/osu\/editorPrefs'/.test(hp), 'HotkeyPanel 不再 import editorPrefs');
  const dict = read('src/i18n/dicts/zh-CN/hotkey.ts');
  assert(!/'pref\./.test(dict), 'zh-CN 词典 pref.* 键已删');
}

section('CDP: 菜单项存在/勾选同步/点击切换行为实测');
{
  const PORT = 9486;
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
      if (r.result?.exceptionDetails) throw new Error('页面内执行出错: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
      return r.result?.result?.value;
    };
    await normalizeEnv(evalJs);

    // setup: 归一持久化状态 (与 v381 同款补丁: 合成 PointerEvent 无活动指针, setPointerCapture noop)
    await evalJs(`(() => {
      const store = window.__osuStore;
      window.__osuSetLang && window.__osuSetLang('en');
      localStorage.removeItem('osu-editor:hotkeys');
      window.__osuSkin && window.__osuSkin.resetSkinToDefault();
      store.pause && store.pause();
      store.tool = 'select'; store.lockNotes = false;
      store.setEditorPref('dragAdjustNumbers', true);
      store.setEditorPref('moveDeadzone2px', true);
      Element.prototype.setPointerCapture = function () {};
      return true;
    })()`);
    await sleep(800); // 等 editor-prefs-state 上报 + 主进程 buildMenu

    // ---- 1) 设置菜单存在两个 checkbox 项且勾选与 editorPrefs 同步 ----
    const menuItems = async () => evalJs(`(async () => {
      const def = await window.osuEditor.getMenuDefinition();
      const settings = def.find(t => t.label === 'Settings');
      if (!settings || !settings.submenu) return { err: 'no Settings menu', tops: def.map(t => t.label) };
      const drag = settings.submenu.find(i => /Drag to Adjust Number Inputs/.test(i.label || ''));
      const dz = settings.submenu.find(i => /Object Move Deadzone/.test(i.label || ''));
      return { drag, dz };
    })()`);
    const m1 = await menuItems();
    assert(!m1.err, `1a: 设置菜单就位 (${JSON.stringify(m1.tops || '')})`);
    assert(m1.drag && m1.drag.type === 'checkbox' && m1.drag.checked === true, `1b: 「拖动调值」checkbox 存在且默认勾 (${JSON.stringify(m1.drag)})`);
    assert(m1.dz && m1.dz.type === 'checkbox' && m1.dz.checked === true, `1c: 「移动死区」checkbox 存在且默认勾 (${JSON.stringify(m1.dz)})`);

    // store 改值 → 菜单勾选同步 (editor-prefs-state 上行链路)
    await evalJs(`window.__osuStore.setEditorPref('dragAdjustNumbers', false)`);
    let synced = false;
    for (let i = 0; i < 20 && !synced; i++) {
      await sleep(250);
      const m = await menuItems();
      synced = m.drag && m.drag.checked === false;
    }
    assert(synced, '1d: store.setEditorPref(false) 后菜单勾选同步取消');
    await evalJs(`window.__osuStore.setEditorPref('dragAdjustNumbers', true)`);
    await sleep(600);

    // ---- 2) 菜单点击全链路 (menu-item-click → 主进程 → menu-cmd → 翻转 editorPrefs → 勾选重建) ----
    const clickMenuItem = (re) => evalJs(`(() => {
      const top = [...document.querySelectorAll('[data-menu-top]')].find(b => b.textContent === 'Settings');
      if (!top) return 'no top';
      top.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return new Promise(res => setTimeout(() => {
        const btn = [...document.querySelectorAll('[data-menu-item]')].find(b => ${re}.test(b.textContent));
        if (!btn) { res('no item'); return; }
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        res('ok');
      }, 300));
    })()`);
    const waitPref = async (key, want) => {
      for (let i = 0; i < 20; i++) {
        await sleep(250);
        // 勾选状态 = 菜单对 editorPrefs 的镜像; 行为侧另有实测 (3/4 段)
        const m = await menuItems();
        const it = key === 'dragAdjustNumbers' ? m.drag : m.dz;
        if (it && it.checked === want) return true;
      }
      return false;
    };

    const c1 = await clickMenuItem('/Drag to Adjust Number Inputs/');
    assert(c1 === 'ok', `2a: 点击「拖动调值」菜单项 (${c1})`);
    const off1 = await waitPref('dragAdjustNumbers', false);
    assert(off1, '2b: 点击后 editorPrefs 翻转且菜单勾选取消 (menu→渲染→上报闭环)');

    // ---- 3) 关闭后拖动调值行为实测 (DraftNum: 拖动不改值, 滚轮保留) ----
    const r3 = await evalJs(`(async () => {
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
      drag(25); // 开关关: 拖动不改值
      await sleep(120);
      const v1 = parseFloat(inp.value);
      inp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
      await sleep(120);
      const v2 = parseFloat(inp.value);
      store.closeConversion();
      return { v0, v1, v2 };
    })()`);
    assert(!r3.err, '3a: 批量复制窗口 DraftNum 就位');
    assert(r3.v1 === r3.v0, `3b: 菜单关掉拖动调值后 — 拖动 25px 不改值 (仍 ${r3.v1})`);
    assert(r3.v2 === r3.v0 + 1, `3c: 滚轮调值保留 (${r3.v0} -> ${r3.v2})`);

    // 再点开 → 拖动恢复
    const c2 = await clickMenuItem('/Drag to Adjust Number Inputs/');
    assert(c2 === 'ok', `3d: 再次点击「拖动调值」菜单项 (${c2})`);
    const on1 = await waitPref('dragAdjustNumbers', true);
    assert(on1, '3e: 菜单勾选恢复');
    const r3b = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.openConversion('duplicate');
      await sleep(300);
      const inp = document.querySelector('[data-conv="count"]');
      if (!inp) return { err: 'count input not found' };
      const r = inp.getBoundingClientRect();
      const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
      const v0 = parseFloat(inp.value);
      inp.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, clientX: x0, clientY: y0 }));
      inp.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 7, clientX: x0 + 25, clientY: y0 }));
      inp.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 7, clientX: x0 + 25, clientY: y0 }));
      await sleep(120);
      const v1 = parseFloat(inp.value);
      store.closeConversion();
      return { v0, v1 };
    })()`);
    assert(!r3b.err && r3b.v1 === r3b.v0 + 5, `3f: 再开后拖动调值恢复 (${r3b.v0} -> ${r3b.v1})`);

    // ---- 4) 移动死区: 菜单关掉后 1px 即动, 再开 1px 不动 ----
    const c3 = await clickMenuItem('/Object Move Deadzone/');
    assert(c3 === 'ok', `4a: 点击「移动死区」菜单项 (${c3})`);
    const off2 = await waitPref('moveDeadzone2px', false);
    assert(off2, '4b: 点击后菜单勾选取消');
    const r4 = await evalJs(`(async () => {
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
        await sleep(200);
        c.dispatchEvent(new MouseEvent('mouseup', { clientX: b.x, clientY: b.y, button: 0, bubbles: true, cancelable: true }));
        await sleep(80);
      };
      const x0 = o.x;
      await dragBy(1); // 死区关 (1px): 动
      const x1 = o.x;
      return { x0, x1 };
    })()`);
    assert(!r4.err, '4c: 放置+选中就位');
    assert(r4.x1 === r4.x0 + 1, `4d: 菜单关掉死区后 — 1px 即移动 (${r4.x0} -> ${r4.x1})`);

    const c4 = await clickMenuItem('/Object Move Deadzone/');
    assert(c4 === 'ok', `4e: 再次点击「移动死区」菜单项 (${c4})`);
    const on2 = await waitPref('moveDeadzone2px', true);
    assert(on2, '4f: 菜单勾选恢复');
    const r4b = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const o = store.beatmap.hitObjects[store.beatmap.hitObjects.length - 1];
      store.select([o.id]);
      store.seek(o.time);
      const c = document.querySelector('canvas.cursor-crosshair');
      const a = window.__osuToClient(o.x, o.y), b = window.__osuToClient(o.x + 1, o.y);
      const x0 = o.x;
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: a.x, clientY: a.y, button: 0, bubbles: true, cancelable: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: b.x, clientY: b.y, button: 0, buttons: 1, bubbles: true, cancelable: true }));
      await sleep(200);
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: b.x, clientY: b.y, button: 0, bubbles: true, cancelable: true }));
      await sleep(80);
      return { x0, x1: o.x };
    })()`);
    assert(r4b.x1 === r4b.x0, `4g: 再开死区后 — 1px 不动 (仍 ${r4b.x1})`);

    // ---- 5) 快捷键设置面板不再含这两项 ----
    const r5 = await evalJs(`(async () => {
      const store = window.__osuStore;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      store.setHotkeyPanelOpen(true);
      await sleep(400);
      const panel = document.querySelector('[data-dialog="hotkey-panel"]'); // DraggableDialog: testid → data-dialog
      const res = {
        panel: !!panel,
        toggles: document.querySelectorAll('[data-pref-toggle]').length,
        general: !!document.querySelector('[data-testid="pref-general-section"]'),
        text: panel ? panel.textContent.slice(0, 400) : '',
      };
      store.setHotkeyPanelOpen(false);
      return res;
    })()`);
    assert(r5.panel, '5a: 快捷键面板打开');
    assert(r5.toggles === 0 && !r5.general, '5b: 面板内无通用区/偏好开关');
    assert(!/Drag to Adjust Numbers|Move Deadzone/.test(r5.text), '5c: 面板文本不含两项开关名');

    ws.close();
  } catch (e) {
    failures++;
    console.error('  FAIL: CDP 段异常 —', String(e).slice(0, 500));
  } finally {
    await killIsolated(electron, profile);
  }
}

section('改动文件无 CRLF');
{
  for (const f of ['electron/main.cjs', 'electron/preload.cjs', 'src/osu/electronBridge.ts', 'src/osu/electronMenu.ts',
    'src/osu/editorPrefs.ts', 'src/osu/store.ts', 'src/App.tsx', 'src/components/HotkeyPanel.tsx',
    'src/components/EditorCanvas.tsx', 'src/components/DraggableDialog.tsx', 'src/i18n/dicts/zh-CN/hotkey.ts',
    'verifier/v381/check.mjs', 'verifier/v386/check.mjs'])
    assert(!read(f).includes('\r'), `${f} 无 CRLF`);
}

console.log(failures ? `\nVERIFIER_V386_FAILED: ${failures} 处失败` : '\nVERIFIER_V386_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
