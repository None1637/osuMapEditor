// 验证器 v61 纯函数测试: 绿线 SV 全显示 (lazer 无去重) + 红绿线竖线化
import { svPoints, svOfPoint } from '../../src/osu/timelinePills';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number, beatLength: number, uninherited: boolean, extra: Partial<TimingPoint> = {}): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0, ...extra,
});

section('svPoints: 全部绿线出 SV 药丸 (lazer TimelineHitObjectBlueprint: 无与上一条比较)');
{
  const pts = [
    tp(0, 500, true),                         // 红线不出
    tp(1000, -200, false),                    // 0.5
    tp(2000, -200, false),                    // SV 重申: 也出 (v61 变更点)
    tp(3000, -200, false, { volume: 40 }),    // 纯音量变化: 也出 (v61 变更点)
    tp(3500, -200, false, { sampleSet: 3 }),  // 纯采样集变化: 也出
    tp(4000, -50, false),                     // 2.0
    tp(5000, 400, true),                      // 红线不出
  ];
  const out = svPoints(pts);
  assert(out.length === 5, `5 条绿线全出 (实际 ${out.length})`);
  assert(out[0].time === 1000 && out[0].sv === 0.5, '1000 @ 0.50x');
  assert(out[1].time === 2000 && out[1].sv === 0.5, '2000 SV 重申也出');
  assert(out[2].time === 3000 && out[2].sv === 0.5, '3000 纯音量变化也出');
  assert(out[4].time === 4000 && out[4].sv === 2, '4000 @ 2.00x');
}

section('svPoints: 乱序输入按时间排序; beatLength>=0 的绿线不出 (非 SV 线)');
{
  const pts = [tp(3000, -100, false), tp(1000, -200, false), tp(2000, 300, false)];
  const out = svPoints(pts);
  assert(out.length === 2 && out[0].time === 1000 && out[1].time === 3000, `排序+过滤 (实际 ${out.map(o => o.time)})`);
  assert(svOfPoint(tp(2000, 300, false)) === null, 'beatLength>=0 绿线 -> null');
}

if (failures) { console.error(`\nTESTS_V61_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V61_ALL_PASSED');
