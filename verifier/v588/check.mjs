// v588: 高阶贝塞尔整体拟合, 用白锚点替代分段红锚点
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v588/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v588/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
const src = fs.readFileSync(path.join(root, 'src/osu/freehand/pathApproximator.ts'), 'utf8');
const conv = fs.readFileSync(path.join(root, 'src/osu/convert/convertB4.ts'), 'utf8');
if (!src.includes('fitHighOrderBezierToPolyline') || !conv.includes('b4ConvertSettings.fitTolerance, true, true, b4ConvertSettings.maxDegree')) {
  console.error('VERIFIER_V588_FAILED: 未使用高阶整体拟合'); process.exit(1);
}
console.log('VERIFIER_V588_ALL_TESTS_PASSED');
