// v590: 默认拟合容差恢复旧值 1px, 自定义设置保留
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v590/_bundle.mjs');
await build({
  entryPoints: [path.join(root, 'src/osu/convert/convertB4.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});
const { B4_CONVERT_FIT_TOLERANCE, b4ConvertSettings, setB4ConvertFitTolerance } = await import('file://' + out);
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
assert(B4_CONVERT_FIT_TOLERANCE === 1.0 && b4ConvertSettings.fitTolerance === 1.0, '默认容差恢复 1px');
setB4ConvertFitTolerance(4);
assert(b4ConvertSettings.fitTolerance === 4, '自定义容差仍可设置');
setB4ConvertFitTolerance(1);
fs.unlinkSync(out);
console.log(failures ? 'VERIFIER_V590_FAILED' : 'VERIFIER_V590_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
