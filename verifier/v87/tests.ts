// 验证器 v87 纯函数测试: pattern 内部绿线 — 收藏记录 + 两种对齐模式都以正确倍率插入
import { parseOsu, type Beatmap, type TimingPoint } from '../../src/osu/parser';
import { makePattern, instantiatePattern, svAt, type StoredPattern } from '../../src/osu/patternLibrary';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number, beatLength = 500): TimingPoint => ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const green = (time: number, beatLength: number): TimingPoint => ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 });

const mkBm = (tps: TimingPoint[]): Beatmap => {
  const bm = parseOsu('osu file format v14\n\n[General]\nAudioFilename: a.mp3\n\n[Metadata]\nTitle:t\nArtist:a\nCreator:c\nVersion:v\n\n[Difficulty]\nHPDrainRate:5\nCircleSize:4\nOverallDifficulty:8\nApproachRate:9\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n\n[HitObjects]\n');
  bm.timingPoints = tps;
  bm.hitObjects = [];
  return bm;
};

// 用户场景: 两个滑条, 第二个被 0.5x 绿线覆盖 (拍长均 1 拍, 像素长 140/70)
const slider = (id: number, x: number, time: number, length: number) => ({
  id, type: 'slider' as const, x, y: 100, time, curveType: 'L',
  curvePoints: [{ x: x + length, y: 100 }], slides: 1, length, hitSound: 0, newCombo: id === 1, comboSkip: 0,
});
const srcBm = () => {
  const bm = mkBm([red(0), green(500, -200)]);
  bm.hitObjects = [slider(1, 100, 0, 140), slider(2, 100, 500, 70)];
  return bm;
};

section('makePattern: 记录覆盖时间段内的绿线');
{
  const p = makePattern('pg1', 'g', srcBm(), srcBm().hitObjects);
  assert(p.greenlines?.length === 1, `记录 1 条内部绿线 (实际 ${p.greenlines?.length})`);
  assert(p.greenlines![0].beatOffset === 1 && p.greenlines![0].sv === 0.5, `beat 1 处 sv=0.5 (实际 ${JSON.stringify(p.greenlines![0])})`);
  assert(p.objects[0].beatsLen === 1 && p.objects[1].beatsLen === 1, '两滑条各占 1 拍');
  assert(p.objects[1].svPxPerBeat === 70, '第二滑条等效 SV = 70');
  // 时间段外的绿线不记
  const bm2 = mkBm([red(0), green(500, -200), green(9999, -50)]);
  bm2.hitObjects = [slider(1, 100, 0, 140), slider(2, 100, 500, 70)];
  const p2 = makePattern('pg2', 'g2', bm2, bm2.hitObjects);
  assert(p2.greenlines?.length === 1, '段外绿线不记录');
}

section('插入绿线对齐: 内部绿线同倍率插入 (开头对齐压过同时间内部线)');
{
  const p = makePattern('pg3', 'g', srcBm(), srcBm().hitObjects);
  const dst = mkBm([red(0)]); // 目标无绿线
  const r = instantiatePattern(p, dst, { x: 100, y: 100 }, 0, { greenlineAlign: true, scaleAlign: false });
  assert(r.greenlines.length === 3, `3 条绿线 = 内部1 + 开头对齐 + 结尾还原 (实际 ${r.greenlines.length})`);
  const at = (t: number) => r.greenlines.filter(g => g.time === t).map(g => g.beatLength);
  assert(at(500).includes(-200), `内部绿线 500ms sv=0.5 (实际 ${JSON.stringify(at(500))})`);
  assert(at(0).includes(-100), `开头对齐 sv=1 (实际 ${JSON.stringify(at(0))})`);
  assert(at(1000).includes(-100), `结尾 1000ms 还原 sv=1 (实际 ${JSON.stringify(at(1000))})`);
  // 合并后第二滑条处生效 sv = 0.5 (用户场景: 同谱面粘贴长度正确)
  const merged = [...dst.timingPoints, ...r.greenlines].sort((a, b) => a.time - b.time);
  assert(svAt(merged, r.objects[1].time) === 0.5, '落盘后第二滑条生效 sv=0.5');
  assert(r.objects[0].length === 140 && r.objects[1].length === 70, '像素长原样 => 时长各 1 拍');
}

section('缩放滑条对齐: 内部绿线参与等效速度计算');
{
  const p = makePattern('pg4', 'g', srcBm(), srcBm().hitObjects);
  const dst = mkBm([red(0)]); // 目标无绿线, SV 1
  const r = instantiatePattern(p, dst, { x: 100, y: 100 }, 0, { greenlineAlign: false, scaleAlign: true });
  // 第一滑条: 目标 sv 1 => scale = 1*140/140 = 1; 第二: 内部绿线 0.5x => scale = 1*70/70 = 1 (不算内部线会错成 2)
  assert(Math.abs((r.objects[0].length ?? 0) - 140) < 0.01, `第一滑条 scale=1 (实际 ${r.objects[0].length})`);
  assert(Math.abs((r.objects[1].length ?? 0) - 70) < 0.01, `第二滑条 scale=1 含内部绿线 (实际 ${r.objects[1].length})`);
  assert(r.greenlines.length === 1 && r.greenlines[0].time === 500 && r.greenlines[0].beatLength === -200,
    `缩放模式也插入内部绿线 (实际 ${JSON.stringify(r.greenlines)})`);
  // 目标 BPM 不同: 240BPM 下占拍不变, 第二滑条长度仍按 0.5x 展开
  const dst2 = mkBm([red(0, 250)]);
  const r2 = instantiatePattern(p, dst2, { x: 100, y: 100 }, 0, { greenlineAlign: false, scaleAlign: true });
  assert(Math.abs((r2.objects[0].length ?? 0) - 140) < 0.01 && Math.abs((r2.objects[1].length ?? 0) - 70) < 0.01,
    `240BPM 下长度仍 140/70 (实际 ${r2.objects[0].length}/${r2.objects[1].length})`);
  assert(r2.objects[1].time === 250 && r2.greenlines[0].time === 250, '内部绿线落在 beat 1 = 250ms');
}

section('都不勾: 不插入内部绿线, 原样复制');
{
  const p = makePattern('pg5', 'g', srcBm(), srcBm().hitObjects);
  const dst = mkBm([red(0)]);
  const r = instantiatePattern(p, dst, { x: 100, y: 100 }, 0, { greenlineAlign: false, scaleAlign: false });
  assert(r.greenlines.length === 0, '无绿线');
  assert(r.objects[0].length === 140 && r.objects[1].length === 70, '长度原样');
}

section('旧 pattern 无 greenlines 字段 => 按空处理');
{
  const legacy: StoredPattern = { id: 'l', name: 'l', group: '未分类', createdAt: 0, svPxPerBeat: 140, objects: [] };
  const r = instantiatePattern(legacy, mkBm([red(0)]), { x: 0, y: 0 }, 0, { greenlineAlign: true, scaleAlign: true });
  assert(r.greenlines.length === 2, '旧数据仅开头+结尾两条 (无内部线)');
}

if (failures) { console.error(`\nTESTS_V87_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V87_ALL_PASSED');
