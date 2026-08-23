// 验证器 v188 纯函数测试 (v189 修订): stackInfo 同刻判定 = 精确相等 (v188 的 ±2ms 已被 v189 撤销)
import { stackInfo } from '../../src/osu/timelineHit';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const o = (id: number, time: number) => ({ id, time });

section('stackInfo: 同刻 = 精确 0ms (v189 撤销 ±2ms)');
{
  const exact = stackInfo([o(1, 1000), o(2, 1000)]);
  assert(exact.get(1)!.count === 2 && exact.get(1)!.level === 0, '精确同刻: 文件靠前 level 0');
  assert(exact.get(2)!.count === 2 && exact.get(2)!.level === 1, '精确同刻: 文件靠后 level 1');

  // v188 案例: 7157/7158 相差 1ms → v189 起不堆叠 (可见性改由时间倒序绘制解决)
  const off = stackInfo([o(1, 7157), o(2, 7158)]);
  assert(off.get(1)!.count === 1 && off.get(2)!.count === 1, '1ms 偏移 → 不堆叠 (v189)');
}

if (failures) { console.error(`V188_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V188_TESTS_PASSED');
