import assert from 'node:assert';
import { parseOsu, serializeOsu, arToPreempt, sliderVelocityAt, type Beatmap } from '../../src/osu/parser';
import { SliderPath } from '../../src/osu/sliderPath';
import { createSampleBeatmap } from '../../src/osu/sampleBeatmap';

// 核心回归
const bm: Beatmap = createSampleBeatmap();
assert.ok(bm.hitObjects.length >= 20);
const curveTypes = new Set(bm.hitObjects.filter(o => o.type === 'slider').map(o => o.curveType));
assert.ok(curveTypes.has('L') && curveTypes.has('P') && curveTypes.has('B') && curveTypes.has('C'));
assert.strictEqual(arToPreempt(9), 600);
assert.ok(Math.abs(sliderVelocityAt(bm.timingPoints, 14000, 1.4) - 0.56) < 1e-9);
const pp = new SliderPath('P', [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }], Math.PI * 50);
assert.ok(Math.abs(pp.totalLength - Math.PI * 50) < 5);

// v4: 用户提供的真实谱面片段 (含 [Editor] 与完整 General/Metadata)
const real = parseOsu(`osu file format v14

[General]
AudioFilename: audio.mp3
AudioLeadIn: 0
PreviewTime: -1
Countdown: 0
SampleSet: Normal
StackLeniency: 0.7
Mode: 0
LetterboxInBreaks: 0
WidescreenStoryboard: 1

[Editor]
DistanceSpacing: 1
BeatDivisor: 4
GridSize: 8
TimelineZoom: 2

[Metadata]
Title:Odorobo
TitleUnicode:Odorobo
Artist:Umicha feat. Kotonoha Sisters with Zundamon
ArtistUnicode:Umicha feat. Kotonoha Sisters with Zundamon
Creator:Mapperatorinator
Version:ai1
Source:
Tags:difficulty=10.0 year=2023 hitsounded=True seed=526
BeatmapID:0
BeatmapSetID:-1

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:10
ApproachRate:10
SliderMultiplier:3.2
SliderTickRate:1

[Events]
0,0,"bg.png",0,0

[TimingPoints]
-200,500,4,2,0,60,1,0

[HitObjects]
256,192,1000,5,0,0:0:0:0:
`);
assert.strictEqual(real.general.audioFilename, 'audio.mp3');
assert.strictEqual(real.general.sampleSet, 'Normal');
assert.strictEqual(real.general.widescreenStoryboard, 1);
assert.ok(Math.abs(real.general.stackLeniency - 0.7) < 1e-9);
assert.strictEqual(real.editor.distanceSpacing, 1);
assert.strictEqual(real.editor.beatDivisor, 4);
assert.strictEqual(real.editor.gridSize, 8);
assert.strictEqual(real.editor.timelineZoom, 2);
assert.strictEqual(real.metadata.title, 'Odorobo');
assert.strictEqual(real.metadata.tags, 'difficulty=10.0 year=2023 hitsounded=True seed=526');
assert.strictEqual(real.metadata.beatmapSetID, '-1');
assert.strictEqual(real.general.background, 'bg.png');
assert.strictEqual(real.difficulty.sliderMultiplier, 3.2);
assert.strictEqual(real.difficulty.ar, 10);

// 序列化往返保留 [Editor] 与新字段
const out = serializeOsu(real);
const re = parseOsu(out);
assert.strictEqual(re.editor.timelineZoom, 2, 'TimelineZoom 往返');
assert.strictEqual(re.editor.gridSize, 8, 'GridSize 往返');
assert.strictEqual(re.editor.distanceSpacing, 1, 'DistanceSpacing 往返');
assert.strictEqual(re.general.sampleSet, 'Normal', 'SampleSet 往返');
assert.strictEqual(re.general.widescreenStoryboard, 1, 'WidescreenStoryboard 往返');
assert.strictEqual(re.metadata.tags, real.metadata.tags, 'Tags 往返');
assert.strictEqual(re.metadata.beatmapSetID, '-1', 'BeatmapSetID 往返');

// 示例谱面默认 editor 值
assert.strictEqual(bm.editor.beatDivisor, 4);

console.log('unit tests ok (v4)');
