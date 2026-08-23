// 验证器 v156: 原生顶层 Timing 菜单 (仿 osu!stable) + store timing 操作 + 节拍器
// 运行: node verifier/v156/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v156/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v156/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V156_TESTS_*)
fs.unlinkSync(out);

section('store.ts: timing 菜单对应方法全部真实接线 (无死菜单项)');
{
  const src = readSrc('src/osu/store.ts');
  for (const m of ['timingAddPoint', 'timingSetMeter', 'timingMeterAtCurrent', 'timingResetCurrent',
    'timingDeleteCurrent', 'timingResnap', 'timingShiftAll', 'timingRecalcSliders', 'timingDeleteAll', 'timingSetPreview']) {
    assert(new RegExp(`${m}\\(`).test(src), `store.${m} 存在`);
  }
  assert(/resnapSliderLength/.test(src.slice(src.indexOf('timingRecalcSliders'), src.indexOf('timingRecalcSliders') + 500)), '重算滑条长度走 resnapSliderLength');
  assert(/snapTimeToRedBeat/.test(src), '重新对齐用 snapTimeToRedBeat');
}

section('store.ts: 节拍器');
{
  const src = readSrc('src/osu/store.ts');
  assert(/metronome\s*[:=]/.test(src), 'metronome 状态字段');
  assert(/toggleMetronome\(\)/.test(src), 'toggleMetronome');
  assert(/tickMetronome\(\)/.test(src), 'tickMetronome (播放中逐帧触发)');
  assert(/metronomeBeats\(/.test(src), '拍点表来自 metronomeBeats');
  assert(/resyncMetro/.test(src), 'resyncMetro 随播放进度重同步');
}

section('electron 三件套: bridge / preload / main 菜单');
{
  const bridge = readSrc('src/osu/electronBridge.ts');
  for (const t of ['timing-set-meter', 'timing-toggle-metronome', 'timing-add-red', 'timing-add-green',
    'timing-reset-current', 'timing-delete-current', 'timing-resnap-current', 'timing-resnap-all',
    'timing-open-settings', 'timing-shift-all', 'timing-recalc-sliders', 'timing-delete-all', 'timing-set-preview']) {
    assert(bridge.includes(`type: '${t}'`), `bridge 命令 ${t}`);
  }
  assert(/menuTimingState/.test(bridge), 'bridge 暴露 menuTimingState');

  const preload = readSrc('electron/preload.cjs');
  assert(/menuTimingState/.test(preload) && preload.includes('"timing-menu-state"'), 'preload 转发 timing-menu-state');

  const main = readSrc('electron/main.cjs');
  assert(main.includes('ipcMain.on("timing-menu-state"'), '主进程接收勾选状态');
  assert(/节拍类型/.test(main) && /type:\s*"radio"/.test(main), '节拍类型 radio 子菜单');
  assert(/label:\s*"节拍器",\s*type:\s*"checkbox"/.test(main), '节拍器 checkbox');
  assert(/添加Timing区间.*accelerator:\s*"CmdOrCtrl\+P"/.test(main), '添加红线 Ctrl+P');
  assert(/accelerator:\s*"CmdOrCtrl\+Shift\+P"/.test(main), '添加绿线 Ctrl+Shift+P');
  assert(/accelerator:\s*"CmdOrCtrl\+I"/.test(main), '删除Timing区间 Ctrl+I');
  assert(/Timing设置\.\.\..*accelerator:\s*"F6"/.test(main), 'Timing设置 F6');
  for (const label of ['重置当前区间', '重新对齐当前Timing区间', '全部重新对齐', '整体平移所有物件的时间', '重新计算滑条长度', '删除所有Timing区间', '把当前位置设为预览点']) {
    assert(main.includes(label), `菜单项「${label}」`);
  }
}

section('渲染端路由: electronMenu.ts + App.tsx');
{
  const menu = readSrc('src/osu/electronMenu.ts');
  assert(/case 'timing-add-red': store\.timingAddPoint\(true\)/.test(menu), 'timing-add-red → timingAddPoint(true)');
  assert(/case 'timing-toggle-metronome': store\.toggleMetronome\(\)/.test(menu), 'toggle-metronome 路由');
  assert(/case 'timing-resnap-all': store\.timingResnap\('all'\)/.test(menu), 'resnap-all 路由');

  const app = readSrc('src/App.tsx');
  assert(/function ShiftAllDialog/.test(app) && app.indexOf('function ShiftAllDialog') < app.indexOf('export default function App'), 'ShiftAllDialog 为模块级组件 (在 App 之前, 避免重挂载吞点击)');
  assert(/cmd\.type === 'timing-open-settings'\) \{\s*setTab\('timing'\)/.test(app), 'Timing设置 → 跳 timing 页签');
  assert(/cmd\.type === 'timing-shift-all'\) \{\s*setShowShiftAll\(true\)/.test(app), '整体平移 → 弹窗');
  assert(/api\.menuTimingState\(\{ meter: store\.timingMeterAtCurrent\(\), metronome: store\.metronome \}\)/.test(app), '勾选状态上报主进程');
  assert(/store\.timingShiftAll\(/.test(app), '弹窗确认调 timingShiftAll');
}

console.log(failures ? `\nV156 FAILED: ${failures}` : '\nV156 ALL PASSED');
process.exit(failures ? 1 : 0);
