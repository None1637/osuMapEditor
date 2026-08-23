// v109 源码接线断言: 左侧栏层级 (上时间轴下/下时间轴上) + 宽度与右栏一致 + 「网格中心」文案
// 运行: node verifier/v109/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const app = read('src/App.tsx');
const iSide = app.indexOf('{/* 左侧栏 */}');

// 层级: 页签栏/上时间轴在侧栏之前, 下时间轴在主区域行之后
assert(app.indexOf('页签栏') > 0 && app.indexOf('页签栏') < iSide, '页签栏在左侧栏之上');
assert(app.indexOf('<TopTimeline />') > 0 && app.indexOf('<TopTimeline />') < iSide, '上时间轴在左侧栏之上');
const iMainEnd = app.indexOf('{/* /主区域行');
assert(iMainEnd > iSide && app.indexOf('<BottomTimeline />') > iMainEnd, '下时间轴在主区域行(含左侧栏)之后');

// 宽度与右侧栏一致 (均 w-56)
assert(/w-56 shrink-0 bg-\[#16161d\]\/75 border-r border-white\/10/.test(app), '左侧栏 w-56');
assert(/w-56 shrink-0 bg-\[#16161d\]\/75 border-l border-white\/10/.test(app), '右侧 Inspector 栏 w-56 (同宽)');
assert(!/w-44 shrink-0 bg-\[#16161d\]/.test(app), '旧 w-44 侧栏已移除');

// setup/timing 页包 flex-1 容器 (侧栏始终显示, 页面填满剩余宽)
assert(/<div className="flex-1 min-w-0 overflow-auto flex flex-col pointer-events-auto"><SetupPage \/><\/div>/.test(app), 'setup 页 flex-1 包裹');
assert(/<div className="flex-1 min-w-0 overflow-auto flex flex-col pointer-events-auto"><TimingPage \/><\/div>/.test(app), 'timing 页 flex-1 包裹');

// 「◎ 中心」→「◎ 网格中心」→ v181: lucide Crosshair
assert(/Crosshair className[^>]*\/>网格中心/.test(app), '按钮文案 = 网格中心 (v181: ◎ → lucide Crosshair)');
assert(!/◎/.test(app), '旧「◎」符号已移除');

console.log(failures ? `\nV109_CHECK_FAILED: ${failures}` : '\nV109_CHECK_PASSED');
process.exit(failures ? 1 : 0);
