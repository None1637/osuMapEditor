// v582: 批量复制第 1/3/5… 份镜像 + 任意两点自定义轴
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v582/_bundle.mjs');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
try {
  await build({ entryPoints: [path.join(root, 'verifier/v582/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
  console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
const dup = fs.readFileSync(path.join(root, 'src/osu/duplicate.ts'), 'utf8');
const dlg = fs.readFileSync(path.join(root, 'src/components/convert/DuplicateDialog.tsx'), 'utf8');
const dict = fs.readFileSync(path.join(root, 'src/i18n/dicts/zh-CN/convert.ts'), 'utf8');
assert(dup.includes('const mirrorOn = p.mirrorRepeat && i % 2 === 1'), '奇数份镜像');
assert(dup.includes('const t = ((q.x - p.mirrorAxisP1.x) * ax') && dup.includes('2 * fx - q.x'), '任意直线垂足镜像公式');
assert(dlg.includes('<option value="custom">') && dlg.includes('testid="mirrorAxisP1x"') && dlg.includes('testid="mirrorAxisP2y"'), '自定义轴下拉与两点输入');
assert(dlg.includes('store.symSliderAxisView = customAxisActive') && dlg.includes('store.symSliderAxisDragHandler'), '自定义轴画布拖拽接线');
assert(dict.includes('第 1/3/5… 份绕锚点镜像') && dict.includes('convert.dup_mirror_degenerate'), '奇数份提示与退化提示');
console.log(failures ? `\nVERIFIER_V582_FAILED: ${failures}` : '\nVERIFIER_V582_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
