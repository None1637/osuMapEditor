// v407 单元断言: Alt+拖滑条尾改绿线 SV (timingSv.ts 纯函数)
import { svForDuration, beatLengthForSv, svAt, greenLineAt, SV_MIN, SV_MAX } from '../../src/osu/timingSv';
import { sliderVelocityAt, type TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function near(a: number, b: number, eps: number, msg: string) {
  assert(Math.abs(a - b) <= eps, `${msg} (got ${a}, want ~${b})`);
}

const red: TimingPoint = { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 };

// ---- svForDuration: 反解 + 闭环校验 (duration = length*red.beatLength/(100*SM*sv)*slides) ----
{
  // length 200, slides 1, beatLength 500, SM 1.4, 目标 1000ms
  // sv = 200*1*500/(100*1.4*1000) ≈ 0.7142857
  const sv = svForDuration(200, 1, 500, 1.4, 1000)!;
  near(sv, 5 / 7, 1e-9, '反解 sv = 5/7');
  // 闭环: 用该 sv 的速度算时长应回到 1000ms
  const green: TimingPoint = { time: 0, beatLength: beatLengthForSv(sv), meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: false, effects: 0 };
  const vel = sliderVelocityAt([red, green], 0, 1.4);
  near(200 / vel, 1000, 1e-6, '闭环: length/vel = 目标时长');
  // 折返数入公式
  const sv2 = svForDuration(200, 3, 500, 1.4, 1500)!;
  near(sv2, (200 * 3 * 500) / (100 * 1.4 * 1500), 1e-9, 'slides=3 入公式');
}
// ---- 钳制与非法入参 ----
{
  assert(svForDuration(200, 1, 500, 1, 100000)! === SV_MIN, '超长时长 -> 钳到下限 0.1');
  assert(svForDuration(200, 1, 500, 1, 10)! === SV_MAX, '超短时长 -> 钳到上限 10');
  assert(svForDuration(200, 1, 500, 1, 0) === null, 'targetDur=0 -> null');
  assert(svForDuration(200, 1, 500, 1, -5) === null, 'targetDur<0 -> null');
  assert(svForDuration(0, 1, 500, 1, 1000) === null, 'length=0 -> null');
  assert(svForDuration(200, 0, 500, 1, 1000) === null, 'slides=0 -> null');
}
// ---- beatLengthForSv / svAt / greenLineAt ----
{
  assert(beatLengthForSv(2) === -50, 'sv=2 -> beatLength=-50');
  assert(beatLengthForSv(0.5) === -200, 'sv=0.5 -> beatLength=-200');
  assert(svAt([red], 100) === 1, '无绿线 -> 1');
  const g: TimingPoint = { time: 50, beatLength: -50, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: false, effects: 0 };
  assert(svAt([red, g], 100) === 2, '绿线 sv=2');
  assert(svAt([red, g], 40) === 1, '绿线前 -> 1');
  const red2: TimingPoint = { ...red, time: 80 };
  assert(svAt([red, g, red2], 100) === 1, '红线重置 SV (stable 语义 v227)');
  assert(greenLineAt([red, g], 50) === g, 'greenLineAt 命中');
  assert(greenLineAt([red, g], 51) === null, 'greenLineAt 非同刻不命中');
  assert(greenLineAt([red, g], 0) === null, '红线不算绿线');
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');
