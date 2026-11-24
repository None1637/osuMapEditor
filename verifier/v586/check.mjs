// v586: B4→B 提高拟合容差以减少节点
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v586/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v586/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
const src = fs.readFileSync(path.join(root, 'src/osu/convert/convertB4.ts'), 'utf8');
if (!src.includes('B4_CONVERT_FIT_TOLERANCE = 1.0') || !src.includes('bsplineToStableBezier(pts, deg, b4ConvertSettings.fitTolerance, true, true, b4ConvertSettings.maxDegree)')) {
  console.error('VERIFIER_V586_FAILED: 转换未使用 4px 容差'); process.exit(1);
}
console.log('VERIFIER_V586_ALL_TESTS_PASSED');
