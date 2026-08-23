// 验证器 v45 纯函数测试: 框选可见过滤 / 方向性节拍 seek (lazer EditorClock.seek) /
// 选区坐标与 Prev/Next 间距 (锁定间距同单位) / follow points (lazer FollowPointConnection)
import { seekByBeats } from '../../src/osu/seekSnapping';
import { followPointPairs, followPointsBetween, followPointFadeTimes, stackedEndPosition, FP_SPACING, FP_PREEMPT } from '../../src/osu/followPoints';
import { selectionSpacingInfo, spacingMultiplier } from '../../src/osu/spacing';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number, beatLength: number): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const circle = (id: number, x: number, y: number, time: number, newCombo = false): HitObject =>
  ({ id, type: 'circle', x, y, time, hitSound: 0, newCombo, comboSkip: 0 });
const lineSlider = (id: number, x1: number, x2: number, y: number, time: number, slides = 1, newCombo = false): HitObject => ({
  id, type: 'slider', x: x1, y, time, hitSound: 0, newCombo, comboSkip: 0,
  curveType: 'L', curvePoints: [{ x: x2, y }], slides, length: Math.abs(x2 - x1),
});

const mkBm = (hitObjects: HitObject[], timingPoints = [red(1000, 500)]): Beatmap => ({
  formatVersion: 14,
  general: { audioFilename: 'a.mp3', audioLeadIn: 0, previewTime: -1, countdown: 0, sampleSet: 'Normal', stackLeniency: 0.7, mode: 0, letterboxInBreaks: 0, widescreenStoryboard: 1, background: '' },
  editor: { distanceSpacing: 1, beatDivisor: 4, gridSize: 8, timelineZoom: 2 },
  metadata: { title: '', titleUnicode: '', artist: '', artistUnicode: '', creator: '', version: '', source: '', tags: '', beatmapID: '0', beatmapSetID: '-1' },
  difficulty: { hp: 5, cs: 4, od: 8, ar: 5, sliderMultiplier: 1.4, sliderTickRate: 1 },
  timingPoints, hitObjects,
  colors: { combos: [], sliderBorder: '', sliderTrackOverride: '' },
});

section('seekByBeats: 单红线 500ms, divisor 4 (步长 125)');
{
  const tp = [red(1000, 500)];
  assert(seekByBeats(tp, 4, 1000, 1) === 1125, '网格点上向前 -> 下一格 1125');
  assert(seekByBeats(tp, 4, 1125, 1) === 1250, '1125 向前 -> 1250');
  assert(seekByBeats(tp, 4, 1100, 1) === 1125, '非网格 1100 向前吸附 -> 1125 (floor)');
  assert(seekByBeats(tp, 4, 1125, -1) === 1000, '1125 向后 -> 1000 (ceil)');
  assert(seekByBeats(tp, 4, 1100, -1) === 1000, '非网格 1100 向后吸附 -> 1000');
  assert(seekByBeats(tp, 4, 1000, -1) === 875, '红线上向后 -> 875 (首条红线可越界退)');
  assert(seekByBeats(tp, 4, 1000, 1, 4) === 1500, 'Shift 4 倍: 1000 -> 1500');
  assert(seekByBeats(tp, 4, 100, -1) === 0, '向后钳到 0');
  assert(seekByBeats([], 4, 1000, 1) === 1000, '无红线不动');
}

section('seekByBeats: 双红线 (1000/500, 2000/250), divisor 1');
{
  const tp = [red(1000, 500), red(2000, 250)];
  assert(seekByBeats(tp, 1, 1950, 1) === 2000, '向前不越过下一条红线: 1950 -> 2000');
  assert(seekByBeats(tp, 1, 2000, 1) === 2250, '新红线上向前 -> 2250 (新 beatLength)');
  assert(seekByBeats(tp, 1, 2000, -1) === 1500, '红线边界向后用目标侧红线: 2000 -> 1500');
  const tp2 = [red(1000, 500), red(2000, 250)];
  assert(seekByBeats(tp2, 4, 2010, -1) === 2000, '向后不越过本红线起点: 2010 -> 2000');
}

