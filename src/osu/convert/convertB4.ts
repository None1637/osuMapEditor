// v387: 'B4'/'B<n>' (lazer 内存扩展 B 样条) 滑条一键转 stable 兼容 'B'
// 对应 lazer 导出 stable 的 LegacyBeatmapExporter.MutateBeatmap + BezierConverter.ConvertToModernBezier;
// 转换算法复用 bsplineToStableBezier (Boehm 精确 vs Schneider 拟合双候选取锚点少者, 偏差 <= 1px),
// 比 lazer 纯 Boehm 展开锚点更少; 坐标 Round 取整 (lazer 导出口径, stable 坐标为整数)
import type { Beatmap } from '../parser';
import { bsplineToStableBezier } from '../freehand/pathApproximator';
import { parseBSplineType, SliderPath } from '../sliderPath';
import { IncrementalBSplineBuilder } from '../freehand/bsplineBuilder';
import type { Vec2 } from '../parser';

/** 谱面中 B 样条 ('B<n>') 滑条数量 (警告条显隐依据) */
export function countBSplineSliders(bm: Beatmap | null): number {
  if (!bm) return 0;
  let n = 0;
  for (const o of bm.hitObjects)
    if (o.type === 'slider' && parseBSplineType(o.curveType) !== null) n++;
  return n;
}

/**
 * B<n> 滑条原地转 'B' (红锚点分段保留, 段首重复点 .osu 惯例), 返回转换数量。
 * 纯数据改写 — undo / 路径缓存失效 / emit 由调用方 (store.convertAllBSplineSliders) 负责。
 * v388: onlyIds 限定只转换选中集 (Inspector「转为贝塞尔」按钮); 缺省 = 全图。
 */
export function convertBSplineSlidersToBezier(bm: Beatmap, onlyIds?: Set<number>): number {
  let n = 0;
  for (const o of bm.hitObjects) {
    const deg = o.type === 'slider' ? parseBSplineType(o.curveType) : null;
    if (deg === null) continue;
    if (onlyIds && !onlyIds.has(o.id)) continue;
    const pts = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
    o.curvePoints = bsplineToStableBezier(pts, deg).slice(1).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    o.curveType = 'B';
    n++;
  }
  return n;
}

// ---- v464: 反向转换 — 贝塞尔 ('B') 滑条转 B 样条 ('B<n>', 默认 B4) ----

const CONVERT_DEGREE = 4;      // 与手绘落盘同 degree (v387 'B4')
const CONVERT_TOLERANCE = 1.0; // px — 转换保真度 (手绘 1.8 是手绘输入去抖; 转换要求更贴合原形状)
const CONVERT_CORNER = 0.4;    // lazer 默认拐角阈值 (红锚点尖角靠它分段, 段接缝重复点钳位通过拐角)

/**
 * 贝塞尔锚点列 -> B 样条控制点列 (绝对坐标取整, 段接缝红锚点重复 = .osu 惯例); 退化返回 null。
 * 算法 = 手绘落盘 (finishFreehandSlider, v387) 同款管线: 贝塞尔路径密集采样 ->
 * IncrementalBSplineBuilder (lazer 移植: 平滑采样 + 拐角检测分段 + 最小二乘拟合) ->
 * 分段控制点展平 (段起点除首段外为红锚点, 重复一次; 末段补终点; 首点强制 = 原头部)。
 */
export function bezierAnchorsToBSpline(pts: Vec2[], degree = CONVERT_DEGREE): Vec2[] | null {
  if (pts.length < 2) return null;
  const raw = SliderPath.computeRawPath('B', pts); // 密集采样折线 (红锚点尖角保留在几何里)
  if (raw.length < 2) return null;
  const head = pts[0];
  const builder = new IncrementalBSplineBuilder(degree, CONVERT_TOLERANCE, CONVERT_CORNER);
  for (const p of raw) builder.addLinearPoint({ x: p.x - head.x, y: p.y - head.y }); // 手绘同款: 相对头部坐标
  builder.finish(); // 末段完整优化 (lazer OnDrawEnd)
  const segments = builder.getControlPoints();
  const abs = (p: Vec2) => ({ x: Math.round(head.x + p.x), y: Math.round(head.y + p.y) });
  const out: Vec2[] = [];
  segments.forEach((seg, i) => {
    if (!seg.length) return;
    // 与 fitSegmentsToPoints + finishFreehandSlider 同款展平: 非首段段起点 = 红锚点 (重复一次),
    // 中间点原样, 仅末段补终点 (非末段末点 = 下段起点, 不重复推)
    if (i > 0) { const a = abs(seg[0]); out.push(a, { ...a }); }
    else out.push(abs(seg[0]));
    for (let j = 1; j < seg.length - 1; j++) out.push(abs(seg[j]));
    if (i === segments.length - 1 && seg.length > 1) out.push(abs(seg[seg.length - 1]));
  });
  if (out.length < 2) return null;
  // 首末控制点强制 = 原贝塞尔首末锚点 (clamped B 样条过首末控制点; builder 按 FD_EPSILON=2px 采样,
  // 末端拟合系统性短一截 ~2-3px — 转换场景尾锚点位置必须保真, 手绘场景无此要求)
  out[0] = { x: Math.round(head.x), y: Math.round(head.y) };
  const tail = pts[pts.length - 1];
  out[out.length - 1] = { x: Math.round(tail.x), y: Math.round(tail.y) };
  return out;
}

/**
 * 贝塞尔 ('B') 滑条原地转 'B<n>' (默认 B4), 返回转换数量。length/时间/音效不动 (几何偏差 ≤ 容差,
 * expectedLength 语义不变); 纯数据改写 — undo / 路径缓存失效 / emit 由调用方负责。
 * 仅 'B'; L/P/C 与 B<n> 不动 (用户诉求 = 贝塞尔转 B4)。
 */
export function convertBezierSlidersToBSpline(bm: Beatmap, onlyIds?: Set<number>, degree = CONVERT_DEGREE): number {
  let n = 0;
  for (const o of bm.hitObjects) {
    if (o.type !== 'slider' || o.curveType !== 'B') continue;
    if (onlyIds && !onlyIds.has(o.id)) continue;
    const ctrl = bezierAnchorsToBSpline([{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])], degree);
    if (!ctrl) continue;
    o.curvePoints = ctrl.slice(1);
    o.curveType = `B${degree}`;
    n++;
  }
  return n;
}
