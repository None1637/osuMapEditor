// 验证器 v82 纯函数测试: pendingSliderTimeline — 放置中滑条的时间轴预览区间 (与 finishSlider 同规则)
// 布景: 红线 1000/500 => vel = 100*1/500 = 0.2 px/ms, 整拍 = 100px; beatSnap 4 => tick 125ms
import { pendingSliderTimeline } from '../../src/osu/sliderPath';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const TPS: TimingPoint[] = [
  { time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
];
const PEND = [{ x: 0, y: 0 }, { x: 100, y: 0 }]; // 直线 100px

section('时间吸附 + 时长换算');
{
  const a = pendingSliderTimeline(TPS, 1, PEND, null, 2000, 4, false, 1);
  assert(a.time === 2000 && a.end === 2500, `time=2000 end=2500 (实际 ${a.time}/${a.end})`);
  const b = pendingSliderTimeline(TPS, 1, PEND, null, 2060, 4, false, 1);
  assert(b.time === 2000, `2060 就近吸附 2000 (实际 ${b.time})`);
  const c = pendingSliderTimeline(TPS, 1, PEND, null, 2070, 4, false, 1);
  assert(c.time === 2125, `2070 就近吸附 2125 (实际 ${c.time})`);
}

section('锁定间距: 长度吸附整拍 (100px/拍)');
{
  const a = pendingSliderTimeline(TPS, 1, [{ x: 0, y: 0 }, { x: 130, y: 0 }], null, 2000, 4, true, 1);
  assert(a.end === 2500, `130px -> 1 拍 100px => end 2500 (实际 ${a.end})`);
  const b = pendingSliderTimeline(TPS, 1, [{ x: 0, y: 0 }, { x: 160, y: 0 }], null, 2000, 4, true, 1);
  assert(b.end === 2500, `160px -> v160 退一拍 100px (2 拍 200 超几何+容差) => end 2500 (实际 ${b.end})`);
}

section('下限 (仅头部)');
{
  const a = pendingSliderTimeline(TPS, 1, [{ x: 0, y: 0 }], null, 2000, 4, false, 1);
  assert(a.time === 2000 && a.end === 2005, `长度 0 -> v160 钳到几何全长 1px => end 2005 (实际 ${a.end}; 旧: 下限 1 tick 25px)`);
}

section('幻影光标点计入长度');
{
  const noCur = pendingSliderTimeline(TPS, 1, PEND, null, 2000, 4, false, 1);
  const cur = pendingSliderTimeline(TPS, 1, PEND, { x: 150, y: 0 }, 2000, 4, false, 1);
  assert(cur.end === 2750 && cur.end > noCur.end, `光标 (150,0) => 150px => end 2750 (实际 ${cur.end})`);
}

if (failures) { console.error(`\nTESTS_V82_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V82_ALL_PASSED');
