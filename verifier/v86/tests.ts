// 验证器 v86 纯函数测试: pattern 库 — 节拍换算/收藏/放置 (对齐选项)
import { parseOsu, type Beatmap, type TimingPoint } from '../../src/osu/parser';
import {
  beatTimeAt, msAtBeat, pxPerBeatAt, svAt, makePattern, instantiatePattern, patternBeats,
  DEFAULT_GROUP, type StoredPattern,
} from '../../src/osu/patternLibrary';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number, beatLength = 500): TimingPoint => ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const green = (time: number, beatLength: number): TimingPoint => ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: false, effects: 0 });
const SM = 1.4;

const mkBm = (tps: TimingPoint[]): Beatmap => {
  const bm = parseOsu('osu file format v14\n\n[General]\nAudioFilename: a.mp3\n\n[Metadata]\nTitle:t\nArtist:a\nCreator:c\nVersion:v\n\n[Difficulty]\nHPDrainRate:5\nCircleSize:4\nOverallDifficulty:8\nApproachRate:9\nSliderMultiplier:1.4\nSliderTickRate:1\n\n[TimingPoints]\n\n[HitObjects]\n');
  bm.timingPoints = tps;
  bm.hitObjects = [];
  return bm;
};

section('beatTimeAt / msAtBeat: 单红线与变 BPM');
{
  const tps = [red(0)];
  assert(beatTimeAt(tps, 1000) === 2, '单红线 1000ms = 2 拍');
  assert(msAtBeat(tps, 2) === 1000, '2 拍 = 1000ms');
  const tps2 = [red(0), red(1000, 250)]; // 1000ms 后 BPM 翻倍
  assert(beatTimeAt(tps2, 1500) === 4, `变 BPM: 1500ms = 4 拍 (实际 ${beatTimeAt(tps2, 1500)})`);
  assert(msAtBeat(tps2, 3) === 1250, '变 BPM: 3 拍 = 1250ms');
  for (const ms of [0, 500, 1000, 1700, 3333]) {
    assert(Math.abs(msAtBeat(tps2, beatTimeAt(tps2, ms)) - ms) < 1e-6, `round-trip ${ms}ms`);
  }
  const tps3 = [red(1000)];
  assert(beatTimeAt(tps3, 500) === -1, '首红线前 = 负拍');
  assert(msAtBeat(tps3, -1) === 500, '负拍 round-trip');
}

section('pxPerBeatAt / svAt');
{
  assert(pxPerBeatAt([red(0)], SM, 100) === 140, '无绿线 = 100*1.4');
  assert(pxPerBeatAt([red(0), green(0, -200)], SM, 100) === 70, '0.5x 绿线 = 70');
  assert(svAt([red(0)], 100) === 1 && svAt([red(0), green(0, -50)], 100) === 2, 'svAt 1 / 2');
}

section('makePattern: 时序按节拍, 位置相对首物件');
{
  const bm = mkBm([red(0)]);
  bm.hitObjects = [
    { id: 1, type: 'circle', x: 100, y: 100, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0 },
    { id: 2, type: 'circle', x: 164, y: 100, time: 1500, hitSound: 4, newCombo: false, comboSkip: 0 },
    { id: 3, type: 'slider', x: 200, y: 200, time: 2000, curveType: 'L', curvePoints: [{ x: 300, y: 200 }], slides: 1, length: 140, hitSound: 0, newCombo: false, comboSkip: 0 },
    { id: 4, type: 'spinner', x: 256, y: 192, time: 3000, endTime: 4000, hitSound: 0, newCombo: true, comboSkip: 0 },
  ];
  const p = makePattern('pt1', 'test', bm, bm.hitObjects);
  assert(p.group === DEFAULT_GROUP, '默认分类 = 未分类');
  assert(p.svPxPerBeat === 140, 'pattern 等效 SV = 140');
  assert(p.objects.length === 4, '4 物件');
  assert(p.objects[0].beatOffset === 0 && p.objects[1].beatOffset === 1, `单点节拍偏移 0/1 (实际 ${p.objects[0].beatOffset}/${p.objects[1].beatOffset})`);
  assert(p.objects[1].dx === 64 && p.objects[1].dy === 0, '位置相对首物件');
  assert(p.objects[1].hitSound === 4, 'hitsound 保留');
  const sl = p.objects[2];
  assert(sl.beatsLen === 1, `滑条占 1 拍 (实际 ${sl.beatsLen})`);
  assert(sl.pixelLength === 140 && sl.svPxPerBeat === 140, '滑条像素长/等效 SV');
  assert(sl.curvePoints![0].x === 100 && sl.curvePoints![0].y === 0, '控制点相对滑条头');
  assert(p.objects[3].beatsDuration === 2, '转盘占 2 拍');
  assert(patternBeats(p) === 6, `pattern 全长 6 拍 (实际 ${patternBeats(p)})`);
}

