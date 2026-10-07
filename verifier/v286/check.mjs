// 验证器 v286: 快捷键设置页面 + 自定义改键
// 依据: 页签栏「显示设置」左侧新增「快捷键」按钮 → HotkeyPanel (DraggableDialog),
//   按分类列出 HOTKEY_ACTIONS 全部动作, 点击键位进入捕获态按新组合改键 (Esc 取消,
//   冲突红字提示不改), 覆盖持久化 localStorage 'osu-editor:hotkeys', 「全部恢复默认」;
//   App.tsx keydown 改为注册表派发 (findHotkeyAction), 捕获期间 (hotkeyCaptureActive) 不派发;
//   Electron: menuId 动作经 preload setAcceleratorOverrides → main.cjs acc() 同步原生菜单
//   accelerator (save/timing 4 项真注册改键, 编辑/作图菜单 registerAccelerator:false 仅同步显示)。
// 行为变化 (相对旧硬编码): Ctrl+1 等带修饰组合不再误触工具切换; 改键替换该动作全部默认键。
// 运行: node verifier/v286/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v286/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v286/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V286_TESTS_*)
fs.unlinkSync(out);

const hk = readSrc('src/osu/hotkeys.ts');
assert(/export const HOTKEY_ACTIONS/.test(hk), 'hotkeys.ts: 动作注册表');
assert(/export function findHotkeyAction/.test(hk), 'hotkeys.ts: 注册表派发匹配');
assert(/localStorage\.setItem\(LS_KEY/.test(hk), 'hotkeys.ts: 覆盖持久化 localStorage');
assert(/setAcceleratorOverrides/.test(hk), 'hotkeys.ts: 推送菜单 accelerator 覆盖');

const app = readSrc('src/App.tsx');
assert(/findHotkeyAction\(e\)/.test(app), 'App.tsx: keydown 注册表派发');
assert(/hotkeyCaptureActive\(\)\) return/.test(app), 'App.tsx: 改键捕获中不派发');
assert(/data-hotkey-panel-btn/.test(app), 'App.tsx: 页签栏快捷键按钮');
assert(/\{store\.hotkeyPanelOpen && <HotkeyPanel \/\>\}/.test(app), 'App.tsx: 挂载 HotkeyPanel');

const panel = readSrc('src/components/HotkeyPanel.tsx');
assert(/testid="hotkey-panel"/.test(panel), 'HotkeyPanel: 对话框');
assert(/t\('hotkey\.capture_hint', 'Press any key \/ mouse button \/ wheel… Esc to cancel'\)/.test(panel)
  && readSrc('src/i18n/dicts/zh-CN/hotkey.ts').includes("'hotkey.capture_hint': '按任意键/鼠标键/滚轮… Esc取消'"),
  'HotkeyPanel: 捕获态提示 (v289: 含鼠标键; v330: 含滚轮; v346: i18n key hotkey.capture_hint + zh-CN 译文)');
assert(/findConflict\(combo, capture\.id\)/.test(panel), 'HotkeyPanel: 冲突检测');
assert(/resetAllHotkeys/.test(panel), 'HotkeyPanel: 全部恢复默认');
assert(/setHotkeyCapture\(true\)/.test(panel), 'HotkeyPanel: 捕获期屏蔽全局派发');

const store = readSrc('src/osu/store.ts');
assert(/hotkeyPanelOpen = false/.test(store) && /setHotkeyPanelOpen/.test(store), 'store: 面板开关');

const main = readSrc('electron/main.cjs');
assert(/menu-accelerator-overrides/.test(main), 'main.cjs: 接收 accelerator 覆盖');
assert(/acc\("save"/.test(main) && /acc\("timing-open-settings"/.test(main), 'main.cjs: save/timing 注册项走 acc()');
assert(/acc\(type, accelerator\)/.test(main), 'main.cjs: 编辑/作图菜单显示同步');

const preload = readSrc('electron/preload.cjs');
assert(/setAcceleratorOverrides/.test(preload), 'preload: setAcceleratorOverrides');
assert(/setAcceleratorOverrides\(map/.test(readSrc('src/osu/electronBridge.ts')), 'electronBridge: API 类型');

if (failures) { console.error(`\nV286_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV286_ALL_PASSED');
