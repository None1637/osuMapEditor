// 验证器 v321: F18c/F21/F23/F25/F26 五合一杂项批
//   F25: 网格类型 (gridType) 持久化 — 并入 grid-settings, App.tsx 走 setGridType
//   F26: Shift+数字1-8 直接设节拍细分 (先于 findHotkeyAction 拦截); 游玩区 Ctrl+滚轮循环细分;
//        上方时间轴 Alt+滚轮调锁定间距倍率 (仅上时间轴; 下时间轴/游玩区不变)
//   F18c: 快捷键面板新增「固定键位」静态分区 (Alt/Ctrl/中键等不可改键组合)
//   F21: hotkeyLabel(id) 取当前生效绑定展示名; 左栏工具/撤销重做 title/放置态指示/右栏提示块/
//        Inspector/TimingPanel 全部动态化; 改键后 store.emit() 触发重渲染
//   F23: MenuBar 13→15px (快捷键 11→13px); SetupPage/TimingPanel xs→sm (标题 sm→base)
// 运行: node verifier/v321/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const store = readSrc('src/osu/store.ts');
const app = readSrc('src/App.tsx');
const canvas = readSrc('src/components/EditorCanvas.tsx');
const timelines = readSrc('src/components/Timelines.tsx');
const hotkeys = readSrc('src/osu/hotkeys.ts');
const hkPanel = readSrc('src/components/HotkeyPanel.tsx');
const inspector = readSrc('src/components/Inspector.tsx');
const timingPanel = readSrc('src/components/TimingPanel.tsx');
const setupPage = readSrc('src/components/SetupPage.tsx');
const menuBar = readSrc('src/components/MenuBar.tsx');
// v346: UI 文本走 i18n — 断言源码 i18n key + zh-CN 词典译文, 语言无关
const zhHotkey = readSrc('src/i18n/dicts/zh-CN/hotkey.ts');
const zhApp = readSrc('src/i18n/dicts/zh-CN/app.ts');
const zhInspector = readSrc('src/i18n/dicts/zh-CN/inspector.ts');

