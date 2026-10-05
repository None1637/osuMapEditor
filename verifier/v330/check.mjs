// 验证器 v330: 游玩区相关快捷键可改键 + Alt+滚轮行为随平移开关切换
//   需求 1: 没开游玩区平移时 Alt+滚轮 = 改锁定间距; 开了平移时 Alt+滚轮 = 游玩区缩放。
//   需求 2: 游玩区相关快捷键 (平移拖拽/缩放滚轮/锁定间距滚轮) 支持在快捷键绑定中调整。
// 实现:
//   hotkeys.ts — 滚轮组合 "Alt+Wheel" (comboFromWheelEvent/isWheelCombo/matchesHotkeyWheel,
//     方向不入键); 新动作 playfield-pan-drag(MouseMiddle)/playfield-zoom-wheel(Alt+Wheel)/
//     distance-lock-wheel(Alt+Wheel) 分类「游玩区」; conflictOk 语境互斥豁免; 菜单同步跳过滚轮;
//   EditorCanvas — 平移拖拽/缩放滚轮/锁定间距滚轮全部走绑定匹配, 缩放/锁定间距按平移开关分流;
//   Timelines — 上时间轴 Alt+滚轮锁定间距改绑定匹配;
//   HotkeyPanel — 捕获态支持滚轮 (wheel 监听 passive:false), 固定键位区移除已可改键条目。
// 运行: node verifier/v330/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const hk = readSrc('src/osu/hotkeys.ts');
const ec = readSrc('src/components/EditorCanvas.tsx');
const tl = readSrc('src/components/Timelines.tsx');
const panel = readSrc('src/components/HotkeyPanel.tsx');
const zhHotkey = readSrc('src/i18n/dicts/zh-CN/hotkey.ts'); // v346: UI 文本走 i18n, 断言 key + 词典译文

section('hotkeys.ts: 滚轮组合支持');
{
  assert(/export function comboFromWheelEvent/.test(hk) && /\+ 'Wheel'/.test(hk), 'comboFromWheelEvent (修饰+Wheel)');
  assert(/export function isWheelCombo/.test(hk), 'isWheelCombo');
  assert(/export function matchesHotkeyWheel/.test(hk), 'matchesHotkeyWheel');
  assert(/isMouseCombo\(b\) \|\| isWheelCombo\(b\)/.test(hk), '菜单 accelerator 同步跳过鼠标+滚轮');
  assert(/Wheel: tNow\('hotkey\.key\.wheel', 'Wheel'\)/.test(hk) && /'hotkey\.key\.wheel': '滚轮'/.test(zhHotkey), 'formatCombo 滚轮展示名');
}

section('hotkeys.ts: 游玩区三个新动作 + 语境互斥豁免');
{
  assert(/\{ id: 'playfield-pan-drag'[\s\S]{0,120}defaults: \['MouseMiddle'\]/.test(hk), '平移拖拽 (默认 MouseMiddle)');
  assert(/\{ id: 'playfield-zoom-wheel'[\s\S]{0,160}defaults: \['Alt\+Wheel'\], conflictOk: \['distance-lock-wheel'\]/.test(hk), '缩放滚轮 (默认 Alt+Wheel, 豁免锁定间距)');
  assert(/\{ id: 'distance-lock-wheel'[\s\S]{0,160}defaults: \['Alt\+Wheel'\], conflictOk: \['playfield-zoom-wheel'\]/.test(hk), '锁定间距滚轮 (默认 Alt+Wheel, 豁免缩放)');
  assert(/conflictOk\?: string\[\]/.test(hk) && /if \(a\.conflictOk\?\.includes\(excludeId\)\) continue;/.test(hk), 'findConflict 豁免逻辑');
}

section('EditorCanvas: 绑定匹配 + 平移开关分流');
{
  assert(/matchesHotkeyMouse\(e, 'playfield-pan-drag'\) && store\.playfieldPanEnabled/.test(ec), '平移拖拽 = 绑定匹配 + 开平移');
  const wheel = ec.match(/onWheel=\{\(e\) => \{[\s\S]{0,2600}?\n      \}\}/);
  assert(!!wheel, 'onWheel 存在');
  assert(!!wheel && /if \(store\.playfieldPanEnabled && matchesHotkeyWheel\(e, 'playfield-zoom-wheel'\)\)/.test(wheel[0]), '开平移 → 缩放滚轮');
  assert(!!wheel && /if \(!store\.playfieldPanEnabled && bm && matchesHotkeyWheel\(e, 'distance-lock-wheel'\)\)/.test(wheel[0]), '未开平移 → 锁定间距滚轮');
  assert(!!wheel && wheel[0].indexOf('if (store.playfieldPanEnabled &&') < wheel[0].indexOf('if (!store.playfieldPanEnabled &&'), '缩放分支先于锁定间距分支');
  assert(!!wheel && /setEditorField\('distanceSpacing', Math\.max\(0\.1, Math\.min\(10,/.test(wheel[0]), '锁定间距钳 0.1..10 (v345 经 setEditorField)');
  assert(!/if \(e\.altKey && store\.playfieldPanEnabled\)/.test(ec), '旧硬编码 Alt 分支移除');
}

section('Timelines: 上时间轴锁定间距走绑定');
{
  assert(/if \(matchesHotkeyWheel\(e, 'distance-lock-wheel'\)\)/.test(tl), '上时间轴 distance-lock-wheel 绑定匹配');
}

section('HotkeyPanel: 滚轮捕获 + 固定区更新');
{
  assert(/comboFromWheelEvent/.test(panel), '导入 comboFromWheelEvent');
  assert(/window\.addEventListener\('wheel', onWheel, \{ capture: true, passive: false \}\)/.test(panel), 'wheel 捕获监听 (passive:false)');
  assert(/t\('hotkey\.capture_hint', 'Press any key \/ mouse button \/ wheel…/.test(panel) && /'hotkey\.capture_hint': '按任意键\/鼠标键\/滚轮…/.test(zhHotkey), '捕获提示含滚轮');
  assert(!/中键拖动 — 平移游玩区/.test(panel) && !/Alt\+滚轮 — 缩放游玩区/.test(panel), '固定键位区移除已可改键条目');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv330 全部通过');
process.exit(failures ? 1 : 0);
