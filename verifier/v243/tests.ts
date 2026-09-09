// 验证器 v243 行为测试: 对称滑条源为圆弧 (P) 时先转贝塞尔 (computeSymSlider 纯函数数值断言)
//   - P 源: join='none' 副本 curveType 变 'B' 且节点数 > 3 (三点弧被展开为贝塞尔段)
//   - 几何一致: 副本采样点 ≈ 原弧采样点 + 平移向量 (仅受副本节点取整影响, 容差 1px)
//   - join='tail' 拼接: 结果 curveType='B', 几何全长 ≈ 2× 原弧长, endTime 翻倍延长
//   - 非圆弧源 (L) 不受影响: 副本 curveType 保持 'L'
import { computeSymSlider, DEFAULT_SYM_SLIDER_PARAMS, type SymSliderParams } from '../../src/osu/convert/symSlider';
import { measureSegments, deCasteljau, sliderToBezierSegments } from '../../src/osu/convert/bezierPath';
import { genId, type Beatmap, type HitObject, type Vec2 } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const bm = {} as Beatmap;
const mk = (patch: Partial<SymSliderParams>): SymSliderParams => ({ ...DEFAULT_SYM_SLIDER_PARAMS, ...patch });
const mkSlider = (pts: [number, number][], patch: Partial<HitObject> = {}): HitObject => ({
  id: genId(), type: 'slider', x: pts[0][0], y: pts[0][1], time: 1000, endTime: 2000,
  curveType: 'P', curvePoints: pts.slice(1).map(([x, y]) => ({ x, y })),
  slides: 1, length: 100, hitSound: 0, ...patch,
});

/** 沿滑条路径按段等参采样 (同一 seg 结构 → 同序对应点) */
function samplePath(o: HitObject, stepsPerSeg = 16): Vec2[] {
  const segs = sliderToBezierSegments(o);
  const out: Vec2[] = [];
  for (const s of segs) {
    for (let i = out.length ? 1 : 0; i <= stepsPerSeg; i++) out.push(deCasteljau(s, i / stepsPerSeg));
  }
  return out;
}
const maxDev = (a: Vec2[], b: Vec2[], dx = 0, dy = 0) =>
  a.length !== b.length ? Infinity :
    Math.max(...a.map((p, i) => Math.hypot(p.x + dx - b[i].x, p.y + dy - b[i].y)));

// 非共线三点弧 (圆心角约 90°)
const arcPts: [number, number][] = [[100, 100], [200, 100], [200, 200]];

section('P 源转贝塞尔: join=none 副本');
{
  const src = mkSlider(arcPts);
  const r = computeSymSlider(bm, src, mk({ mode: 'translate', dx: 0, dy: 0, count: 1, join: 'none' }));
  assert(r.length === 1, '生成 1 个副本');
  assert(r[0].curveType === 'B', `副本 curveType = 'B' (实际 ${r[0].curveType})`);
  const nodeCount = (r[0].curvePoints?.length ?? 0) + 1;
  assert(nodeCount > 3, `副本节点数 > 3 — 弧已展开为贝塞尔段 (实际 ${nodeCount})`);
  // 几何一致: 零向量平移副本 ≈ 原弧 (仅取整误差)
  const dev = maxDev(samplePath(src), samplePath(r[0]));
  assert(dev <= 1, `零向量副本几何与原弧一致 (最大偏差 ${dev.toFixed(3)}px ≤ 1)`);
  // 原对象不被改 (curveType 仍 'P', 节点仍 3 个)
  assert(src.curveType === 'P' && (src.curvePoints?.length ?? 0) === 2, '原滑条不被改');
}

section('P 源转贝塞尔: 平移副本保持形状');
{
  const src = mkSlider(arcPts);
  const r = computeSymSlider(bm, src, mk({ mode: 'translate', dx: 120, dy: 40, count: 1, join: 'none' }));
  const dev = maxDev(samplePath(src), samplePath(r[0]), 120, 40);
  assert(r[0].curveType === 'B' && dev <= 1, `平移 (120,40) 副本 = 原弧整体平移 (最大偏差 ${dev.toFixed(3)}px ≤ 1)`);
}

section('P 源转贝塞尔: join=tail 拼接 (原弧段不再退化为折线)');
{
  const src = mkSlider(arcPts);
  const arcLen = measureSegments(sliderToBezierSegments(src)).total;
  const r = computeSymSlider(bm, src, mk({ mode: 'translate', dx: 0, dy: 0, count: 1, join: 'tail' }));
  assert(r.length === 1 && r[0].curveType === 'B', `拼接结果单条 'B' (实际 ${r[0].curveType})`);
  assert(r[0].time === 1000 && r[0].endTime === 3000, `endTime 翻倍延长 (实际 ${r[0].time}~${r[0].endTime})`);
  const joinedLen = measureSegments(sliderToBezierSegments(r[0])).total;
  assert(Math.abs(joinedLen - 2 * arcLen) <= 2,
    `拼接几何全长 ≈ 2× 原弧长 (实际 ${joinedLen.toFixed(1)} vs ${(2 * arcLen).toFixed(1)})`);
  // 前段采样 ≈ 原弧采样 (拼接路径前半 = 转换后的原弧, 未取整原样保留)
  const half = samplePath(r[0]).slice(0, samplePath(src).length);
  const dev = maxDev(samplePath(src), half);
  assert(dev <= 1, `拼接前半段几何 = 原弧 (最大偏差 ${dev.toFixed(3)}px ≤ 1)`);
}

section('非圆弧源不受影响');
{
  const r = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]], { curveType: 'L' }),
    mk({ mode: 'translate', dx: 0, dy: 0, count: 1, join: 'none' }));
  assert(r.length === 1 && r[0].curveType === 'L', `L 源副本 curveType 保持 'L' (实际 ${r[0].curveType})`);
  const rb = computeSymSlider(bm, mkSlider([[100, 100], [150, 50], [200, 100]], { curveType: 'B' }),
    mk({ mode: 'translate', dx: 0, dy: 0, count: 1, join: 'none' }));
  assert(rb.length === 1 && rb[0].curveType === 'B' && (rb[0].curvePoints?.length ?? 0) === 2,
    'B 源副本节点数不变 (不重复转换)');
}

if (failures) { console.error(`\nV243_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV243_TESTS_PASSED');
