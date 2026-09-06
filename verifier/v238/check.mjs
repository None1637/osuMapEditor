// 验证器 v238: 批量复制「间隔 (拍)」改节拍分数下拉 (1/2、1/4、1/8、1/16 等形式)。
// 需求: 不再用小数输入 (0.25 拍); 与滑条转连打 v41 同款分母 + 常用整数拍;
// 内部 params.intervalBeats 仍存数字拍 (持久化与 computeDuplicate 计算不变)。
// v239 取代: 间隔进一步改为 a × 1/b 拍 (a,b 整数) — INTERVALS 常量已移除,
// 本验证器的下拉形态断言更新为 v239 的 BEAT_DENOMS 形态 (select data-conv 钩子不变)。
// 运行: node verifier/v238/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/components/convert/DuplicateDialog.tsx');

console.log('== DuplicateDialog.tsx: 间隔 (拍) 节拍分数形式 (v239 形态)');
assert(!/DraftNum value=\{params\.intervalBeats\}/.test(src), '旧小数输入已移除');
assert(/const BEAT_DENOMS = \[1, 2, 3, 4, 6, 8, 12, 16\];/.test(src), '分母列表 (含转连打同款分母, v239)');
assert(/data-conv="intervalBeats"/.test(src), '间隔 select DOM 钩子 data-conv 不变');

console.log('== duplicate.ts: 参数语义不变');
{
  const dup = readSrc('src/osu/duplicate.ts');
  assert(/intervalBeats: number; \/\/ 相邻两份间隔 \(拍, 可小数\)/.test(dup), 'intervalBeats 仍为数字拍');
  assert(/advanceByBeats\(bm\.timingPoints, o\.time, p\.intervalBeats \* i\)/.test(dup), '时间换算逻辑不变');
}

if (failures) { console.error(`\nV238_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV238_ALL_PASSED');
