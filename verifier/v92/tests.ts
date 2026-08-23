// 验证器 v92 纯函数测试: makePattern group 参数 — 收藏到当前选中分类
import { parseOsu, type Beatmap, type TimingPoint } from '../../src/osu/parser';
import { makePattern, DEFAULT_GROUP } from '../../src/osu/patternLibrary';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number, beatLength = 500): TimingPoint => ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const mkBm = (tps: TimingPoint[]): Beatmap => {
  const bm = parseOsu('osu file format v14\n\n[General]\nAudioFilename: a.mp3\n\n[Metadata]\nTitle:t\nArtist:a\nCreator:c\nVersion:v\n\n[Difficulty]\nHPDrainRate:5\nCircleSize:4\nOverallDifficulty:8\nApproachRate:9\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n\n[HitObjects]\n');
  bm.timingPoints = tps;
  bm.hitObjects = [];
  return bm;
};

section('makePattern: group 参数');
{
  const bm = mkBm([red(0)]);
  const objs = [
    { id: 1, type: 'circle' as const, x: 100, y: 100, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0 },
    { id: 2, type: 'circle' as const, x: 164, y: 100, time: 1500, hitSound: 0, newCombo: false, comboSkip: 0 },
  ];
  const p0 = makePattern('p0', 'a', bm, objs);
  assert(p0.group === DEFAULT_GROUP, `缺省 = 未分类 (实际 ${p0.group})`);
  const p1 = makePattern('p1', 'b', bm, objs, 'G1');
  assert(p1.group === 'G1', `传 G1 => 归 G1 (实际 ${p1.group})`);
  assert(p1.objects.length === 2 && p1.svPxPerBeat === 140, 'group 参数不影响内容 (物件数/等效 SV 不变)');
}

if (failures) { console.error(`\nTESTS_V92_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V92_ALL_PASSED');
