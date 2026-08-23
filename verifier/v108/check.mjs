// v108 源码接线断言: 工具栏「曲库→重做」控件移入新增左侧栏 (略放大 + 功能组分隔线)
// 运行: node verifier/v108/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const app = read('src/App.tsx');
// v127 适配: 顶部工具栏 (h-12 标题行「osu! 谱面编辑器」) 已删除 — 无实际功能; 页签栏成为最顶行
const iTb = app.indexOf('顶部工具栏');
const iTabs = app.indexOf('页签栏');
const iSide = app.indexOf('{/* 左侧栏 */}');
const iEdit = app.indexOf("{tab === 'edit' ? (");
const sidebar = app.slice(iSide, iEdit);

// v127: 标题行已删 (原 v108「工具栏只留标题」/v111「不在工具栏」断言随删除失去对象)
assert(iTb === -1 && !/osu! 谱面编辑器/.test(app), 'v127: 顶部标题行 (顶部工具栏/osu! 谱面编辑器) 已删除');

// 布局骨架: 页签栏 → 上时间轴 → 主区域行(左侧栏 + 内容) → 下时间轴 (v109 适配: 侧栏移入主区域行; v127: 工具栏行删除)
assert(iSide > 0 && iEdit > iSide, '结构顺序: 左侧栏 → 页签内容');
assert(/flex-1 flex min-h-0/.test(app), '主区域 = 横向 flex 行 (左栏 + 内容)');
assert(/w-56 shrink-0 bg-\[#16161d\]\/75 border-r border-white\/10 overflow-y-auto flex flex-col/.test(app), '左侧栏容器 (v109: w-56 与右栏一致, 纵向滚动)');
assert(app.indexOf('页签栏') < iSide && app.indexOf('<TopTimeline />') < iSide, 'v109: 页签栏/上时间轴在左侧栏之前 (侧栏在上时间轴下方)');
assert(app.indexOf('<BottomTimeline />') > iEdit, 'v109: 下时间轴在主区域行之后 (侧栏在下时间轴上方)');

// 左侧栏: 控件齐全 (data 属性不变, 历史 check/CDP 兼容)
for (const [pat, name] of [
  ['FolderOpen', '曲库'], ['Palette', '皮肤'], // v181: 📁/🎨 → lucide 组件名
  ['data-ds-input="range"', '锁定间距滑条'], ['data-ds-input="number"', '锁定间距数字'],
  ['data-grid-input="type"', '网格类型'], ['<GridSpacingInput', '网格间距 (GridSpacingInput)'], ['data-grid-input="rotation"', '网格旋转'],
  ['data-grid-input="origin-toggle"', '网格中心开关'],
  ['data-geo-input="toggle"', '辅助线开关'], ['data-geo-input="panel-toggle"', '辅助线配置'],
  ['data-pattern-input="panel-toggle"', 'pattern'], ['data-wave-input="toggle"', '波形'],
  ['Undo2', '撤销'], ['Redo2', '重做'], // v181: ↩/↪ → lucide 组件名
]) {
  assert(sidebar.includes(pat), `左侧栏含控件: ${name}`);
}
assert(sidebar.includes('TOOLS.map'), '左侧栏含四工具按钮组');
assert(sidebar.includes('节拍吸附 1/'), '左侧栏含节拍吸附');
assert(sidebar.includes('Crosshair'), 'v109: 网格中心按钮 (v181: ◎ → lucide Crosshair)');

// 控件略放大 (py-1.5 / text-sm)
assert(/w-full text-left px-3 py-1\.5 rounded/.test(sidebar), '侧栏按钮全宽且略放大 (px-3 py-1.5)');
assert(/flex flex-col gap-1\.5 px-2 py-2 text-sm/.test(app), '侧栏整体 text-sm');

// 功能组间分隔线 (文件/工具/节拍/间距/网格/辅助线/pattern+波形/历史 → 7 条)
const seps = (sidebar.match(/h-px bg-white\/15/g) || []).length;
assert(seps >= 7, `功能组分隔线 ≥7 条 (实际 ${seps})`);

// 主区域行闭合 + 右侧 Inspector 同宽
assert(app.includes('{/* /主区域行'), '主区域行在下时间轴前闭合');
assert(/w-56 shrink-0 bg-\[#16161d\]\/75 border-l border-white\/10 overflow-auto/.test(app), '右侧 Inspector 栏 w-56 (左右栏同宽)');

// v127 适配: 原「连带产品修复」波形面板 offsetY 断言随 WaveformPanel 废弃删除
// (面板不再存在; 波形画在 TopTimeline 内, 见 v127)
assert(!fs.existsSync(path.join(root, 'src/components/WaveformPanel.tsx')), 'v127: WaveformPanel.tsx 已删除');

console.log(failures ? `\nV108_CHECK_FAILED: ${failures}` : '\nV108_CHECK_PASSED');
process.exit(failures ? 1 : 0);
