import assert from 'node:assert';
import { parseOsu, serializeOsu, arToPreempt, timingAt, sliderVelocityAt, type Beatmap } from '../../src/osu/parser';
import { SliderPath } from '../../src/osu/sliderPath';
import { createSampleBeatmap } from '../../src/osu/sampleBeatmap';

const bm: Beatmap = createSampleBeatmap();
assert.ok(bm.hitObjects.length >= 20);
const curveTypes = new Set(bm.hitObjects.filter(o => o.type === 'slider').map(o => o.curveType));
assert.ok(curveTypes.has('L') && curveTypes.has('P') && curveTypes.has('B') && curveTypes.has('C'));
assert.strictEqual(arToPreempt(9), 600);
const v1 = sliderVelocityAt(bm.timingPoints, 14000, 1.4);
assert.ok(Math.abs(v1 - (100 * 1.4 * 2) / 500) < 1e-9);
const pp = new SliderPath('P', [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }], Math.PI * 50);
assert.ok(Math.abs(pp.totalLength - Math.PI * 50) < 5);
const text = serializeOsu(bm);
const bm2 = parseOsu(text);
assert.strictEqual(bm2.hitObjects.length, bm.hitObjects.length);
assert.strictEqual(bm2.timingPoints.length, bm.timingPoints.length);

// v3 新增: [Events] 背景解析
const withBg = parseOsu(`osu file format v14

[General]
AudioFilename: song.mp3

[Events]
//Background and Video events
0,0,"bg image.jpg",0,0
//Break Periods

[TimingPoints]
0,500,4,1,0,80,1,0

[HitObjects]
256,192,1000,5,0,0:0:0:0:
`);
assert.strictEqual(withBg.general.background, 'bg image.jpg', '带引号背景文件名');
assert.strictEqual(withBg.general.audioFilename, 'song.mp3');
const withBg2 = parseOsu(`osu file format v14

[Events]
0,0,bg.png,0,0

[HitObjects]
256,192,1000,5,0,0:0:0:0:
`);
assert.strictEqual(withBg2.general.background, 'bg.png', '无引号背景文件名');
// kiai timing
const t13 = timingAt(bm.timingPoints, 13000);
assert.ok(t13.green && t13.green.effects === 1);

console.log('unit tests ok (v3)');
