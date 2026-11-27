// v610: 锁定间距滑条尾按节拍网格, 不乘间距倍率
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v610/_bundle.mjs');
await build({ entryPoints: [path.join(root, 'verifier/v610/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const src = fs.readFileSync(path.join(root, 'src/osu/sliderPath.ts'), 'utf8');
ok(src.includes('const stepPx = tickPx;') && !src.includes('const stepPx = tickPx * distanceSpacing;'), 'distanceLock 步长不再乘 distanceSpacing');
ok(src.includes('let steps = Math.round(geometryLength / stepPx)'), '仍按 stepPx 就近取步');
console.log(failures ? `VERIFIER_V610_FAILED: ${failures}` : 'VERIFIER_V610_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