section('instantiatePattern: 都不勾 = 原样复制 (跨 BPM 保节拍)');
{
  const src = mkBm([red(0)]);
  src.hitObjects = [
    { id: 1, type: 'circle', x: 100, y: 100, time: 1000, hitSound: 0, newCombo: true, comboSkip: 0 },
    { id: 2, type: 'circle', x: 164, y: 100, time: 1500, hitSound: 0, newCombo: false, comboSkip: 0 },
  ];
  const p = makePattern('pt2', 'a', src, src.hitObjects);
  const dst = mkBm([red(0, 250)]); // 240 BPM
  const r = instantiatePattern(p, dst, { x: 200, y: 200 }, 0, { greenlineAlign: false, scaleAlign: false });
  assert(r.objects[0].time === 0 && r.objects[1].time === 250, `间隔一拍 => 250ms (实际 ${r.objects[1].time})`);
  assert(r.objects[0].x === 200 && r.objects[1].x === 264, '位置平移');
  assert(r.greenlines.length === 0, '无绿线');
  assert(r.objects[0].newCombo === true && r.objects[1].newCombo === false, 'newCombo 保留');
}

section('instantiatePattern: 跨变 BPM 保节拍结构');
{
  const src = mkBm([red(0), red(1000, 250)]); // 源: 物件分别在 0ms(第0拍) 与 1500ms(第4拍)
  src.hitObjects = [
    { id: 1, type: 'circle', x: 100, y: 100, time: 0, hitSound: 0, newCombo: true, comboSkip: 0 },
    { id: 2, type: 'circle', x: 100, y: 100, time: 1500, hitSound: 0, newCombo: false, comboSkip: 0 },
  ];
  const p = makePattern('pt3', 'b', src, src.hitObjects);
  assert(p.objects[1].beatOffset === 4, '第二物件在第 4 拍');
  const dst = mkBm([red(0), red(2000, 125)]); // 目标: 2000ms 后 BPM 再翻倍
  const r = instantiatePattern(p, dst, { x: 100, y: 100 }, 0, { greenlineAlign: false, scaleAlign: false });
  // 第 4 拍: 2000ms 处是第 4 拍 => time = 2000
  assert(r.objects[1].time === 2000, `跨变 BPM 展开 => 2000ms (实际 ${r.objects[1].time})`);
}

section('instantiatePattern: 缩放滑条对齐 (保占拍数)');
{
  const src = mkBm([red(0)]);
  src.hitObjects = [
    { id: 1, type: 'slider', x: 100, y: 100, time: 0, curveType: 'L', curvePoints: [{ x: 240, y: 100 }], slides: 1, length: 140, hitSound: 0, newCombo: true, comboSkip: 0 },
  ];
  const p = makePattern('pt4', 'c', src, src.hitObjects); // 占 1 拍, px/beat 140
  const dst = mkBm([red(0, 250), green(0, -200)]); // 目标: 0.5x => px/beat 70
  const r = instantiatePattern(p, dst, { x: 100, y: 100 }, 0, { greenlineAlign: false, scaleAlign: true });
  const o = r.objects[0];
  assert(Math.abs((o.length ?? 0) - 70) < 0.01, `长度缩放 140->70 (实际 ${o.length})`);
  assert(o.curvePoints![0].x === 170, `控制点等比缩放 (实际 ${o.curvePoints![0].x})`);
  // 校验: 70px / (70px/beat / 250ms) = 250ms = 1 拍 ✓
  assert(r.greenlines.length === 0, '缩放模式无绿线');
}

