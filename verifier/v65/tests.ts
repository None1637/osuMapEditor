// 验证器 v65 纯函数测试: 批量复制 (次数/间隔拍/旋转/向量, 三锚点; 跨 BPM 拍位保持)
import { advanceByBeats, computeDuplicate, DEFAULT_DUPLICATE_PARAMS } from '../../src/osu/duplicate';
import type { Beatmap, HitObject, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const red = (time: number, beatLength: number): TimingPoint => ({
  time, beatLength, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0,
});
const circle = (id: number, x: number, y: number, time: number, extra: Partial<HitObject> = {}): HitObject => ({
  id, type: 'circle', x, y, time, comboSkip: 0, hitSound: 0, ...extra,
});
const mkBm = (points: TimingPoint[], hitObjects: HitObject[]): Beatmap =>
  ({ timingPoints: points, hitObjects, difficulty: { sliderMultiplier: 1.4 } }) as unknown as Beatmap;

section('advanceByBeats: 逐红线段换算, 跨 BPM 保持拍位');
{
  const pts = [red(0, 500)];
  assert(advanceByBeats(pts, 2500, 1) === 3000, '单红线 +1 拍');
  assert(advanceByBeats(pts, 0, 0.5) === 250, '半拍');
  const two = [red(0, 500), red(2000, 250)];
  assert(advanceByBeats(two, 1500, 2) === 2250, `跨红线 2 拍 (1500+500+250=2250, 实际 ${advanceByBeats(two, 1500, 2)})`);
  assert(advanceByBeats(two, 2500, 1) === 2750, '第二红线段内 1 拍');
}

section('computeDuplicate: 基本复制 (次数×间隔, 原物件不动)');
{
  const objs = [circle(90001, 100, 100, 1000), circle(90002, 150, 100, 1500)];
  const bm = mkBm([red(0, 500)], objs);
  const out = computeDuplicate(bm, objs, 'selection', { ...DEFAULT_DUPLICATE_PARAMS, count: 2, intervalBeats: 1 });
  assert(out.length === 4, '2 源 × 2 次 = 4 副本');
  assert(out.every(o => !objs.some(s => s.id === o.id)), '副本全部新 id');
  // i=1: +500ms => 1500,2000; i=2: +1000ms => 2000,2500
  const times = out.map(o => o.time).sort((a, b) => a - b);
  assert(times.join(',') === '1500,2000,2000,2500', `时间 +1/+2 拍 (实际 ${times})`);
  assert(out.every(o => o.x === 100 || o.x === 150), '无旋转向量时位置不变');
  assert(objs[0].time === 1000 && objs.length === 2, '源物件未被修改');
}

section('computeDuplicate: 旋转锚点三模式 + 平移累积');
{
  const objs = [circle(1, 306, 192, 1000)];
  const bm = mkBm([red(0, 500)], objs);
  // 游玩区中心 (256,192) 顺时针 90°: (306,192) -> (256,242)
  const r1 = computeDuplicate(bm, objs, 'playfield', { ...DEFAULT_DUPLICATE_PARAMS, count: 1, intervalBeats: 1, rotateDeg: 90 });
  assert(r1[0].x === 256 && r1[0].y === 242, `游玩区锚点旋转 (${r1[0].x},${r1[0].y})`);
  // 自定义锚点 (306,192) 旋转 90° => 原地
  const r2 = computeDuplicate(bm, objs, { x: 306, y: 192 }, { ...DEFAULT_DUPLICATE_PARAMS, count: 1, intervalBeats: 1, rotateDeg: 90 });
  assert(r2[0].x === 306 && r2[0].y === 192, '自定义锚点 = 物件位置时旋转不动');
  // 平移累积: 第 i 份 +i×(dx,dy)
  const r3 = computeDuplicate(bm, objs, 'selection', { ...DEFAULT_DUPLICATE_PARAMS, count: 3, intervalBeats: 1, dx: 10, dy: -5 });
  assert(r3[0].x === 316 && r3[1].x === 326 && r3[2].x === 336 && r3[2].y === 177,
    `平移累积 (${r3.map(o => `${o.x},${o.y}`).join(' / ')})`);
  // 旋转累积: 第 2 份 = 180°
  const r4 = computeDuplicate(bm, objs, 'playfield', { ...DEFAULT_DUPLICATE_PARAMS, count: 2, intervalBeats: 1, rotateDeg: 90 });
  assert(r4[1].x === 206 && r4[1].y === 192, `第 2 份旋转 180° (${r4[1].x},${r4[1].y})`);
}

section('computeDuplicate: 滑条控制点/红锚点保留 + 转盘只动时间');
{
  const slider: HitObject = {
    id: 1, type: 'slider', x: 100, y: 100, time: 1000, endTime: 1500,
    curveType: 'B', curvePoints: [{ x: 150, y: 100 }, { x: 150, y: 150, red: true } as never], slides: 1, length: 100,
  } as unknown as HitObject;
  const spinner = circle(2, 256, 192, 2000, { type: 'spinner', endTime: 3000 });
  const bm = mkBm([red(0, 500)], [slider, spinner]);
  const out = computeDuplicate(bm, [slider, spinner], 'playfield', { ...DEFAULT_DUPLICATE_PARAMS, count: 1, intervalBeats: 2, rotateDeg: 90 });
  const sl = out.find(o => o.type === 'slider')!;
  assert(sl.time === 2000 && sl.endTime === 2500, `滑条时间 +2 拍 (${sl.time}-${sl.endTime})`);
  assert(sl.curvePoints!.length === 2 && (sl.curvePoints![1] as { red?: boolean }).red === true, '控制点数量与红锚点保留');
  assert(sl.length === 100, '旋转平移不改滑条长度');
  const sp = out.find(o => o.type === 'spinner')!;
  assert(sp.x === 256 && sp.y === 192 && sp.time === 3000 && sp.endTime === 4000, '转盘位置固定, 时间/endTime 平移');
  // 只选转盘 + 选区锚点 => 无锚点返回 []
  assert(computeDuplicate(bm, [spinner], 'selection', DEFAULT_DUPLICATE_PARAMS).length === 0, '只选转盘时选区锚点无效 => []');
}

if (failures) { console.error(`\nTESTS_V65_FAILED: ${failures}`); process.exit(1); }
console.log('\nTESTS_V65_ALL_PASSED');
