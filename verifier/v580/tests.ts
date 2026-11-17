import { computeMerge } from '../../src/osu/convert/merge';
import { measureSegments } from '../../src/osu/convert/bezierPath';
import type { Beatmap, HitObject, Vec2 } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const bm = {
  timingPoints: [{ time: 0, beatLength: 500, uninherited: true, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, effects: 0 }],
  difficulty: { sliderMultiplier: 1 }, editor: { beatDivisor: 1 },
} as unknown as Beatmap;
const circle = (id: number, x: number, y: number, time: number): HitObject => ({ id, type: 'circle', x, y, time, hitSound: 0 });
const slider = (id: number, time: number, pts: Vec2[], length?: number, curveType = 'L'): HitObject => ({
  id, type: 'slider', x: pts[0].x, y: pts[0].y, time, curveType,
  curvePoints: pts.slice(1).map(p => ({ ...p })), slides: 1, length, hitSound: 0,
});
const points = (o: HitObject) => [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];

{
  // 原逻辑会拼到 (200,0); 实际尾只在 (50,0)
  const s = slider(1, 1000, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], 50);
  const r = computeMerge(bm, [s, circle(2, 50, 0, 2000)])!;
  const pts = points(r);
  assert(pts.every(p => p.x <= 50), `直线按 pixelLength 截尾, 不含后续锚点 (${JSON.stringify(pts)})`);
  assert(pts[pts.length - 1].x === 50 && pts[pts.length - 1].y === 0, '合并尾精确落在实际滑条尾');
}

{
  const curve = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }];
  const half = measureSegments([curve]).total / 2;
  const s = slider(1, 1000, curve, half, 'B');
  const r = computeMerge(bm, [s, circle(2, 100, 50, 2000)])!;
  const pts = points(r);
  assert(!pts.some(p => p.x === 200 && p.y === 0), '二次贝塞尔尾部之后的末锚点不拼入');
  assert(pts.some(p => p.x === 50 && p.y === 50), 'de Casteljau 左半控制柄保留原曲线形状');
  assert(pts[pts.length - 1].x === 100 && pts[pts.length - 1].y === 50, '曲线在中点精确截尾');
}

{
  const a = slider(1, 1000, [{ x: 0, y: 0 }, { x: 100, y: 0 }], 40);
  const b = slider(2, 2000, [{ x: 100, y: 0 }, { x: 200, y: 0 }], 60);
  const r = computeMerge(bm, [a, b])!;
  const pts = points(r);
  assert(pts[pts.length - 1].x === 160, `每条源滑条都各自截尾, 第二段止于 160 而非 200 (${pts[pts.length - 1].x})`);
  assert(pts.some(p => p.x === 40), '第一条尾到第二条头之间仍正确接缝');
}

{
  const s = slider(1, 1000, [{ x: 0, y: 0 }, { x: 200, y: 0 }], undefined);
  const r = computeMerge(bm, [s, circle(2, 250, 0, 2000)])!;
  assert(r.curvePoints!.some(p => p.x === 200), 'pixelLength 缺失时保留完整路径');
}

if (failures) { console.error(`V580_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V580_TESTS_PASSED');
