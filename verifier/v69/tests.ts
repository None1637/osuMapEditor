// 验证器 v69 纯函数测试: objectEndAt — 滑条时长按给定 timing 的头部 SV 推导 (预览合并绿线后长度正确)
import { parseOsu, type Beatmap, type TimingPoint } from '../../src/osu/parser';
import { objectEndAt, mergedWithPreview } from '../../src/osu/renderer';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number): TimingPoint => ({ time, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const green = (time: number, beatLength: number): TimingPoint => ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 });
const SM = 1.4;
const sliderObj = (time: number, length = 100, slides = 1) => ({ type: 'slider', time, length, slides });

section('objectEndAt: 基本推导');
{
  const tps = [red(0)];
  // sv 1: vel = 100*1.4/500 = 0.28 px/ms → 100px = 357.14ms
  assert(Math.abs(objectEndAt(tps, SM, sliderObj(1000)) - (1000 + 100 / 0.28)) < 0.01, 'SV 1 时长');
  // sv 0.5: 时长翻倍
  const withGreen = [red(0), green(500, -200)];
  assert(Math.abs(objectEndAt(withGreen, SM, sliderObj(1000)) - (1000 + 200 / 0.28)) < 0.01, 'SV 0.5 时长翻倍');
  assert(Math.abs(objectEndAt(tps, SM, sliderObj(1000, 100, 2)) - (1000 + 200 / 0.28)) < 0.01, '折返数乘时长');
  assert(objectEndAt(tps, SM, { type: 'circle', time: 800 }) === 800, '单点 = time');
  assert(objectEndAt(tps, SM, { type: 'spinner', time: 800, endTime: 1500 }) === 1500, '转盘用 endTime');
  assert(objectEndAt(tps, SM, { type: 'spinner', time: 800 }) === 1800, '转盘无 endTime 兜底 +1000');
}

section('mergedWithPreview + objectEndAt: 复制绿线改变副本时长');
{
  const bm = parseOsu('osu file format v14\n\n[General]\nAudioFilename: a.mp3\n\n[Metadata]\nTitle:t\nArtist:a\nCreator:c\nVersion:v\n\n[Difficulty]\nHPDrainRate:5\nCircleSize:4\nOverallDifficulty:8\nApproachRate:9\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n\n[HitObjects]\n') as Beatmap;
  // v148 适配: SV 不再被红线重置 (lazer 语义), 目标区要回到 SV 1 必须显式加复位绿线 green(1600,-100)
  bm.timingPoints = [red(0), green(1000, -200), red(1500), green(1600, -100)]; // 源在 0.5x 区, 目标区 SV 1
  bm.hitObjects = [];
  const copy = sliderObj(2000); // 副本落在 SV 1 区
  // 不复制绿线: 副本时长 = SV 1 (357ms)
  const v1 = mergedWithPreview(bm, { hideIds: [], objects: [copy as never] });
  const endOff = objectEndAt(v1.timingPoints, SM, copy);
  assert(Math.abs(endOff - (2000 + 100 / 0.28)) < 0.01, `不复制绿线 => 短 (实际 ${(endOff - 2000).toFixed(0)}ms)`);
  // 复制绿线: 副本自带 0.5x => 时长翻倍 (714ms)
  const v2 = mergedWithPreview(bm, { hideIds: [], objects: [copy as never], timingPoints: [green(2000, -200)] });
  const endOn = objectEndAt(v2.timingPoints, SM, copy);
  assert(Math.abs(endOn - (2000 + 200 / 0.28)) < 0.01, `复制绿线 => 长 (实际 ${(endOn - 2000).toFixed(0)}ms)`);
}

if (failures) { console.error(`\nTESTS_V69_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V69_ALL_PASSED');
