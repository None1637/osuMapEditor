// v129 源码接线断言: 游玩区扩大 (上 18px / 下 10px 间隔) + 上下时间轴/左右侧栏半透明浮层
// 运行: node verifier/v129/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const ec = read('src/components/EditorCanvas.tsx');
const app = read('src/App.tsx');
const tl = read('src/components/Timelines.tsx');

// 1. viewTransform: 预留 = 面板行高 + 间隔 (上 93+18=111, 下 82+10=92)
assert(/const PANEL_TOP_H = 93;/.test(ec) && /const PANEL_BOTTOM_H = 82;/.test(ec), '面板行高常量 (上 93 / 下 82)');
assert(/const GAP_TOP = 18, GAP_BOTTOM = 10;/.test(ec), '间隔常量: 上 18px / 下 10px');
assert(/const RESERVED_TOP = PANEL_TOP_H \+ GAP_TOP;/.test(ec) && /const RESERVED_BOTTOM = PANEL_BOTTOM_H \+ GAP_BOTTOM;/.test(ec), '预留 = 行高 + 间隔');
assert(/r\.height - RESERVED_TOP - RESERVED_BOTTOM/.test(ec), '可用高度扣除上下预留 (v270 曾变量化, 用户反馈后还原)');
assert(/oy: RESERVED_TOP \+ \(availH - PH \* scale\) \/ 2/.test(ec), '游玩区垂直位置从预留顶起算 (v270 还原)');

// 2. App: 画布底层 + 浮层列
assert(/\{tab === 'edit' && \(\s*<div className="absolute inset-0 z-0"><EditorCanvas \/><\/div>\s*\)\}/.test(app), 'EditorCanvas 底层 absolute inset-0 z-0 (edit 页签)');
assert(/absolute inset-0 z-10 flex flex-col pointer-events-none/.test(app), '浮层列 z-10 + pointer-events-none (中央空隙点击直达画布)');
assert(!/<EditorCanvas \/>\s*\{store\.tool === 'slider'/.test(app), 'EditorCanvas 不再嵌在主区域行内');

// 3. 各面板 pointer-events-auto + 半透明背景
const peCount = (app.match(/pointer-events-auto/g) || []).length;
assert(peCount >= 5, `面板 pointer-events-auto ≥5 处 (上时间轴/左侧栏/右检查器/页面容器/下时间轴, 实际 ${peCount})`);
assert(/bg-\[#16161d\]\/75 border-r/.test(app), '左侧栏背景半透明 /75');
assert(/bg-\[#16161d\]\/75 border-l/.test(app), '右侧检查器背景半透明 /75');

// 4. 时间轴/信息面板半透明
assert(/displaySettings\.timelineTransparent \? 'rgba\(12,12,17,0\.15\)' : 'rgba\(12,12,17,0\.72\)'/.test(tl), '上时间轴 canvas 半透明底'); // v255 适配: 透明度由显示设置控制, 关 = 原 0.72; v272: 开 0.4→0.15
assert(/displaySettings\.timelineTransparent \? 'rgba\(16,16,24,0\.15\)' : 'rgba\(16,16,24,0\.7\)'/.test(tl), '下时间轴 canvas 半透明底'); // v255 适配: 同上, 关 = 原 0.7; v272: 开 0.4→0.15
assert(/style=\{\{ background: displaySettings\.timelineTransparent \? 'rgba\(21,21,32,0\.1\)' : 'rgba\(21,21,32,0\.7\)' \}\}/.test(tl), '下时间轴容器背景半透明 (v255 适配: 内联样式, 关 = 原 #151520/70; v271/v272 适配: 开 0.4→0.25→0.1)');
assert(/style=\{\{ background: displaySettings\.timelineTransparent \? 'rgba\(12,12,17,0\.15\)' : 'rgba\(12,12,17,0\.72\)' \}\}/.test(tl), 'SelectionInfoPanel 背景半透明 (v255 适配: 内联样式, 关 = 原 #0c0c11/72; v272: 开 0.4→0.15)');
assert(!/g\.fillStyle = '#0c0c11'/.test(tl) && !/g\.fillStyle = '#101018'/.test(tl), '旧不透明底色已移除');

console.log(failures ? '\nV129_CHECK_FAILED: ' + failures : '\nV129_CHECK_PASSED');
process.exit(failures ? 1 : 0);
