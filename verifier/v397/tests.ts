// 验证器 v397 纯函数测试: 面板前/后位置距离按 1.0x 间距基准 (不受当前 DS 设置影响)
import { spacingMultiplier, selectionSpacingInfo, previewSpacingInfo, distanceLockDistance } from '../../src/osu/spacing';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

const red = (time: number, beatLength = 500): TimingPoint =>
  ({ time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const circle = (id: number, x: number, y: number, time: number): HitObject =>
  ({ id, type: 'circle', x, y, time, hitSound: 0, newCombo: false, comboSkip: 0 });

const bmOf = (ds: number, objs: HitObject[]): Beatmap => ({
  version: 14, general: {}, editor: { distanceSpacing: ds, beatDivisor: 4, gridSize: 8, timelineZoom: 1 },
  metadata: {}, difficulty: { hp: 5, cs: 4, od: 5, ar: 5, sliderMultiplier: 1.4, sliderTickRate: 1 },
  timingPoints: [red(0)], hitObjects: objs,
} as unknown as Beatmap);

section('spacingMultiplier: 基准固定 1.0x (100*SM*SV*拍数)');
{
  const bm = bmOf(1, []); // SM1.4 无绿线: 1.0x 每拍 140px
  assert(near(spacingMultiplier(bm, 1000, 1500, 140)!, 1), 'DS=1: 140px / 1拍 = 1.00x');
  bm.editor.distanceSpacing = 2;
  assert(near(spacingMultiplier(bm, 1000, 1500, 140)!, 1), 'DS=2: 同距离仍 1.00x (不受间距控制影响)');
  bm.editor.distanceSpacing = 0.5;
  assert(near(spacingMultiplier(bm, 1000, 1500, 140)!, 1), 'DS=0.5: 同距离仍 1.00x');
  bm.editor.distanceSpacing = 0;
  assert(near(spacingMultiplier(bm, 1000, 1500, 140)!, 1), 'DS=0: 不再返回 null, 仍 1.00x');
  assert(spacingMultiplier(bm, 1000, 1000, 140) === null, '同刻 (0 拍) -> null (不变)');
}

section('selectionSpacingInfo / previewSpacingInfo: 随 DS 不变');
{
  const objs = [circle(1, 100, 100, 1000), circle(2, 240, 100, 1500)]; // 间距 140px / 1拍 = 1.00x
  const bm = bmOf(1, objs);
  const a = selectionSpacingInfo(bm, new Set([2]))!;
  assert(near(a.prev!, 1), '选中后件: 前位置 = 1.00x');
  bm.editor.distanceSpacing = 3;
  const b = selectionSpacingInfo(bm, new Set([2]))!;
  assert(near(b.prev!, 1), 'DS=3 后: 前位置仍 = 1.00x');
  const pv = previewSpacingInfo(bm, { x: 380, y: 100 }, 2000);
  assert(near(pv.prev!, 1), '放置预览 (距末件 140px/1拍): 1.00x 不受 DS=3 影响');
}

section('distanceLockDistance 不变 (放置仍含 DS)');
{
  const bm = bmOf(2, []);
  assert(near(distanceLockDistance(bm, 1000, 1500), 280), '锁定间距放置: DS=2 SM1.4 1拍 = 280px (不变)');
}

if (failures) { console.error(`V397_TESTS_FAILED (${failures})`); process.exit(1); }
console.log('V397_TESTS_ALL_PASSED');
