// 验证器 v180 纯函数测试: spinnerPlacementEnd (lazer SpinnerPlacementBlueprint.updateEndTimeFromCurrent)
import { spinnerPlacementEnd } from '../../src/osu/sliderPath';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const red = (time: number, beatLength: number): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const tp = [red(1000, 500)]; // 120bpm, 1/4 细分格 = 125ms

// lazer: EndTime = max(StartTime + 最短时长, SnapTime(当前时间))
// v320: F22 — 最短时长 1 拍 → 1 个吸附 tick (120bpm 1/4 = 125ms; 用户反馈"放置时有最短时长限制")
assert(spinnerPlacementEnd(tp, 2000, 2000, 4) === 2125, '起点=当前时间: 至少 1 tick 长 (2125)');
assert(spinnerPlacementEnd(tp, 2000, 1000, 4) === 2125, '当前时间在起点之前: 仍至少 1 tick 长');
assert(spinnerPlacementEnd(tp, 2000, 2050, 4) === 2125, '当前时间=起点+50 (不足 1 tick): 钳到 1 tick');
assert(spinnerPlacementEnd(tp, 2000, 3100, 4) === 3125, '当前时间 3100 -> 吸附 1/4 网格 3125');
assert(spinnerPlacementEnd(tp, 2000, 3080, 4) === 3125, '非网格 3080 -> 就近吸附 3125');
assert(spinnerPlacementEnd(tp, 2000, 3500, 4) === 3500, '网格点上原样');
// 换细分: 1/2 = 250ms 格
assert(spinnerPlacementEnd(tp, 2000, 3100, 2) === 3000, 'beatSnap=2: 3100 就近吸附 3000');
assert(spinnerPlacementEnd(tp, 2000, 2000, 2) === 2250, 'beatSnap=2: 最短 1 tick = 半拍 (2250)');

if (failures) throw new Error(`V180_TESTS_FAILED: ${failures}`);
console.log('V180_TESTS_PASSED');