section('F25: 网格类型持久化');
{
  assert(/GridSettingsPersist \{ rotation: number; origin: Pt; custom: boolean; type\?:/.test(store), 'GridSettingsPersist 含 type');
  assert(/p\.type === 'triangle' \|\| p\.type === 'circle' \|\| p\.type === 'none'/.test(store), 'loadGridSettings 读 type (非法值回 square)');
  assert(/custom: store\.gridOriginCustom, type: store\.gridType/.test(store), 'saveGridSettings 写 type');
  assert(/gridType: 'square' \| 'triangle' \| 'circle' \| 'none' = persistedGrid\.type \?\? 'square'/.test(store), 'gridType 初始值取持久化');
  assert(/setGridType\(t: 'square'/.test(store) && /saveGridSettings\(\); this\.emit\(\); \}/.test(store), 'setGridType setter 持久化+emit');
  assert(/store\.setGridType\(e\.target\.value as/.test(app), 'App.tsx 下拉走 setGridType');
  assert(!/onChange=\{e => \{\s*store\.gridType = e\.target\.value/.test(app), 'App.tsx 不再直接赋值 gridType');
}

section('F26: 吸附快捷键');
{
  const shiftIdx = app.indexOf("/^Digit[1-8]$/.test(e.code)");
  const findIdx = app.indexOf('const id = findHotkeyAction(e);');
  assert(shiftIdx > 0 && findIdx > 0 && shiftIdx < findIdx, 'Shift+数字拦截先于 findHotkeyAction (防 Shift 松弛误判 tool-select)');
  assert(/BEAT_SNAP_OPTIONS\[parseInt\(e\.code\.slice\(5\)\) - 1\]/.test(app), 'Shift+Digit1-8 映射 BEAT_SNAP_OPTIONS');
  const wheel = canvas.match(/onWheel=\{\(e\) => \{[\s\S]{0,2000}?\n      \}\}/);
  assert(!!wheel, 'EditorCanvas onWheel 存在');
  assert(!!wheel && /if \(e\.ctrlKey\) \{[\s\S]{0,400}?cur \* 2 : cur \/ 2/.test(wheel[0]), '游玩区 Ctrl+滚轮节拍细分 ×2/÷2 (v334 stable 语义)');
  // v330: Alt 分支改绑定匹配 (matchesHotkeyWheel), Ctrl 分支仍最先
  assert(!!wheel && wheel[0].indexOf('e.ctrlKey') > 0 && wheel[0].indexOf('e.ctrlKey') < wheel[0].indexOf('matchesHotkeyWheel'), 'Ctrl 分支先于滚轮绑定分支');
  const topWheel = timelines.match(/onWheel=\{\(e\) => \{\s*const bm = store\.beatmap;[\s\S]{0,1500}?\}\} \/>/);
  assert(!!topWheel && /if \(matchesHotkeyWheel\(e, 'distance-lock-wheel'\)\) \{[\s\S]{0,400}?setEditorField\('distanceSpacing', Math\.max\(0\.1, Math\.min\(10,/.test(topWheel[0]), '上时间轴滚轮调锁定间距 (v330: 可改键, 默认 Alt+滚轮; 钳 0.1..10; v345 经 setEditorField)');
  assert(!!topWheel && topWheel[0].indexOf('distance-lock-wheel') < topWheel[0].indexOf('e.ctrlKey'), '锁定间距分支优先于 Ctrl 缩放');
  const altCount = (timelines.match(/e\.altKey/g) || []).length;
  assert(altCount === 0, `时间轴不再直读 e.altKey (v330 改绑定匹配; 实际 ${altCount} 次)`);
}

section('F18c: 固定键位分区');
{
  assert(/data-testid="hotkey-fixed-section"/.test(hkPanel), '固定键位分区存在');
  assert(/t\('hotkey\.fixed\.title', 'Fixed Bindings \(Not Customizable\)'\)/.test(hkPanel) && /'hotkey\.fixed\.title': '固定键位 \(不可修改\)'/.test(zhHotkey), '分区标题');
  assert(/t\('hotkey\.fixed\.alt_click_anchor', 'Alt\+Click — Select\/Deselect Slider Anchors'\)/.test(hkPanel) && /'hotkey\.fixed\.alt_click_anchor': 'Alt\+点击 — 选中\/取消滑条锚点'/.test(zhHotkey), 'Alt+点击 条目');
  // v330: 中键平移/Alt+滚轮移入可改键列表 (游玩区分类), 固定区不再列
  assert(!/中键拖动 — 平移游玩区/.test(hkPanel), '中键拖动移出固定区 (v330 可改键)');
  assert(!/Alt\+滚轮 — 缩放游玩区/.test(hkPanel), 'Alt+滚轮移出固定区 (v330 可改键)');
  assert(/t\('hotkey\.fixed\.shift_number_snap', 'Shift\+1-8 — Set Beat Snap Divisor'\)/.test(hkPanel) && /'hotkey\.fixed\.shift_number_snap': 'Shift\+数字1-8 — 设节拍细分'/.test(zhHotkey), 'Shift+数字 条目 (F26 联动)');
  assert(/t\('hotkey\.fixed\.ctrl_wheel', 'Ctrl\+Wheel — Cycle Beat Snap Divisor \(Playfield\) \/ Zoom \(Timeline\)'\)/.test(hkPanel) && /'hotkey\.fixed\.ctrl_wheel': 'Ctrl\+滚轮 — 游玩区循环节拍细分 \/ 时间轴上缩放'/.test(zhHotkey), 'Ctrl+滚轮 条目 (F26 联动)');
  assert(hkPanel.indexOf('hotkey-fixed-section') > hkPanel.indexOf('hotkey-list'), '分区在可改键列表之后');
}

section('F21: 快捷键提示动态化');
{
  assert(/export function hotkeyLabel\(id: string\): string/.test(hotkeys), 'hotkeyLabel 导出');
  assert(/hotkeyLabel\(tool\.action\)/.test(app), '左栏工具键位动态');
  assert(/title=\{hotkeyLabel\('undo'\)\}/.test(app) && /title=\{hotkeyLabel\('redo'\)\}/.test(app), '撤销/重做 title 动态');
  assert(/NC\(\{hotkeyLabel\('hs-newcombo'\)\}\)/.test(app), '放置态 NC 指示动态');
  assert(!/>空格 播放\/暂停</.test(app) && !/Ctrl\+C\/V 复制\/粘贴/.test(app) && !/Q\/W\/E\/R 新Combo/.test(app), '右栏提示块无旧硬编码');
  assert(/\{hotkeyLabel\('play-pause'\)\} \{t\('app\.hk_play_pause', 'play\/pause'\)\}/.test(app) && /'app\.hk_play_pause': '播放\/暂停'/.test(zhApp)
    && /\{hotkeyLabel\('reverse'\)\} \{t\('app\.hk_reverse',/.test(app) && /'app\.hk_reverse': '反转选区/.test(zhApp), '右栏提示块动态化');
  assert(!/水平 \(Ctrl\+H\)/.test(inspector) && /hotkeyLabel\('flip-h'\)/.test(inspector), 'Inspector 镜像按钮动态');
  assert(!/多边形生成 \(Ctrl\+Shift\+D\)/.test(inspector) && /t\('inspector\.polygon_generate', 'Polygon Generator \(\{key\}\)', \{ key: hotkeyLabel\('polygon'\) \}\)/.test(inspector)
    && /'inspector\.polygon_generate': '多边形生成 \(\{key\}\)'/.test(zhInspector), 'Inspector 多边形按钮动态');
  assert(!/支持 Ctrl\+Z 撤销, 并通过 Ctrl\+S 保存/.test(timingPanel) && /hotkeyLabel\('undo'\)/.test(timingPanel), 'TimingPanel 说明动态');
  const settle = hkPanel.match(/setHotkeyOverride\(capture, combo\);[\s\S]{0,300}?store\.emit\(\)/);
  assert(!!settle, '改键 settle 后 store.emit() (订阅组件重渲染)');
  assert((hkPanel.match(/store\.emit\(\); \/\/ v321 \(F21\)/g) || []).length >= 2, '单键重置也 emit');
}

section('F23: 字体放大');
{
  assert((menuBar.match(/text-\[15px\]/g) || []).length === 3 && (menuBar.match(/text-\[13px\]/g) || []).length === 1, 'MenuBar 菜单文本 13→15px (3 处; 仅快捷键列保留 13px)');
  assert(/ml-6 text-white\/40 text-\[13px\]/.test(menuBar), 'MenuBar 快捷键 11→13px');
  assert(!/text-xs text-white\/70/.test(setupPage) && (setupPage.match(/text-sm text-white\/70/g) || []).length === 3, 'SetupPage 标签 xs→sm (3 处)');
  assert(/font-bold text-pink-300 text-base/.test(setupPage), 'SetupPage 节标题 sm→base');
  assert(/bg-\[#16161d\] text-sm text-white\/80/.test(timingPanel), 'TimingPanel 表格容器 xs→sm');
  assert(/p-4 text-sm text-white\/50/.test(timingPanel) && /text-white\/70 text-base/.test(timingPanel), 'TimingPanel 说明栏 xs→sm / 标题 sm→base');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv321 全部通过');
process.exit(failures ? 1 : 0);
