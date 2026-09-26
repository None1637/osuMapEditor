// v285 数值测试: 跨红线就近规则 (lazer GetClosestSnappedTime 无 referenceTime 分支)
// 场景: red0 @0 beatLength=500, red1 @1030 beatLength=250; divisor=4 → red0 网格 step=125
import { snapAcrossRedLine, nextRedAfter, type TimingPoint } from '../../src/osu/parser';
import { snapPlacementTime } from '../../src/osu/sliderPath';
import { snapBeatTime } from '../../src/osu/convert/polygon';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const red = (time: number, beatLength: number): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const points: TimingPoint[] = [red(0, 500), red(1030, 250)];

// nextRedAfter: 严格大于 time 的第一条红线
assert(nextRedAfter(points, 1029)!.time === 1030, 'nextRedAfter(1029) = 1030');
assert(nextRedAfter(points, 1030) === null, 'nextRedAfter(1030) = null (严格大于, lazer Rightmost+1)');
assert(nextRedAfter(points, -5)!.time === 0, 'nextRedAfter(-5) = 0');

// snapAcrossRedLine 纯规则
assert(snapAcrossRedLine(points, 940, 1000) === 1000, 'tick 更近 (60<90) → 保持 tick 1000');
assert(snapAcrossRedLine(points, 1020, 1000) === 1030, '红线更近 (10<20) → 跨到红线起点 1030');
assert(snapAcrossRedLine(points, 1015, 1000) === 1030, '等距 (15=15) → 取红线起点 (lazer < 三元)');
assert(snapAcrossRedLine(points, 5000, 5000) === 5000, '无下条红线 → 原样返回');

// 放置时间吸附 (sliderPath.snapPlacementTime, divisor=4)
assert(snapPlacementTime(points, 940, 4) === 1000, 'snapPlacementTime(940) = 1000 (tick)');
assert(snapPlacementTime(points, 1020, 4) === 1030, 'snapPlacementTime(1020) = 1030 (跨红线)');
assert(snapPlacementTime(points, 1015, 4) === 1030, 'snapPlacementTime(1015) = 1030 (等距取红线)');
assert(snapPlacementTime(points, 1200, 4) === 1217.5, '过 red1 后按 red1 网格 (step 62.5): round((1200-1030)/62.5)=round(2.72)=3 → 1217.5');

// 多边形吸附 (polygon.snapBeatTime)
assert(snapBeatTime(points, 4, 1020) === 1030, 'snapBeatTime(1020) = 1030 (跨红线)');
assert(snapBeatTime(points, 4, 940) === 1000, 'snapBeatTime(940) = 1000 (tick)');
assert(snapBeatTime(points, 4, -100) === 0, 'snapBeatTime(-100) = 0 (clamp 0 保留)');

if (failures) { console.error(`\nV285_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV285_TESTS_ALL_PASSED');
