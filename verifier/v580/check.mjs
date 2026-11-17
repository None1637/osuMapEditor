// v580: 合并滑条按 pixelLength 截到实际尾, de Casteljau 保形
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v580/_bundle.mjs');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
try {
  await build({ entryPoints: [path.join(root, 'verifier/v580/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
  console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
const src = fs.readFileSync(path.join(root, 'src/osu/convert/merge.ts'), 'utf8');
assert(src.includes('function actualSliderSegments') && src.includes('extractRange(measured, 0, tail)'), '源滑条按 pixelLength 弧长截断');
assert(src.includes('const sub = o.type === \'slider\' ? actualSliderSegments(o) : []'), '合并统一走实际滑条身');
console.log(failures ? `\nVERIFIER_V580_FAILED: ${failures}` : '\nVERIFIER_V580_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
