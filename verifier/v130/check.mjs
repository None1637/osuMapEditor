// v130 源码接线断言: 游玩区高度利用系数 1.1 → 1.2 (下时间轴间隔 ~64px → ~13px = 1/5)
// 运行: node verifier/v130/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const ec = read('src/components/EditorCanvas.tsx');

assert(/\(availH \/ \(PH \+ PAD_Y \* 2\)\) \* 1\.2/.test(ec), '高度利用系数 1.2 (v130: 1.1 → 1.2)');
assert(!/\(availH \/ \(PH \+ PAD_Y \* 2\)\) \* 1\.1/.test(ec), '旧系数 1.1 已移除');
assert(/v130: 系数 1\.1 → 1\.2/.test(ec), 'v130 注释 (间隔 64px → ~13px 依据)');
assert(/const GAP_TOP = 18, GAP_BOTTOM = 10;/.test(ec), '间隔规格保留 (上 18 / 下 10)');
assert(/oy: RESERVED_TOP \+ \(availH - PH \* scale\) \/ 2/.test(ec), '垂直居中公式不变 (slack 随系数增大趋近 0; v270 曾变量化, 已还原)');

// 数值验证: slack 占比 = 1 - 384*1.2/464 ≈ 0.69%, 间隔 = GAP + slack/2 ≈ 10 + availH*0.35%
const slack = 1 - (384 * 1.2) / 464;
assert(slack > 0 && slack < 0.01, `slack 占比 ${(slack * 100).toFixed(2)}% < 1% (1.1 时为 8.6%)`);

console.log(failures ? '\nV130_CHECK_FAILED: ' + failures : '\nV130_CHECK_PASSED');
process.exit(failures ? 1 : 0);
