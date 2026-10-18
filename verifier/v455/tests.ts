// 验证器 v455 纯函数测试: svForDurationRaw / svRedlineBoost / bpmRestoreTargetAt —
//   Alt+拖滑条尾 SV 超界时插 BPM×2^n 红线扩程 (editorPrefs.svRedlineBoost 开)
import { svForDuration, svForDurationRaw, svRedlineBoost, bpmRestoreTargetAt, SV_MIN, SV_MAX } from '@/osu/timingSv';
import type { TimingPoint } from '@/osu/parser';

const green = (time: number): TimingPoint =>
  ({ time, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 });
const red = (time: number): TimingPoint =>
  ({ time, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const slider = (time: number) => ({ type: 'slider', time });
const circle = (time: number) => ({ type: 'circle', time });

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log(`  ok: ${msg}`);
  else { failures++; console.error(`  FAIL: ${msg}`); }
}
function near(a: number, b: number, msg: string) {
  ok(Math.abs(a - b) < 1e-9, `${msg} (实际 ${a}, 期望 ${b})`);
}

// svForDurationRaw: 不钳制 (svForDuration 仍钳制)
near(svForDurationRaw(100, 1, 500, 1, 10)!, 50, 'raw 反解不钳制 (50x)');
near(svForDuration(100, 1, 500, 1, 10)!, 10, 'svForDuration 仍钳到 10');
near(svForDurationRaw(100, 1, 500, 1, 100000)!, 0.005, 'raw 下限不钳 (0.005x)');
near(svForDuration(100, 1, 500, 1, 100000)!, 0.1, 'svForDuration 仍钳到 0.1');
ok(svForDurationRaw(100, 1, 500, 1, 0) === null && svForDurationRaw(0, 1, 500, 1, 10) === null, 'raw 非法入参 null');

// svRedlineBoost: 范围内 null
ok(svRedlineBoost(5) === null && svRedlineBoost(SV_MIN) === null && svRedlineBoost(SV_MAX) === null,
  '范围内 (含边界 0.1/10) 不需要红线');

// sv > 10: BPM×2^n (redScale=2^n), sv 落回 (5,10]
{
  const b = svRedlineBoost(20)!;
  near(b.redScale, 2, 'sv=20 → BPM×2');
  near(b.sv, 10, 'sv=20 → 绿线 10x');
}
{
  const b = svRedlineBoost(10.0001)!;
  near(b.redScale, 2, 'sv 略超 10 → BPM×2');
  near(b.sv, 5.00005, 'sv 略超 10 → 绿线≈5x');
}
{
  const b = svRedlineBoost(100)!;
  near(b.redScale, 16, 'sv=100 → BPM×16 (2^4)');
  near(b.sv, 6.25, 'sv=100 → 绿线 6.25x');
}
// sv < 0.1: BPM÷2^n (redScale=2^-n, beatLength×2^n), sv 落回 [0.1,10]
{
  const b = svRedlineBoost(0.05)!;
  near(b.redScale, 0.5, 'sv=0.05 → BPM÷2 (beatLength×2)');
  near(b.sv, 0.1, 'sv=0.05 → 绿线 0.1x');
}
{
  const b = svRedlineBoost(0.09)!;
  near(b.redScale, 0.5, 'sv=0.09 → BPM÷2');
  near(b.sv, 0.18, 'sv=0.09 → 绿线 0.18x');
}
{
  const b = svRedlineBoost(0.009)!;
  near(b.redScale, 1 / 16, 'sv=0.009 → BPM÷16 (2^4)');
  near(b.sv, 0.144, 'sv=0.009 → 绿线 0.144x');
}
// 等效性: duration = L·(B0/redScale)/(100·sm·(svReq/redScale))·slides = L·B0/(100·sm·svReq)·slides
for (const svReq of [10.0001, 20, 100, 0.09, 0.05, 0.009]) {
  const b = svRedlineBoost(svReq)!;
  const L = 234.5, B0 = 400, sm = 1.4, slides = 3;
  const orig = L * B0 / (100 * sm * svReq) * slides;
  const boosted = L * (B0 / b.redScale) / (100 * sm * b.sv) * slides;
  near(boosted, orig, `等效时长不变 (svReq=${svReq})`);
  ok(b.sv >= SV_MIN - 1e-12 && b.sv <= SV_MAX + 1e-12, `绿线 sv 落回 [0.1,10] (svReq=${svReq} → ${b.sv})`);
}

// bpmRestoreTargetAt: 遮挡只看红线 (BPM 不被绿线重置)
ok(bpmRestoreTargetAt([], [slider(1000)], 1000) === null, '无后续滑条不插');
ok(bpmRestoreTargetAt([], [slider(1000), circle(2000)], 1000) === null, '后续只有圆圈不插');
ok(bpmRestoreTargetAt([], [slider(1000), slider(3000)], 1000) === 3000, '无遮挡 → 后续滑条头');
ok(bpmRestoreTargetAt([green(2000)], [slider(1000), slider(3000)], 1000) === 3000, '中间绿线挡不住 BPM → 仍插');
ok(bpmRestoreTargetAt([green(3000)], [slider(1000), slider(3000)], 1000) === 3000, '后续滑条头恰有绿线 → 仍插红线');
ok(bpmRestoreTargetAt([red(2000)], [slider(1000), slider(3000)], 1000) === null, '中间红线挡住, 不插');
ok(bpmRestoreTargetAt([red(3000)], [slider(1000), slider(3000)], 1000) === null, '后续滑条头恰有红线, 不插');
ok(bpmRestoreTargetAt([red(1000)], [slider(1000), slider(3000)], 1000) === 3000, '头处红线 (本次扩程线) 不算遮挡');
ok(bpmRestoreTargetAt([], [slider(1000), slider(5000), slider(2500)], 1000) === 2500, '多条后续滑条取最早者');

if (failures) { console.error(`V455_TESTS_FAILED (${failures})`); process.exit(1); }
console.log('V455_TESTS_ALL_PASSED');
