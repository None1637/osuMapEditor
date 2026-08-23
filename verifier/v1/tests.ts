import assert from 'node:assert';
import { parseOsu, serializeOsu, csToRadius, arToPreempt, timingAt, sliderVelocityAt, type Beatmap } from '../../src/osu/parser';
import { SliderPath } from '../../src/osu/sliderPath';
import { createSampleBeatmap } from '../../src/osu/sampleBeatmap';

// 1. 解析示例谱面
const bm: Beatmap = createSampleBeatmap();
assert.ok(bm.hitObjects.length >= 20, '物件数量');
assert.strictEqual(bm.difficulty.cs, 4);
assert.strictEqual(bm.difficulty.ar, 9);
assert.ok(bm.timingPoints.length >= 4, 'timing点数量');
const types = new Set(bm.hitObjects.map(o => o.type));
assert.ok(types.has('circle') && types.has('slider') && types.has('spinner'), '包含三类物件');
const curveTypes = new Set(bm.hitObjects.filter(o => o.type === 'slider').map(o => o.curveType));
assert.ok(curveTypes.has('L') && curveTypes.has('P') && curveTypes.has('B') && curveTypes.has('C'), '包含L/P/B/C滑条');

// 2. CS/AR 换算 (osu 官方公式)
assert.ok(Math.abs(csToRadius(4) - 36.48) < 0.01, 'CS4半径');
assert.strictEqual(arToPreempt(9), 600);
assert.strictEqual(arToPreempt(5), 1200);
assert.strictEqual(arToPreempt(10), 450);
assert.strictEqual(arToPreempt(0), 1800);

// 3. timing 查询
const t14 = timingAt(bm.timingPoints, 14000);
assert.ok(t14.red.beatLength === 500, '14000ms红线仍为500');
assert.ok(t14.green && t14.green.beatLength === -50, '14000ms绿线-50 (2x SV)');
const t22 = timingAt(bm.timingPoints, 22000);
assert.ok(Math.abs(t22.red.beatLength - 375) < 1e-9, '22000ms红线375');
const v1 = sliderVelocityAt(bm.timingPoints, 14000, 1.4);
assert.ok(Math.abs(v1 - (100 * 1.4 * 2) / 500) < 1e-9, 'SV 2x 速度');

// 4. 滑条路径
// 直线
const lp = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 100);
assert.ok(Math.abs(lp.totalLength - 100) < 2, '直线长度');
const mid = lp.positionAt(50);
assert.ok(Math.abs(mid.x - 50) < 2 && Math.abs(mid.y) < 2, '直线中点');
// 圆弧: 半圆 (0,0)->(50,50)->(100,0), 长度=π*50
const pp = new SliderPath('P', [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }], Math.PI * 50);
assert.ok(Math.abs(pp.totalLength - Math.PI * 50) < 5, '圆弧长度');
const top = pp.positionAt(Math.PI * 25);
assert.ok(top.y > 40, '圆弧顶点在中部上方');
// 贝塞尔
const bp = new SliderPath('B', [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }], 200);
assert.ok(bp.totalLength > 100, '贝塞尔长度大于弦长');
const bmid = bp.positionAt(bp.totalLength / 2);
assert.ok(bmid.y > 20, '贝塞尔中点上凸');
// 贝塞尔红点分段
const bp2 = new SliderPath('B', [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 100 }], 250);
assert.ok(bp2.totalLength > 100, '红点分段贝塞尔有效');

// 5. 序列化往返
const text = serializeOsu(bm);
const bm2 = parseOsu(text);
assert.strictEqual(bm2.hitObjects.length, bm.hitObjects.length, '往返后物件数一致');
assert.strictEqual(bm2.timingPoints.length, bm.timingPoints.length, '往返后timing数一致');
const s1 = bm.hitObjects.find(o => o.type === 'slider' && o.curveType === 'P')!;
const s2 = bm2.hitObjects.find(o => o.type === 'slider' && o.curveType === 'P')!;
assert.strictEqual(s1.curvePoints!.length, s2.curvePoints!.length, '圆弧滑条控制点保留');

// 6. kiai / 难度参数编辑路径 (serialize 含 difficulty)
assert.ok(text.includes('CircleSize: 4') && text.includes('ApproachRate: 9'), '序列化含难度参数');

console.log('unit tests ok');
