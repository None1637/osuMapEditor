// v591: 多边形参考滑条按实际结束时间选择, 对齐 lazer
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v591/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v591/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
const src = fs.readFileSync(path.join(root, 'src/osu/convert/polygon.ts'), 'utf8');
if (!src.includes('const end = hitObjectEndTime(bm, o)') || !src.includes('hitObjectEndTime(bm, last)')) {
  console.error('VERIFIER_V591_FAILED: 未按实际结束时间选择参考滑条'); process.exit(1);
}
console.log('VERIFIER_V591_ALL_TESTS_PASSED');
