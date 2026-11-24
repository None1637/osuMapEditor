// v595: 对称预览直接显示最终形状, 同时保留原 P 三点可编辑锚点
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const core = read('src/osu/convert/symSlider.ts');
const dlg = read('src/components/convert/SymSliderDialog.tsx');
const canvas = read('src/components/EditorCanvas.tsx');
const renderer = read('src/osu/renderer.ts');
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

assert(!core.includes('forPreview'), '转换器只生成最终结果, 不再返回独立 P 预览');
assert(dlg.includes('objects: result') && !dlg.includes('previewResult'), '对话框预览对象 = 最终应用 result');
assert(canvas.includes("store.conversionDialog === 'symSlider'") && canvas.includes('symAnchorSource'), '画布识别被隐藏的原 P 滑条');
assert(canvas.includes('drawSliderControlPoints(g, symAnchorSource)'), '原三点圆弧控制手柄单独叠加');
assert(canvas.includes('hiddenSliderControlPoints: symAnchorSource && convPrev'), '仅对称最终预览抑制临时结果锚点');
assert(renderer.includes('hiddenSliderControlPoints?: Set<number>')
  && renderer.includes('if (!rc.hiddenSliderControlPoints?.has(o.id)) drawSliderControlPoints(g, o)'), '渲染器保留身体选中效果但跳过指定滑条控制点');
assert(core.includes('let base = joinAnchor') && core.includes('segmentsToPoints(extractRange'), '最终拼接仍截尾并对齐实际滑条尾');

console.log(failures ? `\nVERIFIER_V595_FAILED: ${failures}` : '\nVERIFIER_V595_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