section('followPointPairs: newCombo / 转盘断链');
{
  const bm = mkBm([
    circle(1, 100, 100, 1000, true), circle(2, 300, 100, 1500),
    circle(3, 100, 300, 2000, true), circle(4, 300, 300, 2500),
    { id: 5, type: 'spinner', x: 256, y: 192, time: 3000, endTime: 4000, hitSound: 0, newCombo: false, comboSkip: 0 },
    circle(6, 200, 200, 4500),
  ]);
  const pairs = followPointPairs(bm).map(p => `${p.start.id}->${p.end.id}`);
  assert(pairs.join(',') === '1->2,3->4', `连接对 = 1->2, 3->4 (实际 ${pairs.join(',')})`);
}

section('followPointsBetween: 点位/时刻/动画 (lazer FollowPointConnection)');
{
  const bm = mkBm([circle(1, 100, 100, 1000), circle(2, 300, 100, 2000)]);
  const [c1, c2] = bm.hitObjects;
  // distance=200: d = 48,80,112,144 (< 200-32=168), fractions 0.24/0.4/0.56/0.72
  const dots = followPointsBetween(bm, c1, c2, 1700); // 四点全部滑入到位 (末点 1720 到位)
  assert(dots.length === 4, `200px 间距 4 个点 (实际 ${dots.length})`);
  const xs = dots.map(d => Math.round(d.x));
  assert(xs.join(',') === '148,180,212,244', `点位 x = 148,180,212,244 (实际 ${xs.join(',')})`);
  assert(dots.every(d => d.y === 100 && Math.abs(d.rot) < 1e-9), '点位 y=100, 角度=0 (指向后一件)');
  // fadeOut = 1000 + fraction*1000; fadeIn = fadeOut - 800 (AR5 preempt1200 -> min(1,1200/450)=1)
  const f = followPointFadeTimes(1000, 2000, 0.24, 1200);
  assert(f.fadeOutTime === 1240 && f.fadeInTime === 440, `fadeTimes fraction=0.24 -> 440/1240 (实际 ${f.fadeInTime}/${f.fadeOutTime})`);
  assert(FP_SPACING === 32 && FP_PREEMPT === 800, 'SPACING=32, PREEMPT=800');
  // 各自 fadeOut 时刻: 恰好到位 (alpha=1, scale=1, x=fraction 位置)
  const at1240 = followPointsBetween(bm, c1, c2, 1240);
  assert(at1240[0].alpha === 1 && Math.abs(at1240[0].x - 148) < 1e-9 && Math.abs(at1240[0].scale - 1) < 1e-9,
    `d=48 在 fadeOut=1240 到位 (实际 alpha=${at1240[0].alpha}, x=${at1240[0].x}, scale=${at1240[0].scale})`);
  // 时间窗外不绘制
  assert(followPointsBetween(bm, c1, c2, 439).length === 0, '首点 fadeIn=440 之前无点');
  // 淡入中 (d=48: aIn=(840-440)/800=0.5): 可见 3 点 (d=144 fadeIn=920 未现), 位置在 128..148 间, scale 1..1.5
  const mid = followPointsBetween(bm, c1, c2, 840);
  assert(mid.length === 3, `840ms 时 3 个点 (实际 ${mid.length})`);
  assert(Math.abs(mid[0].alpha - 0.5) < 1e-9, `淡入中 alpha=0.5 (实际 ${mid[0]?.alpha})`);
  assert(mid[0].x > 128 && mid[0].x < 148 && mid[0].scale > 1 && mid[0].scale < 1.5,
    `滑入中: x 在 128..148 之间, scale 1..1.5 (实际 x=${mid[0].x.toFixed(1)}, scale=${mid[0].scale.toFixed(2)})`);
  // 淡出: d=48 fadeOut=1240, time=1640 -> aOut=0.5, 位置已到位
  const out = followPointsBetween(bm, c1, c2, 1640);
  assert(Math.abs(out[0].alpha - 0.5) < 1e-9 && Math.abs(out[0].x - 148) < 1e-9, `淡出中 alpha=0.5 且位置已到位 (实际 ${out[0].alpha}, ${out[0].x})`);
  // 尾部窗口: d=48 可见至 1240+800=2040, d=144 至 1720+800=2520
  assert(followPointsBetween(bm, c1, c2, 2041).length === 3, '2041ms: d=48 已消散, 剩 3 点');
  assert(followPointsBetween(bm, c1, c2, 2600).length === 0, '全部淡出后无点');
  // 距离不足: 100px -> d=48 < 100-32=68 -> 仅 1 点; 60px -> 无点
  const bmClose = mkBm([circle(1, 100, 100, 1000), circle(2, 160, 100, 2000)]);
  assert(followPointsBetween(bmClose, bmClose.hitObjects[0], bmClose.hitObjects[1], 2000).length === 0, '60px 间距无点');
}

