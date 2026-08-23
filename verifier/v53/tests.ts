// 验证器 v53 纯函数测试: 时间轴药丸 (lazer BPM/SV/采样标签)
import { bpmPillText, svOfPoint, svPillText, svPoints, bankLetter, samplePill, pillLayout } from '../../src/osu/timelinePills';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number, beatLength: number, uninherited: boolean, extra: Partial<TimingPoint> = {}): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0, ...extra });
const bmBase = (): Beatmap => ({
  version: 14, general: { sampleSet: 'Normal' }, editor: { distanceSpacing: 1, beatDivisor: 4, gridSize: 8, timelineZoom: 1 },
  metadata: {}, difficulty: { hp: 5, cs: 4, od: 5, ar: 5, sliderMultiplier: 1, sliderTickRate: 1 },
  timingPoints: [tp(0, 500, true, { sampleSet: 2, volume: 30 })],
  hitObjects: [],
} as unknown as Beatmap);
const circle = (id: number, time: number, hitSampleRaw?: string): HitObject =>
  ({ id, type: 'circle', x: 100, y: 100, time, hitSound: 0, newCombo: false, comboSkip: 0, hitSampleRaw } as unknown as HitObject);

section('bpmPillText: lazer "{60000/beatLength:n1} BPM"');
assert(bpmPillText(500) === '120.0 BPM', `500 -> "120.0 BPM" (实际 "${bpmPillText(500)}")`);
assert(bpmPillText(333.33) === '180.0 BPM', `333.33 -> "180.0 BPM" (实际 "${bpmPillText(333.33)}")`);

section('svOfPoint / svPillText: 绿线 beatLength<0 -> sv=-100/bl, "{n2}x"');
{
  assert(svOfPoint(tp(0, -200, false)) === 0.5, '绿线 -200 -> 0.5');
  assert(svOfPoint(tp(0, 500, true)) === null, '红线 -> null');
  assert(svOfPoint(tp(0, 500, false)) === null, 'beatLength>=0 的绿线 -> null');
  assert(svPillText(0.5) === '0.50x', `0.5 -> "0.50x"`);
  assert(svPillText(2) === '2.00x', `2 -> "2.00x"`);
}

section('svPoints (v61 起, 原 svChangePoints): 全部绿线出药丸 — lazer 每个物件都挂 SV 胶囊, 无去重');
{
  const pts = [
    tp(0, 500, true),
    tp(1000, -200, false),           // 0.5
    tp(2000, -200, false),           // 重申 0.5: v61 起也出
    tp(3000, -200, false, { volume: 40 }), // 纯音量变化: v61 起也出
    tp(4000, -50, false),            // 2.0
  ];
  const out = svPoints(pts);
  assert(out.length === 4, `4 条绿线全出 (实际 ${out.length})`);
  assert(out[0].time === 1000 && out[0].sv === 0.5, `1000 @ 0.5`);
  assert(out[3].time === 4000 && out[3].sv === 2, `4000 @ 2.0`);
}

section('bankLetter: normal=N soft=S drum=D (lazer abbreviateBank)');
assert(bankLetter(1) === 'N' && bankLetter(2) === 'S' && bankLetter(3) === 'D', 'N/S/D');

section('samplePill: "{bank}{:suffix} {volume}" (lazer SamplePointPiece)');
{
  const bm = bmBase(); // red@0: sampleSet=2 (soft), volume=30
  const p1 = samplePill(bm, circle(1, 500));
  assert(p1.text === 'S 30' && !p1.alt, `继承 soft+30 -> "S 30" (实际 "${p1.text}")`);
  const p2 = samplePill(bm, circle(2, 500, '3:0:0:60:')); // drum + 音量 60 覆盖
  assert(p2.text === 'D 60', `hitSample 覆盖 -> "D 60" (实际 "${p2.text}")`);
  const p3 = samplePill(bm, circle(3, 500, '0:0:2:0:')); // 自定义序号 2 -> :2, 音量继承 30
  assert(p3.text === 'S:2 30', `自定义序号 -> "S:2 30" (实际 "${p3.text}")`);
  const sl = { ...circle(4, 500), type: 'slider', curveType: 'L', curvePoints: [{ x: 200, y: 100 }], length: 100, slides: 1 } as unknown as HitObject;
  assert(samplePill(bm, sl).alt, 'slider -> alt (Pink2)');
  // [General] SampleSet=Drum 兜底
  const bm2 = bmBase(); bm2.general.sampleSet = 'Drum'; bm2.timingPoints = [tp(0, 500, true, { sampleSet: 0, volume: 80 })];
  assert(samplePill(bm2, circle(5, 500)).text === 'N 80' || samplePill(bm2, circle(5, 500)).text === 'D 80',
    `sampleSet=0 回退 [General] (实际 "${samplePill(bm2, circle(5, 500)).text}")`);
}

section('pillLayout: 与上一个完整药丸重叠 -> 收缩为点 (lazer SamplePointContracted)');
{
  const kinds = pillLayout([{ x: 100, w: 30 }, { x: 120, w: 30 }, { x: 300, w: 30 }]);
  assert(kinds.join(',') === 'full,dot,full', `100/120/300 -> full,dot,full (实际 ${kinds})`);
  const kinds2 = pillLayout([{ x: 100, w: 30 }, { x: 200, w: 30 }]);
  assert(kinds2.join(',') === 'full,full', `稀疏 -> 全 full (实际 ${kinds2})`);
}

if (failures) { console.error(`\nTESTS_V53_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V53_ALL_PASSED');
