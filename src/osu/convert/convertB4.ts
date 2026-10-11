// v387: 'B4'/'B<n>' (lazer 内存扩展 B 样条) 滑条一键转 stable 兼容 'B'
// 对应 lazer 导出 stable 的 LegacyBeatmapExporter.MutateBeatmap + BezierConverter.ConvertToModernBezier;
// 转换算法复用 bsplineToStableBezier (Boehm 精确 vs Schneider 拟合双候选取锚点少者, 偏差 <= 1px),
// 比 lazer 纯 Boehm 展开锚点更少; 坐标 Round 取整 (lazer 导出口径, stable 坐标为整数)
import type { Beatmap } from '../parser';
import { bsplineToStableBezier } from '../freehand/pathApproximator';
import { parseBSplineType } from '../sliderPath';

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
