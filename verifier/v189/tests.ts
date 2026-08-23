// 验证器 v189 纯函数测试: ① stackInfo 精确同刻 ② stackLayout 堆叠不缩半径
import { stackInfo, stackLayout } from '../../src/osu/timelineHit';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const OBJ_H = 60, RAD = 24;
const o = (id: number, time: number) => ({ id, time });

section('stackInfo: 精确 0ms 同刻');
{
  const m = stackInfo([o(1, 1000), o(2, 1000), o(3, 1001)]);
  assert(m.get(1)!.count === 2 && m.get(2)!.count === 2, '同刻两件 count=2');
  assert(m.get(3)!.count === 1, '1ms 偏移不堆叠');
}

section('stackLayout: 堆叠不缩半径 (仅压层距)');
{
  for (const n of [2, 3, 5, 10, 40]) {
    const lay = stackLayout(n, OBJ_H, RAD);
    assert(lay.rad === RAD, `count=${n}: rad 恒为 ${RAD} (得 ${lay.rad})`);
    assert(lay.yOf(0) > lay.yOf(n - 1), `count=${n}: level 0 在最下`);
    assert(lay.yOf(0) + lay.rad <= OBJ_H - 1.9 && lay.yOf(n - 1) - lay.rad >= 1.9, `count=${n}: 不越出行上下界`);
  }
  const single = stackLayout(1, OBJ_H, RAD);
  assert(single.rad === RAD && single.yOf(0) === OBJ_H / 2, '非堆叠原样 (行居中)');
}

if (failures) { console.error(`V189_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V189_TESTS_PASSED');