section('instantiatePattern: 插入绿线对齐 (开头对齐 + 结尾还原)');
{
  const src = mkBm([red(0), green(-1, -50)]); // 收藏时 2x => px/beat 280 (绿线在起点前, 不算内部绿线)
  src.hitObjects = [
    { id: 1, type: 'slider', x: 100, y: 100, time: 0, curveType: 'L', curvePoints: [{ x: 380, y: 100 }], slides: 1, length: 280, hitSound: 0, newCombo: true, comboSkip: 0 },
  ];
  const p = makePattern('pt5', 'd', src, src.hitObjects);
  assert(p.svPxPerBeat === 280 && p.objects[0].beatsLen === 1, '收藏: 2x 下 1 拍');
  const dst = mkBm([red(0, 250)]); // 目标 SV 1
  const r = instantiatePattern(p, dst, { x: 100, y: 100 }, 0, { greenlineAlign: true, scaleAlign: false });
  assert(r.greenlines.length === 2, '两条绿线 (对齐+还原)');
  const [g0, g1] = r.greenlines;
  assert(g0.time === 0 && Math.abs(g0.beatLength - -50) < 1e-9, `开头绿线 sv=2 (实际 ${g0.beatLength})`);
  assert(g0.uninherited === false, '绿线非继承');
  assert(g1.time === 250 && Math.abs(g1.beatLength - -100) < 1e-9, `结尾还原 sv=1 (实际 ${g1.beatLength})`);
  assert(r.objects[0].length === 280, '滑条像素长不动');
  // 还原值跟随结尾处原 SV: 目标结尾在 0.5x 区 => 还原 -200
  const dst2 = mkBm([red(0, 250), green(0, -200)]);
  const r2 = instantiatePattern(p, dst2, { x: 100, y: 100 }, 0, { greenlineAlign: true, scaleAlign: false });
  assert(Math.abs(r2.greenlines[1].beatLength - -200) < 1e-9, `结尾还原 sv=0.5 (实际 ${r2.greenlines[1].beatLength})`);
}

section('instantiatePattern: 转盘与 sv 钳制');
{
  const src = mkBm([red(0)]);
  src.hitObjects = [
    { id: 1, type: 'spinner', x: 256, y: 192, time: 0, endTime: 1000, hitSound: 0, newCombo: true, comboSkip: 0 },
  ];
  const p = makePattern('pt6', 'e', src, src.hitObjects);
  const dst = mkBm([red(0, 250)]);
  const r = instantiatePattern(p, dst, { x: 256, y: 192 }, 0, { greenlineAlign: false, scaleAlign: false });
  assert(r.objects[0].endTime === 500, `转盘 2 拍 => 500ms (实际 ${r.objects[0].endTime})`);
  // sv 钳制: 收藏 svPxPerBeat 极大 => 钳到 10
  const big: StoredPattern = { ...p, svPxPerBeat: 100 * SM * 99 };
  const r2 = instantiatePattern(big, dst, { x: 256, y: 192 }, 0, { greenlineAlign: true, scaleAlign: false });
  assert(Math.abs(r2.greenlines[0].beatLength - -10) < 1e-9, `sv 钳 10 (实际 ${r2.greenlines[0].beatLength})`);
}

if (failures) { console.error(`\nTESTS_V86_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V86_ALL_PASSED');
