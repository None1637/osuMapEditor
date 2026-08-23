// 验证器 v156 纯函数测试: timingEdit — activePointAt / snapTimeToRedBeat / metronomeBeats
import { activePointAt, snapTimeToRedBeat, metronomeBeats } from '../../src/osu/timingEdit';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number, beatLength = 500, meter = 4): TimingPoint =>
  ({ time, beatLength, meter, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const green = (time: number, beatLength = -100): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 });

section('activePointAt: 最新 time<=t+1 的点 (不限类型)');
{
  assert(activePointAt([], 1000) === null, '空数组 → null');
  const pts = [red(0), green(1000), green(2000), red(3000)];
  assert(activePointAt(pts, -5) === null, '所有点都在未来 → null');
  assert(activePointAt(pts, 0)!.time === 0, '恰好命中首点');
  assert(activePointAt(pts, 500)!.time === 0, '中间取最近过去点');
  assert(activePointAt(pts, 2500)!.time === 2000, '跨绿线取绿线 (不限类型)');
  assert(activePointAt(pts, 99999)!.time === 3000, '末尾取最后点');
  assert(activePointAt(pts, 2999 + 1)!.time === 3000, 't+1 容差内算命中');
}

section('snapTimeToRedBeat: 吸附到红线节拍网格');
{
  const r = red(1000, 500);
  assert(snapTimeToRedBeat(r, 1000, 4) === 1000, '线上原样');
  // div = 500/4 = 125; 1300 → 1000 + round(2.4)*125 = 1250
  assert(snapTimeToRedBeat(r, 1300, 4) === 1250, '1300 → 1250 (snap=4)');
  // 1400 → 1000 + round(3.2)*125 = 1375
  assert(snapTimeToRedBeat(r, 1400, 4) === 1375, '1400 → 1375');
  // snap=1 (整拍): 1300 → 1000 + round(0.6)*500 = 1500
  assert(snapTimeToRedBeat(r, 1300, 1) === 1500, 'snap=1 整拍吸附');
  // 红线前: 800 → 1000 + round(-0.4)*500 = 1000
  assert(snapTimeToRedBeat(r, 800, 1) === 1000, '红线前反向吸附');
}

section('metronomeBeats: 红线段逐拍 + down 按 meter');
{
  const beats = metronomeBeats([red(0, 500, 4)], 2100);
  assert(beats.length === 5, `单红线 0~2100 共 5 拍 (得 ${beats.length})`);
  assert(beats[0].t === 0 && beats[0].down, '首拍 down');
  assert(beats.filter(b => b.down).map(b => b.t).join() === '0,2000', 'meter=4 → 0/2000 为 down');
  assert(beats.every(b => b.t < 2100), '不超过 songLength');

  const pts = [red(0, 500, 4), green(700), red(2000, 250, 3)];
  const b2 = metronomeBeats(pts, 3000);
  // 红1: 0,500,1000,1500 (2000 被红2截断); 红2: 2000,2250,2500,2750
  assert(b2.length === 8, `双红线共 8 拍 (得 ${b2.length})`);
  assert(b2[4].t === 2000, '红2 从 2000 起');
  assert(b2.filter(b => b.down).map(b => b.t).join() === '0,2000,2750', '红2 meter=3 → 2000/2750 down');

  assert(metronomeBeats([green(0)], 5000).length === 0, '无红线 → 无拍点');
}

if (failures) { console.error(`V156_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V156_TESTS_PASSED');
