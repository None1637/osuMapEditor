// v581/v595: 对称滑条保留原三点圆弧锚点; v595 起预览直接显示最终 B 形状
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v581/_bundle.mjs');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
try {
  await build({ entryPoints: [path.join(root, 'verifier/v581/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
  console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
const core = fs.readFileSync(path.join(root, 'src/osu/convert/symSlider.ts'), 'utf8');
const dlg = fs.readFileSync(path.join(root, 'src/components/convert/SymSliderDialog.tsx'), 'utf8');
const canvas = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
assert(!core.includes('forPreview'), 'v595: 转换器不再区分独立 P 预览与最终结果');
assert(dlg.includes('objects: result') && !dlg.includes('previewResult'), '对话框预览直接使用最终转换结果');
assert(canvas.includes('drawSliderControlPoints(g, symAnchorSource)'), '原 P 三点锚点由画布单独叠加');
assert(dlg.includes('store.applyConversion(params.join === \'none\' ? [] : [obj.id], result)'), '应用仍使用最终转换结果');
console.log(failures ? `\nVERIFIER_V581_FAILED: ${failures}` : '\nVERIFIER_V581_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
