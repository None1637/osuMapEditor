// 验证器 v190 纯函数测试: pillLayout 对 x 升序输入逐个判定 (修复前提: 调用方排序)
import { pillLayout } from '../../src/osu/timelinePills';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// 稀疏物件 (间隔 100px, 宽 30): 升序 → 全 full; 降序 (v189 回归现场) → 除首个全 dot
const sparseAsc = [100, 200, 300, 400].map(x => ({ x, w: 30 }));
assert(pillLayout(sparseAsc).every(k => k === 'full'), '升序稀疏: 全部 full');
const sparseDesc = [...sparseAsc].reverse();
assert(pillLayout(sparseDesc).filter(k => k === 'dot').length === 3, '降序输入会全收缩 (证明排序必要)');
assert(pillLayout([...sparseDesc].sort((a, b) => a.x - b.x)).every(k => k === 'full'), '降序排序后恢复 full (v190 修复路径)');

// 密集物件: 仍有收缩
const dense = [100, 105, 110, 115].map(x => ({ x, w: 30 }));
assert(pillLayout(dense).filter(k => k === 'dot').length === 3, '密集时仍收缩为点 (v53 行为不变)');

if (failures) { console.error(`V190_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V190_TESTS_PASSED');
