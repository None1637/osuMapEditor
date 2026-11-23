// v587: B4 可调拟合容差 + 平顺红锚点合并
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v587/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v587/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const approx = fs.readFileSync(path.join(root, 'src/osu/freehand/pathApproximator.ts'), 'utf8');
const conv = fs.readFileSync(path.join(root, 'src/osu/convert/convertB4.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
assert(approx.includes('function mergeSmoothJoints') && approx.includes('Math.cos(Math.PI / 6)'), '仅 30° 内平顺接点合并');
assert(conv.includes('setB4ConvertFitTolerance') && conv.includes('b4ConvertSettings.fitTolerance, true'), '可调容差与平顺合并进入转换');
assert(app.includes('data-b4-tolerance') && app.includes('setB4ConvertFitTolerance(parseFloat'), '警告条容差输入框');
console.log(failures ? `\nVERIFIER_V587_FAILED: ${failures}` : '\nVERIFIER_V587_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
