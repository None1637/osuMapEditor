import assert from 'node:assert';
import { parseOsu, serializeOsu, csToRadius, arToPreempt, arToFadeIn, timingAt, sliderVelocityAt, type Beatmap } from '../../src/osu/parser';
import { SliderPath } from '../../src/osu/sliderPath';
import { createSampleBeatmap } from '../../src/osu/sampleBeatmap';

const bm: Beatmap = createSampleBeatmap();
assert.ok(bm.hitObjects.length >= 20);
assert.strictEqual(bm.difficulty.cs, 4);
assert.strictEqual(bm.difficulty.ar, 9);
const types = new Set(bm.hitObjects.map(o => o.type));
assert.ok(types.has('circle') && types.has('slider') && types.has('spinner'));
const curveTypes = new Set(bm.hitObjects.filter(o => o.type === 'slider').map(o => o.curveType));
assert.ok(curveTypes.has('L') && curveTypes.has('P') && curveTypes.has('B') && curveTypes.has('C'));

// CS/AR 官方公式
assert.ok(Math.abs(csToRadius(4) - 36.48) < 0.01);
assert.strictEqual(arToPreempt(9), 600);
assert.strictEqual(arToPreempt(5), 1200);
assert.strictEqual(arToPreempt(10), 450);
assert.strictEqual(arToPreempt(0), 1800);
assert.strictEqual(arToFadeIn(9), 400);
assert.strictEqual(arToFadeIn(5), 800);

// timing 查询
const t14 = timingAt(bm.timingPoints, 14000);
assert.ok(t14.red.beatLength === 500);
assert.ok(t14.green && t14.green.beatLength === -50);
const v1 = sliderVelocityAt(bm.timingPoints, 14000, 1.4);
assert.ok(Math.abs(v1 - (100 * 1.4 * 2) / 500) < 1e-9);
// 恰好在绿线时间点
const t13 = timingAt(bm.timingPoints, 13000);
assert.ok(t13.green && t13.green.effects === 1, '13000ms 绿线 kiai 位');

// 滑条路径
const lp = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 100);
assert.ok(Math.abs(lp.totalLength - 100) < 2);
const pp = new SliderPath('P', [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }], Math.PI * 50);
assert.ok(Math.abs(pp.totalLength - Math.PI * 50) < 5);
assert.ok(pp.positionAt(Math.PI * 25).y > 40);
const bp = new SliderPath('B', [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }], 200);
assert.ok(bp.totalLength > 100);
const bp2 = new SliderPath('B', [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 100 }], 250);
assert.ok(bp2.totalLength > 100);
// 节点编辑场景: 修改控制点后重建路径
const bp3 = new SliderPath('B', [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }], 200);
assert.ok(Math.abs(bp3.totalLength - bp.totalLength) < 2, '相同控制点路径一致');

// 序列化往返
const text = serializeOsu(bm);
const bm2 = parseOsu(text);
assert.strictEqual(bm2.hitObjects.length, bm.hitObjects.length);
assert.strictEqual(bm2.timingPoints.length, bm.timingPoints.length);
// 转盘往返
const sp1 = bm.hitObjects.find(o => o.type === 'spinner')!;
const sp2 = bm2.hitObjects.find(o => o.type === 'spinner')!;
assert.strictEqual(sp1.endTime, sp2.endTime, '转盘结束时间保留');
// kiai effects 往返
const kiai = bm2.timingPoints.find(t => t.effects === 1);
assert.ok(kiai, 'kiai 标记保留');

console.log('unit tests ok (v2)');