section('stackedEndPosition: 滑条折返奇偶');
{
  const bm = mkBm([lineSlider(1, 100, 300, 100, 1000, 1), lineSlider(2, 100, 300, 300, 1000, 2)]);
  const e1 = stackedEndPosition(bm, bm.hitObjects[0]);
  const e2 = stackedEndPosition(bm, bm.hitObjects[1]);
  assert(Math.abs(e1.x - 300) < 1e-6 && Math.abs(e1.y - 100) < 1e-6, `slides=1 尾端 (300,100) (实际 ${e1.x},${e1.y})`);
  assert(Math.abs(e2.x - 100) < 1e-6 && Math.abs(e2.y - 300) < 1e-6, `slides=2 回头部 (100,300) (实际 ${e2.x},${e2.y})`);
  const off = new Map([[1, { dx: -6.4, dy: -6.4 }]]);
  const e1s = stackedEndPosition(bm, bm.hitObjects[0], off);
  assert(Math.abs(e1s.x - 293.6) < 1e-6, '堆叠偏移叠加');
}

section('spacingMultiplier / selectionSpacingInfo: 锁定间距同单位');
{
  // v149 适配: 1x 基准含 SliderMultiplier (本 mkBm SM=1.4, lazer DurationToDistance 同源),
  // 即 1x = DS*140px/拍 — 原断言值 (基准 DS*100px/拍) 全部除以 1.4
  const bm = mkBm([
    circle(1, 100, 100, 1000, true), circle(2, 200, 100, 1500), circle(3, 300, 100, 2000),
  ]);
  assert(Math.abs(spacingMultiplier(bm, 1000, 1500, 100)! - 100 / 140) < 1e-9, '100px / 1拍@500ms / DS1 / SM1.4 = 0.714x');
  assert(Math.abs(spacingMultiplier(bm, 1000, 1500, 253)! - 253 / 140) < 1e-9, '253px -> 1.807x');
  assert(spacingMultiplier(bm, 1000, 1000, 100) === null, '同刻 (0 拍) -> null');
  const info = selectionSpacingInfo(bm, new Set([2]))!;
  assert(info.x === 200 && info.y === 100, `坐标 = 首件 (200,100) (实际 ${info.x},${info.y})`);
  assert(Math.abs(info.prev! - 100 / 140) < 1e-9 && Math.abs(info.next! - 100 / 140) < 1e-9, `Prev/Next = 0.714x (实际 ${info.prev}/${info.next})`);
  // DS=2 时同距离 = 0.357x (与锁定间距放置 = 1x 自洽)
  bm.editor.distanceSpacing = 2;
  const info2 = selectionSpacingInfo(bm, new Set([2]))!;
  assert(Math.abs(info2.prev! - 100 / 280) < 1e-9, `DS=2 -> 0.357x (实际 ${info2.prev})`);
  bm.editor.distanceSpacing = 1;
  // 多选: 取首/末件外侧
  const info3 = selectionSpacingInfo(bm, new Set([1, 2]))!;
  assert(info3.x === 100 && info3.prev === null && Math.abs(info3.next! - 100 / 140) < 1e-9, `多选: 首件 (100,100), Prev null, Next 0.714x (实际 ${info3.prev}/${info3.next})`);
  // 滑条尾端 -> 下一件: 滑条 (100,100)->(300,100) len200@1000 (SM1.4@500ms -> 尾时间 1714.29),
  // 下一圆 (350,100)@2000 -> 尾端到圆头 dist=50, 间隔 285.71/500=0.5714 拍 -> 50/(140*0.5714)=0.625x
  const bmS = mkBm([lineSlider(1, 100, 300, 100, 1000), circle(2, 350, 100, 2000)]);
  const infoS = selectionSpacingInfo(bmS, new Set([1]))!;
  assert(infoS.next !== null && Math.abs(infoS.next - 0.625) < 1e-6, `滑条末件 Next 按尾端位置/时间算 = 0.625x (实际 ${infoS.next})`);
  assert(selectionSpacingInfo(bm, new Set()) === null, '空选区 -> null');
}

if (failures) { console.error(`\nTESTS_V45_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V45_ALL_PASSED');
