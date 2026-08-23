// 验证器 v68 纯函数测试: 批量复制绿线副本 + 预览合并
import { parseOsu, type Beatmap, type HitObject, type TimingPoint } from '../../src/osu/parser';
import { computeDuplicateTiming, DEFAULT_DUPLICATE_PARAMS } from '../../src/osu/duplicate';
import { mergedWithPreview } from '../../src/osu/renderer';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number): TimingPoint => ({ time, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const green = (time: number, volume = 60): TimingPoint => ({ time, beatLength: -100, meter: 4, sampleSet: 2, sampleIndex: 0, volume, uninherited: false, effects: 0 });
const circle = (id: number, time: number): HitObject => ({ id, type: 'circle', x: 100, y: 100, time, hitSound: 0, newCombo: false, comboOffset: 0 });
const slider = (id: number, time: number, endTime: number): HitObject => ({
  id, type: 'slider', x: 200, y: 200, time, endTime, hitSound: 0, newCombo: false, comboOffset: 0,
  curveType: 'L', curvePoints: [{ x: 300, y: 200 }], slides: 1, length: 100,
});
// parseOsu 不便注入物件, 直接构造最小 Beatmap
function beatmap(tps: TimingPoint[], objs: HitObject[]): Beatmap {
  const bm = parseOsu('osu file format v14\n\n[General]\nAudioFilename: a.mp3\n\n[Metadata]\nTitle:t\nArtist:a\nCreator:c\nVersion:v\n\n[Difficulty]\nHPDrainRate:5\nCircleSize:4\nOverallDifficulty:8\nApproachRate:9\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n\n[HitObjects]\n');
  bm.timingPoints = tps;
  bm.hitObjects = objs;
  return bm;
}

section('computeDuplicateTiming: 开关与范围');
{
  const bm = beatmap([red(0), green(1000), green(1400, 70), green(3000)], [slider(1, 1000, 1600)]);
  const objs = bm.hitObjects;
  // 关 => 空
  assert(computeDuplicateTiming(bm, objs, { ...DEFAULT_DUPLICATE_PARAMS, count: 2, intervalBeats: 1, copyGreenLines: false }).length === 0, '勾选关 => 不复制');
  // 开 => 滑条 [1000,1600] 内 2 条绿线 × 2 份; 3000 范围外不复制
  const out = computeDuplicateTiming(bm, objs, { ...DEFAULT_DUPLICATE_PARAMS, count: 2, intervalBeats: 1, copyGreenLines: true });
  assert(out.length === 4, `2 条范围内绿线 × 2 份 = 4 (实际 ${out.length})`);
  assert(out.every(t => !t.uninherited), '副本仍为绿线');
  // 第 1 份 +1 拍 (500ms): 1500/1900; 第 2 份 +2 拍: 2000/2400
  const times = out.map(t => t.time).sort((a, b) => a - b);
  assert(JSON.stringify(times) === JSON.stringify([1500, 1900, 2000, 2400]), `按拍偏移 (实际 ${times})`);
  // 字段保留 (音量/sampleSet)
  const v70 = out.find(t => t.time === 1900);
  assert(v70?.volume === 70 && v70.sampleSet === 2 && v70.beatLength === -100, '绿线字段保留');
}

section('computeDuplicateTiming: 单点取该刻绿线 + 共享去重');
{
  // 两个同时刻单点共享一条绿线 => 只复制一次
  const bm = beatmap([red(0), green(1000)], [circle(1, 1000), circle(2, 1000)]);
  const out = computeDuplicateTiming(bm, bm.hitObjects, { ...DEFAULT_DUPLICATE_PARAMS, count: 1, intervalBeats: 2, copyGreenLines: true });
  assert(out.length === 1 && out[0].time === 2000, `共享绿线去重, +2 拍 = 2000 (实际 ${JSON.stringify(out.map(t => t.time))})`);
  // 单点范围 [t,t]: 绿线在物件稍后 100ms => 不复制
  const bm2 = beatmap([red(0), green(1100)], [circle(1, 1000)]);
  assert(computeDuplicateTiming(bm2, bm2.hitObjects, { ...DEFAULT_DUPLICATE_PARAMS, count: 1, intervalBeats: 1, copyGreenLines: true }).length === 0, '单点范围外绿线不复制');
}

section('computeDuplicateTiming: 跨红线保持拍位');
{
  // 第二红线 BPM 加倍 (beatLength 250): 1400 的绿线 +1 拍 = 0.2 拍到 1500 + 0.8×250 = 1700
  const bm = beatmap([red(0), { ...red(1500), beatLength: 250 }, green(1400)], [circle(1, 1400)]);
  const out = computeDuplicateTiming(bm, bm.hitObjects, { ...DEFAULT_DUPLICATE_PARAMS, count: 1, intervalBeats: 1, copyGreenLines: true });
  assert(out.length === 1 && out[0].time === 1700, `跨红线拍位 (实际 ${out[0]?.time})`);
}

section('mergedWithPreview: 绿线副本预览合并 + 排序');
{
  const bm = beatmap([red(0), green(1000)], [circle(1, 1000)]);
  const prev = { hideIds: [], objects: [circle(99, 1500)], timingPoints: [green(1500), green(500)] };
  const v = mergedWithPreview(bm, prev);
  assert(v.hitObjects.length === 2, '物件合并');
  assert(v.timingPoints.length === 4 && v.timingPoints[1].time === 500 && v.timingPoints[2].time === 1000 && v.timingPoints[3].time === 1500, '绿线合并排序');
  assert(bm.timingPoints.length === 2, '原谱面不被修改');
  // 无 timingPoints 的预览 => 用原 timingPoints (引用不变)
  const v2 = mergedWithPreview(bm, { hideIds: [], objects: [circle(98, 1500)] });
  assert(v2.timingPoints === bm.timingPoints, '无绿线预览时引用不变');
}

if (failures) { console.error(`\nTESTS_V68_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V68_ALL_PASSED');
