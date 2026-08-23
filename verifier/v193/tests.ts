// 验证器 v193 纯函数测试: 滚轮刻度累积 (lazer Editor.OnScroll) + 播放中滚轮步长 (Editor.cs seek 播放分支)
import { wheelSteps, playingWheelStepMs, WHEEL_PRECISION, type WheelAccum } from '../../src/osu/seekSnapping';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number, beatLength: number): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });

section('wheelSteps: 刻度累积 (lazer Editor.OnScroll)');
{
  const st: WheelAccum = { acc: 0 };
  assert(wheelSteps(st, 120, 0) === 1, '一整格 (120px) → +1 步');
  assert(st.acc === 0, '整格后无残余');

  st.acc = 0;
  assert(wheelSteps(st, 40, 0) === 0 && wheelSteps(st, 40, 0) === 0, '触摸板 40+40 < 120 → 不触发');
  assert(wheelSteps(st, 40, 0) === 1, '累积满 120 → +1 步 (余 0)');
  assert(st.acc === 0, '触发后清零');

  st.acc = 0;
  assert(wheelSteps(st, 360, 0) === 3, '360px → 3 步 (快速甩滚轮)');
  st.acc = 0;
  assert(wheelSteps(st, 100, 0) === 0 && wheelSteps(st, 100, 0) === 1, '100px 设备: 两格累积 200 → 第二次触发');
  assert(st.acc === 80, '残余 80 保留');

  // 反向折返: acc=80 时反向 -120 → 折返为 -(120-80)=-40, 再加 -120 → -160 → 1 步, 余 -40
  assert(wheelSteps(st, -120, 0) === -1, '反向折返后立即触发 -1 步 (lazer 折返逻辑)');
  assert(st.acc === -40, `折返后余 -40 (得 ${st.acc})`);

  st.acc = 0;
  assert(wheelSteps(st, 3, 1) === 0 && wheelSteps(st, 1, 1) === 1, 'deltaMode=行: 3行+1行 ≈ 132px → 1 步');
}

section('playingWheelStepMs: 播放中步长 (BeatLength × BPM/120 × (1+250/(int)BeatLength))');
{
  // 120bpm (bl=500): 500 × 1 × (1+0) = 500ms
  assert(playingWheelStepMs([red(0, 500)], 1000) === 500, `120bpm → 500ms (得 ${playingWheelStepMs([red(0, 500)], 1000)})`);
  // 240bpm (bl=250): 500 × (1+250/250) = 1000ms
  assert(playingWheelStepMs([red(0, 250)], 1000) === 1000, '240bpm → 1000ms');
  // 180bpm (bl=333.33): 500 × (1+250/333=0) = 500ms
  assert(Math.abs(playingWheelStepMs([red(0, 1000 / 3)], 0) - 500) < 1e-6, '180bpm → 500ms');
  // 300bpm (bl=200): 500 × (1+250/200=1) = 1000ms
  assert(playingWheelStepMs([red(0, 200)], 0) === 1000, '300bpm → 1000ms');
  // 多红线: 取当前时间所在红线
  const pts = [red(0, 500), red(10000, 250)];
  assert(playingWheelStepMs(pts, 5000) === 500, '多红线: 前段 120bpm → 500ms');
  assert(playingWheelStepMs(pts, 15000) === 1000, '多红线: 后段 240bpm → 1000ms');
  // 无红线兜底 500ms
  assert(playingWheelStepMs([], 0) === 500, '无红线 → 500ms 兜底');
}

if (failures) { console.error(`V193_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V193_TESTS_PASSED');
