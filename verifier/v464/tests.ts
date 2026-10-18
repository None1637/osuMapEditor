// v464 单元断言: 贝塞尔 ('B') 转 B 样条 ('B4') — bezierAnchorsToBSpline / convertBezierSlidersToBSpline
//   保真度: 转换后 B4 路径与原贝塞尔路径偏差 < 2px (端点 < 1.5px); 红锚点尖角保留 (拐角处不圆化);
//   直线/退化安全; convert* 只动 'B', onlyIds 限定, length/time/id 不变
import { bezierAnchorsToBSpline, convertBezierSlidersToBSpline } from '../../src/osu/convert/convertB4';
import { SliderPath } from '../../src/osu/sliderPath';
import type { Beatmap, HitObject, Vec2 } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// 点到折线最短距离
function distToPolyline(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const vx = b.x - a.x, vy = b.y - a.y, wx = p.x - a.x, wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    let d: number;
    if (c1 <= 0) d = Math.hypot(wx, wy);
    else {
      const c2 = vx * vx + vy * vy;
      if (c2 <= c1) d = Math.hypot(p.x - b.x, p.y - b.y);
      else { const t = c1 / c2; d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t)); }
    }
    if (d < best) best = d;
  }
  return best;
}
function maxDeviation(a: Vec2[], b: Vec2[]): number {
  let m = 0;
  for (const p of a) m = Math.max(m, distToPolyline(p, b));
  for (const p of b) m = Math.max(m, distToPolyline(p, a));
  return m;
}

// 1) S 形三次贝塞尔 (两段, 红锚点连接) — 常见滑条形状
const sCurve: Vec2[] = [
  { x: 100, y: 200 }, { x: 180, y: 120 }, { x: 260, y: 200 }, { x: 260, y: 200 },
  { x: 340, y: 280 }, { x: 420, y: 200 },
];
const ctrlS = bezierAnchorsToBSpline(sCurve);
assert(!!ctrlS && ctrlS.length >= 4, `S 曲线转换产出控制点 (${ctrlS?.length})`);
{
  const rawA = SliderPath.computeRawPath('B', sCurve);
  const rawB = SliderPath.computeRawPath('B4', ctrlS!);
  const dev = maxDeviation(rawA, rawB);
  assert(dev < 2, `S 曲线保真: 最大偏差 ${dev.toFixed(2)}px < 2px`);
  assert(Math.hypot(rawB[0].x - 100, rawB[0].y - 200) < 1.6, `首端点贴合 (${rawB[0].x.toFixed(1)},${rawB[0].y.toFixed(1)})`);
  const lastB = rawB[rawB.length - 1];
  assert(Math.hypot(lastB.x - 420, lastB.y - 200) < 1.6, `末端点贴合 (${lastB.x.toFixed(1)},${lastB.y.toFixed(1)})`);
  // 红锚点接缝 (260,200) — 尖角保留: 转换后路径经过接缝附近且不圆化 (3px 内)
  let dJoint = Infinity;
  for (const p of rawB) dJoint = Math.min(dJoint, Math.hypot(p.x - 260, p.y - 200));
  assert(dJoint < 3, `红锚点接缝保留 (拐角距离 ${dJoint.toFixed(2)}px < 3)`);
}

// 2) 硬拐角 (L 形, 红锚点 90°) — 拐角检测分段 + 重复点钳位, 不圆化
const lShape: Vec2[] = [{ x: 100, y: 100 }, { x: 220, y: 100 }, { x: 220, y: 100 }, { x: 220, y: 220 }];
const ctrlL = bezierAnchorsToBSpline(lShape);
{
  const rawA = SliderPath.computeRawPath('B', lShape);
  const rawB = ctrlL ? SliderPath.computeRawPath('B4', ctrlL) : [];
  const dev = ctrlL ? maxDeviation(rawA, rawB) : Infinity;
  assert(dev < 2, `L 拐角保真: 最大偏差 ${dev.toFixed(2)}px < 2px`);
  let dCorner = Infinity;
  for (const p of rawB) dCorner = Math.min(dCorner, Math.hypot(p.x - 220, p.y - 100));
  assert(dCorner < 3, `90° 尖角不圆化 (拐角距离 ${dCorner.toFixed(2)}px < 3)`);
}

// 3) 直线两点 'B' — 转后是直线 (不炸不弯)
const line: Vec2[] = [{ x: 50, y: 50 }, { x: 250, y: 50 }];
const ctrlLine = bezierAnchorsToBSpline(line);
{
  const rawB = ctrlLine ? SliderPath.computeRawPath('B4', ctrlLine) : [];
  const dev = ctrlLine ? maxDeviation(SliderPath.computeRawPath('B', line), rawB) : Infinity;
  assert(dev < 1.5, `直线保真: 最大偏差 ${dev.toFixed(2)}px < 1.5px`);
}

// 4) 退化: 单点 → null
assert(bezierAnchorsToBSpline([{ x: 1, y: 1 }]) === null, '单点退化返回 null');

// 5) convertBezierSlidersToBSpline: 只动 'B', onlyIds 限定, 字段不变
{
  const mk = (id: number, curveType: string, curvePoints: Vec2[]): HitObject => ({
    id, type: 'slider', x: 100, y: 200, time: 1000 + id, newCombo: false, comboSkip: 0, hitSound: 0,
    curveType, curvePoints, slides: 1, length: 321,
  } as HitObject);
  const bm = {
    hitObjects: [
      mk(1, 'B', sCurve.slice(1)),
      mk(2, 'L', [{ x: 300, y: 200 }]),
      mk(3, 'P', [{ x: 200, y: 100 }, { x: 300, y: 200 }]),
      mk(4, 'B4', [{ x: 150, y: 150 }, { x: 250, y: 250 }]),
      mk(5, 'B', [{ x: 180, y: 120 }, { x: 260, y: 200 }]),
    ],
  } as unknown as Beatmap;
  const nAll = convertBezierSlidersToBSpline(bm);
  const types = bm.hitObjects.map(o => `${o.id}:${o.curveType}`).join(',');
  assert(nAll === 2 && types === '1:B4,2:L,3:P,4:B4,5:B4', `全图转换只动 'B' (${types})`);
  assert(bm.hitObjects[0].length === 321 && bm.hitObjects[0].time === 1001 && bm.hitObjects[0].id === 1,
    'length/time/id 不变');
  // onlyIds
  const bm2 = { hitObjects: [mk(1, 'B', sCurve.slice(1)), mk(5, 'B', [{ x: 180, y: 120 }, { x: 260, y: 200 }])] } as unknown as Beatmap;
  const nSel = convertBezierSlidersToBSpline(bm2, new Set([5]));
  assert(nSel === 1 && bm2.hitObjects[0].curveType === 'B' && bm2.hitObjects[1].curveType === 'B4',
    `onlyIds 限定只转选中 (${nSel})`);
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');
