import assert from 'node:assert';
import { parseOsu, serializeOsu, arToPreempt, arToFadeIn, sliderVelocityAt, type Beatmap } from '../../src/osu/parser';
import { SliderPath } from '../../src/osu/sliderPath';
import { createSampleBeatmap } from '../../src/osu/sampleBeatmap';

const bm: Beatmap = createSampleBeatmap();
assert.ok(bm.hitObjects.length >= 20);
assert.ok(Math.abs(sliderVelocityAt(bm.timingPoints, 14000, 1.4) - 0.56) < 1e-9);
const pp = new SliderPath('P', [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }], Math.PI * 50);
assert.ok(Math.abs(pp.totalLength - Math.PI * 50) < 5);

// AR 官方公式 (用户提供的参考):
// AR<5: preempt = 1200 + 120*(5-AR); AR>5: preempt = 1200 - 150*(AR-5)
for (const ar of [0, 1, 2.5, 4, 5, 6, 7, 8, 9, 9.5, 10, 11]) {
  const expect = ar <= 5 ? 1200 + 120 * (5 - ar) : 1200 - 150 * (ar - 5);
  assert.ok(Math.abs(arToPreempt(ar) - expect) < 1e-9, `preempt AR${ar}`);
}
// 渐入显示时长 = preempt 的 2/3 (打击物件在 X-preempt 渐显, 经过2/3后完整显示)
for (const ar of [0, 3, 5, 7, 9, 10]) {
  assert.ok(Math.abs(arToFadeIn(ar) - arToPreempt(ar) * 2 / 3) < 1e-6, `fadeIn=2/3*preempt AR${ar}`);
}
// 动画时长范围 AR0=1800ms, AR10=450ms
assert.strictEqual(arToPreempt(0), 1800);
assert.strictEqual(arToPreempt(10), 450);
// AR5 以下相邻整数差 120ms, 以上差 150ms
assert.strictEqual(arToPreempt(3) - arToPreempt(4), 120);
assert.strictEqual(arToPreempt(7) - arToPreempt(8), 150);

// [Editor] 与往返
const real = parseOsu(`osu file format v14

[Editor]
DistanceSpacing: 1.2
BeatDivisor: 8
GridSize: 4
TimelineZoom: 3

[Events]
0,0,"bg.png",0,0

[HitObjects]
256,192,1000,5,0,0:0:0:0:
`);
assert.strictEqual(real.editor.beatDivisor, 8);
assert.strictEqual(real.editor.timelineZoom, 3);
assert.strictEqual(real.general.background, 'bg.png');
const re = parseOsu(serializeOsu(real));
assert.strictEqual(re.editor.beatDivisor, 8);

console.log('unit tests ok (v5)');
