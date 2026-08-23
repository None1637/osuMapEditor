// 验证器 v37: F2 滑条等时间拆分 — bezierPath/computeSplit 纯函数测试
import { catmullToBezier, sliderToBezierSegments, measureSegments, extractRange, segmentsToPoints } from '../../src/osu/convert/bezierPath';
import { computeSplit, DEFAULT_SPLIT_PARAMS, type SplitParams } from '../../src/osu/convert/split';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }
const near = (a: number, b: number, eps = 0.51) => Math.abs(a - b) <= eps;

// 合成谱面: 红线 0/500, SliderMultiplier 1 -> vel = 100*1/500 = 0.2 px/ms
const bm = {
  timingPoints: [{ time: 0, beatLength: 500, uninherited: true, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, effects: 0 }],
  difficulty: { sliderMultiplier: 1 },
} as unknown as Beatmap;

section('catmullToBezier: 端点与切线 (lazer ConvertCatmullToBezierAnchors 公式)');
{
  // 三点卡特姆 (0,0)-(100,0)-(200,100)
  const segs = catmullToBezier([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 100 }]);
  assert(segs.length === 2 && segs.every(s => s.length === 4), 'n-1 条三次贝塞尔');
  assert(near(segs[0][0].x, 0, 1e-9) && near(segs[0][0].y, 0, 1e-9) && near(segs[0][3].x, 100, 1e-9) && near(segs[0][3].y, 0, 1e-9), '段 0 端点 = 卡特姆第 1/2 点');
  assert(near(segs[1][3].x, 200, 1e-9) && near(segs[1][3].y, 100, 1e-9), '段 1 末点 = 卡特姆末点');
  // 起点切线: c1-p0 = (-v1+6v2+v3)/6 - v2 = (v3-v1)/6, v1=v2 -> 水平方向
  assert(near(segs[0][1].y, 0, 1e-9) && segs[0][1].x > 0, '起点切线水平 (首点 v1=v2 端部条件)');
  // 末点切线: p3-c2 方向 ∝ (v3-v2) = (100,100) -> 斜率 1
  const dx = segs[1][3].x - segs[1][2].x, dy = segs[1][3].y - segs[1][2].y;
  assert(near(dy / dx, 1, 1e-9) && dx > 0, `末点切线斜率 1 (实际 ${(dy / dx).toFixed(3)})`);
}

// 直线滑条 (100,100)->(400,100), length 300 -> 单程 1500ms
const slider: HitObject = {
  id: 1, type: 'slider', x: 100, y: 100, time: 2000,
  curveType: 'L', curvePoints: [{ x: 400, y: 100 }], slides: 1, length: 300,
  hitSound: 10, newCombo: true, comboSkip: 0, hitSampleRaw: '1:2:0:80:',
  edgeSoundsRaw: '0|2', edgeSetsRaw: '0:0|1:0',
};

section('computeSplit: L 滑条三等分 (等时间, 默认间隙 0)');
{
  const r = computeSplit(bm, slider, { ...DEFAULT_SPLIT_PARAMS, count: 3 });
  assert(!r.error && r.objects.length === 3, '生成 3 段');
  assert(r.objects.map(o => o.x).join(',') === '100,200,300', `段头 x = 1/3, 2/3 处 (${r.objects.map(o => o.x).join(',')})`);
  assert(r.objects.every(o => o.y === 100), 'y 恒 100');
  // 每段 100px / 0.2 = 500ms, 首尾相接
  assert(r.objects.map(o => o.time).join(',') === '2000,2500,3000', `时间 (${r.objects.map(o => o.time).join(',')})`);
  assert(r.objects.every(o => o.type === 'slider' && o.curveType === 'B' && o.slides === 1 && o.length === 100), '每段 B 滑条 slides=1 length=100');
  assert(r.objects[0].hitSound === 10 && r.objects[0].hitSampleRaw === '1:2:0:80:' && r.objects[0].newCombo === true, '第一段保留头部采样 + newCombo');
  assert(r.objects.slice(1).every(o => o.hitSound === 0 && o.hitSampleRaw === undefined && !o.newCombo), '其余段无头部采样/newCombo');
  // 端点 1 (尾部) 时间 = 2000+1500 = 3500 -> 第三段 (2000+2*500=3000 .. 3500) 尾部
  assert(r.objects[0].edgeSoundsRaw === '0|0' && r.objects[2].edgeSoundsRaw === '0|2', `edgeSounds 落段 (${r.objects.map(o => o.edgeSoundsRaw).join(' / ')})`);
  assert(r.objects[2].edgeSetsRaw === '0:0|1:0', `edgeSets 落段 (${r.objects[2].edgeSetsRaw})`);
}

