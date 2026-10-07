// 验证器 v358: 自定义多键绑定 + 上方时间轴 lazer 加性缩放 (stable Alt+滚轮)
// 需求 (soulten):
//   1) 预设可绑两键但自定义只能绑一键 → 覆盖改为组合键数组, 面板支持逐键改绑/+/×删除, 兼容旧单串持久化;
//   2) 物件时间轴缩放 stable 快捷键是 Alt+滚轮 (此前快捷键面板改不了) 且粒度太粗 →
//      新动作 timeline-zoom-wheel (默认 Alt+Wheel + Ctrl+Wheel, 与游玩区两 Alt+Wheel 动作语境互斥),
//      缩放改 lazer ZoomableScrollContainer.AdjustZoomRelatively 同款加性步进 ((max-min)×0.02/刻度),
//      上时间轴 Alt+滚轮不再调锁定间距 (仅游玩区)。
// 运行: npm run build 后 node verifier/v358/check.mjs  (CDP 段会短暂弹出编辑器窗口)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('数据层: 多键绑定');
{
  const out = path.join(root, 'verifier/v358/_bundle.mjs');
  buildSync({ entryPoints: [path.join(root, 'verifier/v358/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
  try { await import('file://' + out); } catch (e) { failures++; console.error('  FAIL: tests.ts 异常 —', String(e).slice(0, 300)); }
  fs.unlinkSync(out);
}

section('源码: hotkeys.ts 数组覆盖');
{
  const hk = read('src/osu/hotkeys.ts');
  assert(/let overrides: Record<string, string\[\]>/.test(hk), '覆盖为组合键数组');
  assert(/typeof v === 'string' && v\) out\[a\.id\] = \[v\]/.test(hk), '兼容读取旧单串格式');
  assert(/Array\.isArray\(combo\) \? combo : \[combo\]/.test(hk), 'setHotkeyOverride 单串/数组兼容');
  assert(/\{ id: 'timeline-zoom-wheel'[\s\S]{0,220}defaults: \['Alt\+Wheel', 'Ctrl\+Wheel'\], conflictOk: \['distance-lock-wheel', 'playfield-zoom-wheel'\]/.test(hk), 'timeline-zoom-wheel 动作 (双默认键 + 互斥豁免)');
  assert(/if \(!b \|\| isMouseCombo\(b\)/.test(hk), 'pushMenuAccels 空绑定守卫');
}

section('源码: HotkeyPanel 逐键改绑/添加/删除');
{
  const panel = read('src/components/HotkeyPanel.tsx');
  assert(/useState<\{ id: string; index: number \| null \} \| null>/.test(panel), 'capture 带绑定下标 (null = 追加)');
  assert(/setCapture\(\{ id: a\.id, index: i \}\)/.test(panel), '点击键位 = 改绑该下标');
  assert(/data-testid=\{`hotkey-add-\$\{a\.id\}`\}/.test(panel) && /setCapture\(\{ id: a\.id, index: null \}\)/.test(panel), '+ 追加绑定');
  assert(/data-testid=\{`hotkey-unbind-\$\{a\.id\}`\}/.test(panel) && /binds\.filter\(\(_, j\) => j !== i\)/.test(panel), '× 删除单个绑定');
  assert(/setHotkeyOverride\(a\.id, next\.length \? next : null\)/.test(panel), '删光恢复默认');
  assert(/setHotkeyOverride\(capture\.id, next\)/.test(panel), '结算写数组覆盖');
}

section('源码: Timelines lazer 加性缩放');
{
  const tl = read('src/components/Timelines.tsx');
  assert(/function adjustTimelineZoom\(units: number\)/.test(tl), 'adjustTimelineZoom helper');
  assert(/z \+ units \* \(TL_ZOOM_MAX - TL_ZOOM_MIN\) \* 0\.02/.test(tl), '加性步进 = (max-min)×0.02 (lazer AdjustZoomRelatively)');
  assert(!/timelineZoom \|\| 1\) \* f/.test(tl) && !/\* 1\.25/.test(tl), '旧 ×1.25 乘性档位移除');
  assert(/matchesHotkeyWheel\(e, 'timeline-zoom-wheel'\)/.test(tl), '滚轮走可改键动作');
  assert(/e\.deltaMode === 1 \? e\.deltaY \/ 3 : e\.deltaY \/ 100/.test(tl), '滚轮量→刻度归一化');
  assert(!/matchesHotkeyWheel\(e, 'distance-lock-wheel'\)/.test(tl), '上时间轴不再调锁定间距 (stable 语义)');
  assert(/onClick=\{\(\) => adjustTimelineZoom\(2\)\}/.test(tl) && /onClick=\{\(\) => adjustTimelineZoom\(-2\)\}/.test(tl), '+/− 按钮走同一步进');
}

section('源码: i18n');
{
  const zh = read('src/i18n/dicts/zh-CN/hotkey.ts');
  assert(/'hotkey\.action\.timeline_zoom_wheel': '缩放上方时间轴 \(滚轮\)'/.test(zh), 'zh-CN: 动作名');
  assert(/'hotkey\.add_binding'/.test(zh) && /'hotkey\.remove_binding'/.test(zh), 'zh-CN: 添加/删除绑定');
  const zhTl = read('src/i18n/dicts/zh-CN/timeline.ts');
  assert(/'timeline\.zoom_in_title': '放大 \(滚轮键位见快捷键设置\)'/.test(zhTl), 'zh-CN: 缩放按钮提示');
}

section('CDP: Alt/Ctrl+滚轮加性缩放 + 多键绑定端到端');
{
  const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const PORT = 9465;
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
    const waitReady = async () => {
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        await sleep(500);
        ready = await evalJs('!!(window.__osuStore && window.__osuStore.beatmap)').catch(() => false);
      }
      if (!ready) throw new Error('应用未就绪');
    };
    await waitReady();

    // -- 上时间轴滚轮缩放 (lazer 加性步进) --
    const zoom = await evalJs(`(() => {
      const store = window.__osuStore;
      const c = document.querySelector('canvas[class*="h-[92px]"]');
      if (!c) return { err: 'no canvas' };
      const z0 = store.beatmap.editor.timelineZoom || 1;
      const step = (8 - 0.25) * 0.02;
      c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, altKey: true, bubbles: true, cancelable: true }));
      const z1 = store.beatmap.editor.timelineZoom || 1;
      c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
      const z2 = store.beatmap.editor.timelineZoom || 1;
      c.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, altKey: true, bubbles: true, cancelable: true }));
      const z3 = store.beatmap.editor.timelineZoom || 1;
      return { z0, z1, z2, z3, step };
    })()`);
    if (zoom.err) throw new Error(zoom.err);
    assert(Math.abs(zoom.z1 - (zoom.z0 + zoom.step)) < 1e-9, `Alt+滚轮上滚 放大 +${zoom.step.toFixed(3)} (${zoom.z0} → ${zoom.z1})`);
    assert(Math.abs(zoom.z2 - (zoom.z1 + zoom.step)) < 1e-9, `Ctrl+滚轮上滚 同样放大 (第二默认键) (${zoom.z1} → ${zoom.z2})`);
    assert(Math.abs(zoom.z3 - (zoom.z2 - zoom.step)) < 1e-9, `Alt+滚轮下滚 缩小 (${zoom.z2} → ${zoom.z3})`);

    // -- 多键绑定端到端: 数组覆盖两个键都触发删除 --
    await evalJs(`localStorage.setItem('osu-editor:hotkeys', JSON.stringify({ delete: ['F9', 'F10'] }))`);
    await evalJs('location.reload()');
    await waitReady();
    const del1 = await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      store.load({ ...base, hitObjects: [
        { id: 958001, type: 'circle', time: 5000, x: 256, y: 192, hitSound: 0, newCombo: false, comboOffset: 0 },
        { id: 958002, type: 'circle', time: 6000, x: 300, y: 192, hitSound: 0, newCombo: false, comboOffset: 0 },
      ] }, store.audioUrl);
      store.tool = 'select';
      store.select([958001]);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true }));
      const afterF9 = store.beatmap.hitObjects.length;
      store.select([958002]);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', bubbles: true, cancelable: true }));
      return { afterF9, afterF10: store.beatmap.hitObjects.length };
    })()`);
    assert(del1.afterF9 === 1, `数组覆盖键 F9 删除 (剩 ${del1.afterF9})`);
    assert(del1.afterF10 === 0, `数组覆盖键 F10 删除 (剩 ${del1.afterF10})`);

    // -- 旧单串持久化兼容 --
    await evalJs(`localStorage.setItem('osu-editor:hotkeys', JSON.stringify({ delete: 'F8' }))`);
    await evalJs('location.reload()');
    await waitReady();
    const del2 = await evalJs(`(() => {
      const store = window.__osuStore;
      const base = store.beatmap;
      store.load({ ...base, hitObjects: [{ id: 958003, type: 'circle', time: 5000, x: 256, y: 192, hitSound: 0, newCombo: false, comboOffset: 0 }] }, store.audioUrl);
      store.tool = 'select';
      store.select([958003]);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true, cancelable: true }));
      return store.beatmap.hitObjects.length;
    })()`);
    assert(del2 === 0, `旧单串格式 F8 仍生效 (剩 ${del2})`);
    await evalJs(`localStorage.removeItem('osu-editor:hotkeys')`);
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

console.log(failures ? `\nVERIFIER_V358_FAILED: ${failures} 处失败` : '\nVERIFIER_V358_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
