// v581: 对称滑条编辑预览保留三点圆弧, 应用时才转 B
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
assert(core.includes('forPreview = false') && core.includes("p.join !== 'none' && !forPreview"), 'P→B 仅非预览路径执行');
assert(core.includes("if (forPreview && o.curveType === 'P')"), 'P 专用编辑预览分支');
assert(dlg.includes('computeSymSlider(bm, obj, params, true)') && dlg.includes('objects: previewResult'), '对话框预览使用 P 保留结果');
assert(dlg.includes('store.applyConversion(params.join === \'none\' ? [] : [obj.id], result)'), '应用仍使用最终转换结果');
console.log(failures ? `\nVERIFIER_V581_FAILED: ${failures}` : '\nVERIFIER_V581_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