section('computeSplit: 间隙参数');
{
  // 距离间隙 30: ℓ = (300-60)/3 = 80 -> 段头 100, 210, 320
  const r = computeSplit(bm, slider, { count: 3, timeGap: 0, distGap: 30 });
  assert(r.objects.map(o => o.x).join(',') === '100,210,320', `distGap=30 段头 (${r.objects.map(o => o.x).join(',')})`);
  assert(r.objects.every(o => o.length === 80), '每段 length=80');
  // 时间间隙 100: n=2, ℓ=150, dur=750 -> 起点 2000, 2850
  const r2 = computeSplit(bm, slider, { count: 2, timeGap: 100, distGap: 0 });
  assert(r2.objects.map(o => o.time).join(',') === '2000,2850', `timeGap=100 时间 (${r2.objects.map(o => o.time).join(',')})`);
  // 非法: 距离间隙过大 -> 提示且不生成
  const r3 = computeSplit(bm, slider, { count: 3, timeGap: 0, distGap: 200 });
  assert(!!r3.error && r3.objects.length === 0, `distGap 过大报错 (${r3.error})`);
  const r4 = computeSplit(bm, slider, { count: 1, timeGap: 0, distGap: 0 });
  assert(!!r4.error && r4.objects.length === 0, 'count<2 报错');
}

section('computeSplit: hitsound 时间映射 (折返视为无折返)');
{
  // slides=2: 单程 1500ms; 端点时间 2000 / 3500 / 5000
  const s2: HitObject = { ...slider, id: 2, slides: 2, edgeSoundsRaw: '1|2|4', edgeSetsRaw: '0:0|1:0|2:0' };
  const r = computeSplit(bm, s2, { count: 2, timeGap: 0, distGap: 0 });
  // 段 [2000,2750] [2750,3500]; 端点0 -> 段0头, 端点1(T=3500) -> 段1尾, 端点2(T=5000) 超出 -> 丢弃
  assert(r.objects[0].edgeSoundsRaw === '1|0' && r.objects[1].edgeSoundsRaw === '0|2', `edgeSounds 按时间落段 (${r.objects.map(o => o.edgeSoundsRaw).join(' / ')})`);
  assert(r.objects[1].edgeSetsRaw === '0:0|1:0', `edgeSets 按时间落段 (${r.objects[1].edgeSetsRaw})`);
  assert(r.objects.every(o => o.slides === 1), '折返滑条拆分结果全部 slides=1');
}

section('computeSplit: 红锚点接缝保留 (B 滑条跨原分段剖分)');
{
  // (100,100)->(200,100) [红锚点] ->(300,200): 几何 100 + 141.421 = 241.421
  const sB: HitObject = {
    id: 3, type: 'slider', x: 100, y: 100, time: 2000, hitSound: 0, newCombo: false, comboSkip: 0,
    curveType: 'B', curvePoints: [{ x: 200, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 200 }],
    slides: 1, length: 100 + Math.hypot(100, 100),
  };
  const r = computeSplit(bm, sB, { count: 2, timeGap: 0, distGap: 0 });
  // ℓ = 120.71 > 100 -> 第一段跨过原红锚点分段边界
  const cp = r.objects[0].curvePoints ?? [];
  let seam = false;
  for (let i = 1; i < cp.length; i++) if (cp[i].x === cp[i - 1].x && cp[i].y === cp[i - 1].y) seam = true;
  assert(seam, `第一段含红锚点接缝 (curvePoints=${cp.map(p => p.x + ':' + p.y).join('|')})`);
  assert(cp[0].x === 200 && cp[0].y === 100 && cp[1].x === 200 && cp[1].y === 100, '接缝位置 = 原红锚点 (200,100)');
  // 两段拼回的几何总长 ≈ 原长 (形状无损)
  const total = r.objects.reduce((acc, o) => {
    const segs = sliderToBezierSegments(o);
    return acc + measureSegments(segs).total;
  }, 0);
  assert(near(total, 100 + Math.hypot(100, 100), 0.5), `拆分后几何总长 ≈ 原长 (${total.toFixed(2)} vs ${(100 + Math.hypot(100, 100)).toFixed(2)})`);
}

section('bezierPath: extractRange/segmentsToPoints 低层行为');
{
  const segs = sliderToBezierSegments(slider);
  const m = measureSegments(segs);
  assert(near(m.total, 300, 0.5), `L 滑条弧长测量 (${m.total.toFixed(2)})`);
  const piece = extractRange(m, 100, 200);
  const pts = segmentsToPoints(piece);
  assert(near(pts[0].x, 200, 0.5) && near(pts[pts.length - 1].x, 300, 0.5), `弧长区间 [100,200] -> x [200,300] (${pts[0].x.toFixed(1)}..${pts[pts.length - 1].x.toFixed(1)})`);
  // 多段接缝: 截取跨段区间 -> 重复点对
  const sB2: HitObject = { id: 4, type: 'slider', x: 0, y: 0, time: 0, curveType: 'L', curvePoints: [{ x: 100, y: 0 }, { x: 100, y: 100 }], slides: 1, length: 200 };
  const m2 = measureSegments(sliderToBezierSegments(sB2));
  const pts2 = segmentsToPoints(extractRange(m2, 50, 150));
  let seam2 = false;
  for (let i = 1; i < pts2.length; i++) if (pts2[i].x === pts2[i - 1].x && pts2[i].y === pts2[i - 1].y) seam2 = true;
  assert(seam2, '跨原分段截取 -> 接缝重复点 (红锚点)');
}

if (failures) { console.error(`\nV37_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV37_TESTS_PASSED');
