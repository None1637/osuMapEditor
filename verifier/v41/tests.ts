// 验证器 v41: circleToBezier 顺时针弧修复 + Crystalia P+B 合并保形 纯函数测试
import { circleToBezier, measureSegments } from '../../src/osu/convert/bezierPath';
import { computeMerge } from '../../src/osu/convert/merge';
import { getSliderPath } from '../../src/osu/sliderPath';
import type { Beatmap, HitObject, Vec2 } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

/** 段序列采样点列 (每段 512 等参, 间距 ~0.25px) */
function sampleSegs(segs: Vec2[][]): Vec2[] {
  const out: Vec2[] = [];
  for (const seg of segs) {
    for (let i = 0; i <= 512; i++) {
      let pts = seg.map(p => ({ ...p }));
      const t = i / 512;
      for (let k = pts.length - 1; k > 0; k--) {
        for (let j = 0; j < k; j++) pts[j] = { x: pts[j].x + (pts[j + 1].x - pts[j].x) * t, y: pts[j].y + (pts[j + 1].y - pts[j].y) * t };
      }
      out.push(pts[0]);
    }
  }
  return out;
}

section('circleToBezier: 顺时针弧 (Crystalia 第3滑条, cross<0)');
{
  const a = { x: 476, y: 64 }, b = { x: 405, y: 153 }, c = { x: 485, y: 236 };
  const segs = circleToBezier(a, b, c);
  // 终点必须精确落在 c (修复前: dir=-1 双重取反, 终点落在 (529,228), 偏差 173px)
  const last = segs[segs.length - 1];
  const end = last[last.length - 1];
  assert(Math.hypot(end.x - c.x, end.y - c.y) < 1e-6, `终点 = c (${end.x.toFixed(2)},${end.y.toFixed(2)})`);
  // 过中间点 b (圆弧定义)
  const pts = sampleSegs(segs);
  const devB = Math.min(...pts.map(p => Math.hypot(p.x - b.x, p.y - b.y)));
  assert(devB < 0.2, `经过中间点 b (最近 ${devB.toFixed(3)}px)`);
  // 外接圆半径恒定: 所有采样点到圆心距离 ≈ r
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const a2 = a.x ** 2 + a.y ** 2, b2 = b.x ** 2 + b.y ** 2, c2 = c.x ** 2 + c.y ** 2;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const maxDev = Math.max(...pts.map(p => Math.abs(Math.hypot(p.x - cx, p.y - cy) - r)));
  assert(maxDev < 0.1, `采样点在外接圆上 (最大径向偏差 ${maxDev.toFixed(4)}px, 弧 >90° 分 ${segs.length} 块)`);
}

section('circleToBezier: 逆时针弧回归 (cross>0, 行为不变)');
{
  // 镜像 Crystalia 三点 (y 翻转) -> cross>0
  const a = { x: 476, y: -64 }, b = { x: 405, y: -153 }, c = { x: 485, y: -236 };
  const segs = circleToBezier(a, b, c);
  const last = segs[segs.length - 1];
  const end = last[last.length - 1];
  assert(Math.hypot(end.x - c.x, end.y - c.y) < 1e-6, `终点 = c (${end.x.toFixed(2)},${end.y.toFixed(2)})`);
  const pts = sampleSegs(segs);
  const devB = Math.min(...pts.map(p => Math.hypot(p.x - b.x, p.y - b.y)));
  assert(devB < 0.2, `经过中间点 b (最近 ${devB.toFixed(3)}px)`);
}

section('computeMerge: Crystalia 第3+4滑条 (P 250 + B 250) 保形');
{
  const bm = {
    difficulty: { hp: 5, cs: 4, od: 8, ar: 9, sliderMultiplier: 1.4, sliderTickRate: 1 },
    timingPoints: [{ time: -181, beatLength: 342.857142857143, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 60, uninherited: 1, effects: 0 }],
    editor: { beatDivisor: 4 },
    hitObjects: [],
  } as unknown as Beatmap;
  const s3: HitObject = {
    id: 90001, type: 'slider', x: 476, y: 64, time: 3020, hitSound: 0, newCombo: false, comboSkip: 0,
    curveType: 'P', curvePoints: [{ x: 405, y: 153 }, { x: 485, y: 236 }], slides: 1, length: 250,
  };
  const s4: HitObject = {
    id: 90002, type: 'slider', x: 423, y: 306, time: 3687, hitSound: 0, newCombo: true, comboSkip: 0,
    curveType: 'B', curvePoints: [
      { x: 381, y: 310 }, { x: 355, y: 273 }, { x: 355, y: 273 }, { x: 335, y: 305 }, { x: 299, y: 316 },
      { x: 299, y: 316 }, { x: 279, y: 282 }, { x: 236, y: 276 }, { x: 209, y: 291 },
    ], slides: 1, length: 250,
  };
  const merged = computeMerge(bm, [s3, s4], 4)!;
  assert(merged !== null && merged.curveType === 'B' && merged.x === 476 && merged.y === 64 && merged.time === 3020,
    `合并滑条头部 (${merged?.x},${merged?.y},${merged?.time})`);
  // P 部分形状: 与原 P 滑条渲染路径同弧长采样对比 (修复前最大偏差 173.8px)
  const origPath = getSliderPath(bm, s3);
  const mergedPath = getSliderPath(bm, merged);
  let maxDev = 0;
  for (let dd = 0; dd <= 250; dd += 2) {
    const po = origPath.positionAt(dd), pm = mergedPath.positionAt(dd);
    maxDev = Math.max(maxDev, Math.hypot(po.x - pm.x, po.y - pm.y));
  }
  assert(maxDev < 1, `P 部分最大偏差 ${maxDev.toFixed(2)}px < 1`);
  // B 部分: 接缝 (红锚点重复对) 后接原 B 控制点, 原样保留
  const pts = merged.curvePoints!;
  const tail = pts.slice(-9).map(p => `${p.x},${p.y}`).join('|');
  assert(tail === '381,310|355,273|355,273|335,305|299,316|299,316|279,282|236,276|209,291', `B 控制点原样保留 (${tail})`);
  // 长度 = 几何全长吸附 (P 250 + 接缝 + B 250, 不拉伸对齐尾部时间)
  assert(Math.abs(merged.length! - mergedPath.totalLength) < 1e-6, `长度 ${merged.length} = 路径全长 ${mergedPath.totalLength.toFixed(1)}`);
  void measureSegments; // (保留引用, 便于后续扩测)
}

if (failures) { console.error(`\nV41_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV41_TESTS_PASSED');
