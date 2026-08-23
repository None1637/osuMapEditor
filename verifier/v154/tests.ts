// 验证器 v154 纯函数测试: pickTimeNearestHit — 重叠物件命中挑离当前时间最近者
import { pickTimeNearestHit } from '../../src/osu/hitPick';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const o = (time: number, tag = ''): { time: number; tag: string } => ({ time, tag });

section('pickTimeNearestHit: 离当前时间最近者优先');
{
  assert(pickTimeNearestHit([], 1000) === null, '空命中 → null');
  assert(pickTimeNearestHit([o(500)], 1000)!.time === 500, '单命中原样返回');

  // 重叠双物件: 旧行为恒选数组靠后 (上层) 者, 新行为选时间近者
  const hits = [o(2000, 'late'), o(1000, 'near')];
  assert(pickTimeNearestHit(hits, 900)!.tag === 'near', '选离 currentTime=900 最近的 t=1000 (而非上层 t=2000)');

  // 当前时间在两物件中间偏后 → 选后者
  const hits2 = [o(1000, 'a'), o(1400, 'b')];
  assert(pickTimeNearestHit(hits2, 1350)!.tag === 'b', 'currentTime=1350 选 t=1400');

  // 时间差相同 (等距) → 数组靠后者 (上层, 与旧倒序首个命中一致)
  const tie = [o(800, 'early'), o(1200, 'late')];
  assert(pickTimeNearestHit(tie, 1000)!.tag === 'late', '等距 (±200) 取靠后/上层者');

  // 同刻堆叠 (完全同时间) → 数组靠后者 (旧行为保持)
  const same = [o(1000, 'first'), o(1000, 'second'), o(1000, 'third')];
  assert(pickTimeNearestHit(same, 1000)!.tag === 'third', '同刻堆叠取最后一个 (上层)');

  // 三物件重叠: 中间时间者胜出
  const tri = [o(0, 'a'), o(500, 'b'), o(900, 'c')];
  assert(pickTimeNearestHit(tri, 600)!.tag === 'b', '三重叠选 t=500 (距 600 最近)');
}

if (failures) { console.error(`V154_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V154_TESTS_PASSED');
