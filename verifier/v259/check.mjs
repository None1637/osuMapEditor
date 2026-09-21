// 验证器 v259: hover 滑条点预览 (stable 同款)。
// 需求: soulten「游標在滑條上的時候顯示其滑條點」「滑上去時想要跟stable一樣會預覽滑條的點」。
// 实现: renderer.ts 控制点连线+手柄抽为导出函数 drawSliderControlPoints (选中装饰/hover 共用);
//   EditorCanvas onMouseMove 选择工具非拖拽时 hitTest 记录 hoverSliderRef,
//   渲染循环对未选中 hover 滑条叠加画控制点 (alpha 0.75, 含堆叠偏移); 出画布清除。
// 运行: node verifier/v259/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const r = fs.readFileSync(path.join(root, 'src/osu/renderer.ts'), 'utf8');
assert(/export function drawSliderControlPoints\(/.test(r), 'renderer 导出 drawSliderControlPoints');
assert(/drawSliderControlPoints\(g, o\); \/\/ v259/.test(r), '选中装饰复用抽出函数 (回归保护)');
assert((r.match(/v259/g) ?? []).length >= 2, 'renderer v259 注释在');

const ec = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
assert(/hoverSliderRef = useRef<number \| null>\(null\)/.test(ec), 'hoverSliderRef 存在');
assert(/drawSliderControlPoints } from '@\/osu\/renderer'/.test(ec) || /drawPendingSpinner, drawSliderControlPoints\}/.test(ec), 'EditorCanvas 引入 drawSliderControlPoints');
assert(/hit\.type === 'slider' && !store\.selected\.has\(hit\.id\) \? hit\.id : null/.test(ec), 'hover 仅记录未选中滑条');
assert(/store\.tool === 'select' && bm && !store\.canvasDragging/.test(ec), 'hover 仅选择工具非拖拽时更新');
assert(/hoverSliderRef\.current = null; \/\/ v259/.test(ec), '出画布清 hover');
assert(/g\.globalAlpha = 0\.75;\s*\n\s*drawSliderControlPoints\(g, ho\)/.test(ec), '渲染循环叠加 hover 控制点 (alpha 0.75)');

if (failures) { console.error(`\nV259_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV259_ALL_PASSED');
