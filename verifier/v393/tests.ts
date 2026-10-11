// 验证器 v393 纯函数测试: pattern 库「不记录物件音效」勾选框
import { parseOsu, type Beatmap, type HitObject, type TimingPoint } from '../../src/osu/parser';
import { makePattern, instantiatePattern } from '../../src/osu/patternLibrary';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number, beatLength = 500): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });

const mkBm = (): Beatmap => {
  const bm = parseOsu('osu file format v14\n\n[General]\nAudioFilename: a.mp3\n\n[Metadata]\nTitle:t\nArtist:a\nCreator:c\nVersion:v\n\n[Difficulty]\nHPDrainRate:5\nCircleSize:4\nOverallDifficulty:8\nApproachRate:9\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n\n[HitObjects]\n');
  bm.timingPoints = [red(0)];
  bm.hitObjects = [];
  return bm;
};

const circle: HitObject = {
  id: 1, type: 'circle', x: 100, y: 200, time: 500,
  hitSound: 12, newCombo: true, comboSkip: 2,
  hitSampleRaw: '2:3:80:0:normal-hitfinish.wav',
};
const slider: HitObject = {
  id: 2, type: 'slider', x: 200, y: 200, time: 1000,
  hitSound: 4, newCombo: false, comboSkip: 0,
  curveType: 'B', curvePoints: [{ x: 300, y: 200 }], slides: 2, length: 140,
  hitSampleRaw: '1:0:70', edgeSoundsRaw: '2|4', edgeSetsRaw: '2:1|2:2',
};

section('makePattern: 默认记录音效 (回归基线)');
{
  const p = makePattern('p1', 't', mkBm(), [circle, slider]);
  assert(p.objects[0].hitSound === 12 && p.objects[1].hitSound === 4, 'hitSound 原样记录');
  assert(p.objects[0].hitSampleRaw === circle.hitSampleRaw, 'hitSampleRaw 原样记录');
  assert(p.objects[1].edgeSoundsRaw === '2|4' && p.objects[1].edgeSetsRaw === '2:1|2:2', '滑条边音效原样记录');
  assert(p.objects[0].newCombo === true && p.objects[0].comboSkip === 2, 'newCombo/comboSkip 原样记录');
}

section('makePattern: noHitsound 剥掉音效');
{
  const p = makePattern('p2', 't', mkBm(), [circle, slider], undefined, { noHitsound: true });
  assert(p.objects.every(o => o.hitSound === 0), 'hitSound 全部归零');
  assert(p.objects.every(o => o.hitSampleRaw === undefined), 'hitSampleRaw 不记录');
  assert(p.objects.every(o => o.edgeSoundsRaw === undefined && o.edgeSetsRaw === undefined), '滑条边音效不记录');
  assert(p.objects[0].newCombo === true && p.objects[0].comboSkip === 2, 'newCombo/comboSkip 仍记录 (不属于音效)');
  assert(p.objects[1].curveType === 'B' && p.objects[1].slides === 2, '曲线数据不受影响');
}

section('instantiatePattern: 无音效 pattern 落盘 = 默认音效');
{
  const bm = mkBm();
  const p = makePattern('p3', 't', bm, [circle, slider], undefined, { noHitsound: true });
  const r = instantiatePattern(p, bm, { x: 50, y: 50 }, 0, { greenlineAlign: false, scaleAlign: false });
  assert(r.objects.every(o => (o.hitSound ?? 0) === 0), '落盘物件 hitSound = 0');
  assert(r.objects.every(o => o.hitSampleRaw === undefined && o.edgeSoundsRaw === undefined), '落盘物件无采样/边音效原文');
}

if (failures) { console.error(`V393_TESTS_FAILED (${failures})`); process.exit(1); }
console.log('V393_TESTS_ALL_PASSED');
