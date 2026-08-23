// 验证器 v145 纯函数测试: 锁定间距共享纯函数 (distanceLockRef / distanceLockDistance / previewSpacingInfo)
import { distanceLockRef, distanceLockDistance, previewSpacingInfo } from '../../src/osu/spacing';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
function near(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) < eps; }

const bmBase = (): Beatmap => ({
  version: 14, general: {}, editor: { distanceSpacing: 1, beatDivisor: 4, gridSize: 8, timelineZoom: 1 },
  metadata: {}, difficulty: { hp: 5, cs: 4, od: 5, ar: 5, sliderMultiplier: 1, sliderTickRate: 1 },
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
  hitObjects: [],
} as unknown as Beatmap);
const circle = (id: number, x: number, y: number, time: number): HitObject =>
  ({ id, type: 'circle', x, y, time, hitSound: 0, newCombo: false, comboSkip: 0 } as unknown as HitObject);
const slider = (id: number, x: number, y: number, cps: { x: number; y: number }[], length: number, slides: number, time: number): HitObject =>
  ({ id, type: 'slider', x, y, time, hitSound: 0, newCombo: false, comboSkip: 0, curveType: 'L', curvePoints: cps, length, slides } as unknown as HitObject);
// sliderMultiplier=1, beatLength=500 => 100px/拍 => 200px 滑条 1 折返 = 1000ms

section('distanceLockRef: 单点参考 = 头部位置/时刻');
{
  const bm = bmBase();
  bm.hitObjects = [circle(1, 200, 100, 1000)];
  const r = distanceLockRef(bm, 3000)!;
  assert(r.endX === 200 && r.endY === 100 && r.endTime === 1000, `circle 参考 (200,100)@1000 (实际 ${JSON.stringify(r)})`);
  assert(distanceLockRef(bm, 500) === null, '首件之前无参考');
  assert(distanceLockRef(bm, 1001) !== null, 'time+1 容差边界命中');
}

section('distanceLockRef: 滑条参考 = 结束时刻 + 折返奇偶头尾 (修复 endTime 恒 undefined 的 bug)');
{
  const bm = bmBase();
  // 1 折返 200px: 结束 2000, 尾 (350,300)
  bm.hitObjects = [slider(10, 150, 300, [{ x: 350, y: 300 }], 200, 1, 1000)];
  assert(distanceLockRef(bm, 1500) === null, '滑条进行中 (1500 < 结束 2000) 不作为参考 (旧逻辑误用开始时刻 1000)');
  const r1 = distanceLockRef(bm, 2500)!;
  assert(r1.endTime === 2000 && r1.endX === 350 && r1.endY === 300, `1 折返尾 (350,300)@2000 (实际 ${JSON.stringify(r1)})`);
  // 2 折返: 结束 3000, 尾回头 = 头 (150,300)
  bm.hitObjects = [slider(11, 150, 300, [{ x: 350, y: 300 }], 200, 2, 1000)];
  const r2 = distanceLockRef(bm, 3500)!;
  assert(r2.endTime === 3000 && r2.endX === 150 && r2.endY === 300, `2 折返尾回头 (150,300)@3000 (实际 ${JSON.stringify(r2)})`);
}

section('distanceLockRef: exclude 跳过被拖物件, 取再前一件');
{
  const bm = bmBase();
  bm.hitObjects = [circle(20, 100, 100, 1000), circle(21, 300, 100, 2000)];
  const r = distanceLockRef(bm, 2000, new Set([21]))!;
  assert(r.endTime === 1000 && r.endX === 100, `排除 21 后参考 20 (实际 ${JSON.stringify(r)})`);
  assert(distanceLockRef(bm, 2000, new Set([20, 21])) === null, '全排除则无参考');
}

section('distanceLockDistance: DS * 100 * 间隔拍数, 下限 0 (v211: 移除 0.25 拍下限, 对齐 lazer 无下限)');
{
  const bm = bmBase();
  bm.editor.distanceSpacing = 1.2;
  assert(near(distanceLockDistance(bm, 1000, 2000), 240), `2 拍 => 240 (实际 ${distanceLockDistance(bm, 1000, 2000)})`);
  assert(near(distanceLockDistance(bm, 1900, 2000), 24), `0.2 拍 => 按比例 24 (实际 ${distanceLockDistance(bm, 1900, 2000)})`);
  assert(near(distanceLockDistance(bm, 3000, 2000), 0), '负间隔按下限 0');
}

section('previewSpacingInfo: 预览点与参考件结束位置的间距倍率/像素距离');
{
  const bm = bmBase();
  bm.hitObjects = [circle(30, 200, 100, 1000)];
  const pv = previewSpacingInfo(bm, { x: 320.4, y: 100 }, 2000); // 距参考 120.4px, 2 拍 DS=1 => 期望 200
  assert(pv.x === 320 && pv.y === 100, `坐标圆整 (实际 ${pv.x},${pv.y})`);
  assert(pv.prevPx === 120 && pv.prev !== null && near(pv.prev, 0.6, 0.01), `0.60x(120px) (实际 ${pv.prev?.toFixed(2)}x(${pv.prevPx}px))`);
  const pv0 = previewSpacingInfo(bmBase(), { x: 50.6, y: 60.2 }, 1000);
  assert(pv0.prev === null && pv0.prevPx === null && pv0.x === 51 && pv0.y === 60, '无参考时倍率/像素为 null, 坐标仍圆整');
  // 滑条参考: 预览点距滑条尾端 (非头部)
  const bm2 = bmBase();
  bm2.hitObjects = [slider(40, 150, 300, [{ x: 350, y: 300 }], 200, 1, 1000)];
  const pv2 = previewSpacingInfo(bm2, { x: 350, y: 400 }, 3000); // 尾 (350,300), 距 100px, 结束 2000 -> 2 拍期望 200
  assert(pv2.prevPx === 100 && pv2.prev !== null && near(pv2.prev, 0.5, 0.01), `滑条尾参考 0.50x(100px) (实际 ${pv2.prev?.toFixed(2)}x(${pv2.prevPx}px))`);
}

if (failures) { console.error(`\nV145_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV145_TESTS_ALL_PASSED');
