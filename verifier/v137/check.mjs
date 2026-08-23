// 验证器 v137: 上方时间轴暗化层 — 波形下层时暗化波形, 波形上层时暗化时间轴内容 (同一层半透明暗色)
// 需求: 波形显示在上层时, 物件和红绿线等元素需要暗化 (放一层半透明的暗色控件) 并显示在下层;
//       波形显示在下层时, 波形需要暗化 (还是之前那一层半透明的暗色控件)。
// 运行: node verifier/v137/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const tl = read('src/components/Timelines.tsx');

// 1. 共用暗化层函数
assert(/const drawDimOverlay = \(g: CanvasRenderingContext2D, r: DOMRect\)/.test(tl), 'drawDimOverlay 共用暗化层');
assert(/rgba\(8,8,12,0\.5\)/.test(tl), '半透明暗色 (两种模式同一层)');
const dimBody = tl.slice(tl.indexOf('const drawDimOverlay'), tl.indexOf('const drawDimOverlay') + 400);
assert(/fillRect\(0, 0, r\.width, r\.height\)/.test(dimBody), '覆盖整个时间轴 (css px 坐标系)');

// 2. 背景模式: 先波形后暗化 (波形暗化, 内容后画保持正常亮度)
const bg = tl.indexOf("if (store.wavePanelOpen && !store.waveOnTop)");
assert(bg > 0, '背景模式分支存在');
const bgLine = tl.slice(bg, bg + 160);
assert(/\{ drawWaveLayer\(g, r, dpr, t0, win\); drawDimOverlay\(g, r\); \}/.test(bgLine), '背景模式: 波形 -> 暗化层 (波形被暗化)');

// 3. 上层模式: 先暗化后波形 (内容暗化, 波形全亮最上层)
const top = tl.indexOf('if (store.wavePanelOpen && store.waveOnTop)');
assert(top > 0, '上层模式分支存在');
const topLine = tl.slice(top, top + 160);
assert(/\{ drawDimOverlay\(g, r\); drawWaveLayer\(g, r, dpr, t0, win(, true)?\); \}/.test(topLine), '上层模式: 暗化层 -> 波形 (内容被暗化; v138 波形离屏贴回透出下层)');

// 4. 上层模式分支在时间轴内容绘制之后 (当前时间针是内容最后一步)
const needle = tl.indexOf('当前时间针');
assert(needle > 0 && top > needle, '上层模式在时间针之后 (内容全部画完才暗化)');

console.log(failures ? `\nV137_CHECK_FAILED: ${failures}` : '\nV137_CHECK_PASSED');
process.exit(failures ? 1 : 0);
