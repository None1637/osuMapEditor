// 验证器 v239: 批量复制间隔 = a × 1/b 拍 (a,b 均为整数)。
// 需求: v238 的 1/b 下拉补充分子 a — 间隔形式为 a*1/b 拍 (如 3 × 1/4 拍)。
// 实现: BEAT_DENOMS 分母表 + splitBeat 数字拍分解 (首个使 v*b 为整数且 >=1 的分母, 遗留小数回退 a=v,b=1);
// UI = DraftNum(a, data-conv 钩子 intervalNum) + select(b, 钩子 data-conv="intervalBeats" 不变);
// 内部 params.intervalBeats 仍存数字拍 a/b (持久化/计算不变)。
// 运行: node verifier/v239/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/components/convert/DuplicateDialog.tsx');

console.log('== DuplicateDialog.tsx: 间隔 = a × 1/b');
assert(/const BEAT_DENOMS = \[1, 2, 3, 4, 6, 8, 12, 16\];/.test(src), '分母表');
assert(/const splitBeat = \(v: number\): \[number, number\] => \{/.test(src)
  && /const a = v \* b;/.test(src) && /Math\.round\(a\) >= 1/.test(src), 'splitBeat 分解 (首个整除分母, a>=1)');
assert(!/INTERVALS/.test(src), 'v238 的 INTERVALS 常量已移除');
assert(/<DraftNum value=\{a\} testid="intervalNum" min=\{1\} max=\{99\}/.test(src)
  && /set=\{v => upd\(\{ intervalBeats: Math\.round\(v\) \/ b \}\)\}/.test(src), '分子 a 输入 (整数, 回写 a/b)');
assert(/<select value=\{String\(b\)\} data-conv="intervalBeats"/.test(src)
  && /onChange=\{e => upd\(\{ intervalBeats: a \/ parseInt\(e\.target\.value\) \}\)\}/.test(src), '分母 b 下拉 (保持 a, 回写 a/b; DOM 钩子不变)');
assert(/× 1 \//.test(src), 'UI 显示 a × 1/b 形式');

if (failures) { console.error(`\nV239_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV239_ALL_PASSED');
