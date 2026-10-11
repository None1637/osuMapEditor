// 验证器 v389: 滑条右侧 % 数值点击变输入框 (soulten: 音量窗口最右边 % 数应该可以打数字调整)
//   1) DraggableDialog.tsx 新增共享组件 ClickPct: 平时显示「n%」按钮, 点击变 input[type=number]
//      (autoFocus 全选; 键入实时生效 0..100 取整钳制; Enter/失焦关闭; Esc 恢复编辑前的值);
//      滚轮调值由 v388 全局 numberWheel 覆盖;
//   2) VolumePanel 主/歌曲/音效三行 + DisplayPanel 背景亮度行换用 ClickPct;
//   3) v168 验证器适配 (data-display-value 断言 → ClickPct 接线断言)。
// 运行: node verifier/v389/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('DraggableDialog.tsx: ClickPct 组件');
{
  const src = read('src/components/DraggableDialog.tsx');
  assert(/export function ClickPct\(/.test(src), 'ClickPct 导出');
  assert(/data-pct-display=\{testid\}/.test(src) && /\{value\}%/.test(src), '平时显示 n% (可点击)');
  assert(/data-pct-input=\{testid\}/.test(src) && /type="number"/.test(src) && /autoFocus/.test(src), '点击变 number 输入框 (autoFocus)');
  assert(/Math\.max\(0, Math\.min\(100, Math\.round\(v\)\)\)/.test(src), '0..100 取整钳制');
  assert(/e\.key === 'Escape'\) \{ set\(origRef\.current\)/.test(src), 'Esc 恢复编辑前的值');
  assert(/panels\.pct_click_edit/.test(src), 'tooltip i18n key');
}

section('VolumePanel / DisplayPanel 接线');
{
  const vol = read('src/components/VolumePanel.tsx');
  assert(/<ClickPct value=\{volumeSettings\[r\.key\]\} set=\{v => store\.setVolume\(r\.key, v\)\} testid=\{r\.key\}/.test(vol), '音量三行 ClickPct');
  assert(!/data-volume-value/.test(vol), '旧 data-volume-value 已移除');
  const disp = read('src/components/DisplayPanel.tsx');
  assert(/<ClickPct value=\{displaySettings\.bgBrightness\} set=\{v => store\.setDisplayNumber\('bgBrightness', v\)\} testid="bgBrightness"/.test(disp), '背景亮度 ClickPct');
  assert(!/data-display-value/.test(disp), '旧 data-display-value 已移除');
}

section('i18n + 旧验证器适配');
{
  assert(/'panels\.pct_click_edit': '点击直接输入数值'/.test(read('src/i18n/dicts/zh-CN/panels.ts')), 'zh-CN panels.pct_click_edit');
  assert(/v389 适配/.test(read('verifier/v168/check.mjs')), 'v168 断言已适配并标注');
}

if (failures) { console.error(`V389 FAILED: ${failures}`); process.exit(1); }
console.log('V389 ALL PASSED');
