// 验证器 v62 纯函数测试: 插入默认克隆生效点 (lazer ControlPointList.addNew) + effects 位操作
import { defaultNewPoint, effectivePointAt, setEffectBit, EFFECT_KIAI, EFFECT_OMIT_BARLINE } from '../../src/osu/timingEdit';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const tp = (time: number, beatLength: number, uninherited: boolean, extra: Partial<TimingPoint> = {}): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited, effects: 0, ...extra,
});

section('effectivePointAt: 同类中 time<=t 的最后一条');
{
  const pts = [
    tp(0, 500, true), tp(2000, 400, true),
    tp(1000, -200, false, { sampleSet: 3, sampleIndex: 2, volume: 45, effects: 1 }),
    tp(3000, -100, false),
  ];
  assert(effectivePointAt(pts, 1500, false)?.time === 1000, '绿线 @1500 -> 1000');
  assert(effectivePointAt(pts, 1500, true)?.time === 0, '红线 @1500 -> 0 (不混类)');
  assert(effectivePointAt(pts, 5000, false)?.time === 3000, '绿线 @5000 -> 3000');
  assert(effectivePointAt(pts, -1, true) === null, '首条之前 -> null');
}

section('defaultNewPoint: 克隆生效点全部字段 (lazer 克隆语义)');
{
  const pts = [
    tp(1000, -200, false, { sampleSet: 3, sampleIndex: 2, volume: 45, effects: EFFECT_KIAI }),
    tp(0, 500, true, { meter: 3, volume: 60 }),
  ];
  const g = defaultNewPoint(pts, 2500, false);
  assert(g.time === 2500 && g.uninherited === false, '绿线插入时间=当前时间');
  assert(g.beatLength === -200 && g.sampleSet === 3 && g.sampleIndex === 2 && g.volume === 45 && (g.effects & EFFECT_KIAI) !== 0,
    `克隆绿线 SV/音效集/序号/音量/kiai (实际 ${JSON.stringify(g)})`);
  const r = defaultNewPoint(pts, 2500, true);
  assert(r.beatLength === 500 && r.meter === 3 && r.volume === 60, `克隆红线 beatLength/拍号/音量 (实际 ${JSON.stringify(r)})`);
}

section('defaultNewPoint: 无同类点 -> 格式常规默认 (红 120BPM / 绿 1.00x)');
{
  const g = defaultNewPoint([], 1000, false);
  assert(g.beatLength === -100 && g.sampleSet === 1 && g.volume === 80 && g.effects === 0, '绿线默认 -100/set1/vol80/fx0');
  const r = defaultNewPoint([], 1000, true);
  assert(r.beatLength === 500 && r.meter === 4, '红线默认 500ms/meter4');
}

section('setEffectBit: kiai bit0 / omitBarline bit3');
{
  assert(setEffectBit(0, EFFECT_KIAI, true) === 1, 'kiai 置位');
  assert(setEffectBit(1, EFFECT_KIAI, false) === 0, 'kiai 清位');
  assert(setEffectBit(0, EFFECT_OMIT_BARLINE, true) === 8, 'omit 置位');
  assert(setEffectBit(9, EFFECT_OMIT_BARLINE, false) === 1, 'omit 清位保留 kiai');
  assert(setEffectBit(8, EFFECT_KIAI, true) === 9, 'kiai 置位保留 omit');
}

if (failures) { console.error(`\nTESTS_V62_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V62_ALL_PASSED');
