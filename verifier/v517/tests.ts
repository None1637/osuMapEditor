// v517: NaN BPM/SV 保存往返、显示、拍点防护与脏指纹
import { parseOsu, serializeOsu, type TimingPoint } from '../../src/osu/parser';
import { beatTicks } from '../../src/osu/beatTicks';
import { metronomeBeats, fmtBpm, fmtSv, fmtTpPrec } from '../../src/osu/timingEdit';
import { dirtyFingerprint } from '../../src/osu/dirtyFingerprint';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const red = (time: number, beatLength: number): TimingPoint => ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });

console.log('== .osu NaN 保存/读回');
{
  const text = `osu file format v14\n\n[General]\n\n[Editor]\n\n[Metadata]\n\n[Difficulty]\n\n[TimingPoints]\n0,NaN,4,1,0,80,1,0\n1000,NaN,4,1,0,80,0,0\n\n[HitObjects]\n`;
  const bm = parseOsu(text);
  assert(bm.timingPoints.length === 2 && bm.timingPoints.every(p => Number.isNaN(p.beatLength)), '红绿线均解析为 NaN');
  const out = serializeOsu(bm);
  assert(out.includes('0,NaN,4,1,0,80,1,0') && out.includes('1000,NaN,4,1,0,80,0,0'), '保存写出字面量 NaN 而非 0/null/默认值');
  const roundTrip = parseOsu(out);
  assert(roundTrip.timingPoints.every(p => Number.isNaN(p.beatLength)), '保存往返保持 NaN');
  const nullBm = { ...bm, timingPoints: bm.timingPoints.map(p => ({ ...p, beatLength: null as unknown as number })) };
  assert(dirtyFingerprint(bm) !== dirtyFingerprint(nullBm), '脏指纹区分 NaN 与 null');
}

console.log('== 拍点生成器遇 NaN 红线跳过且不传播');
{
  const points = [red(0, NaN), red(2000, 500)];
  const ticks = beatTicks(points, 0, 3000, 4);
  assert(ticks.length > 0 && ticks.every(t => Number.isFinite(t.time) && t.time >= 2000), `beatTicks 仅生成后段有限拍点 (${ticks.length})`);
  const metro = metronomeBeats(points, 3000);
  assert(metro.length > 0 && metro.length < 20 && metro.every(b => Number.isFinite(b.t) && b.t >= 2000), `metronomeBeats 不生成 10 万条 NaN (${metro.length})`);
}

console.log('== NaN 显示不伪装成 0');
{
  assert(fmtTpPrec(NaN) === 'NaN', '高精度输入显示 NaN');
  assert(fmtBpm(NaN) === 'NaN', 'BPM 行显示 NaN');
  assert(fmtSv(NaN) === 'NaN', 'SV 行显示 NaN');
  assert(fmtTpPrec(120) === '120' && fmtBpm(500) === '120.000' && fmtSv(-100) === '1.00', '普通数值显示不变');
}

if (failures) { console.error(`V517_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V517_TESTS_PASSED');
