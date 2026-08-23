// v84: 几何辅助 (Mapping Tools "Geometry Dashboard" / SnappingTools 移植, 仅三种)
// 参考: osu_mapping_tools/Mapping_Tools/Classes/Tools/SnappingTools/.../Generators/
//   LinearLineGenerator.cs        — L 型滑条: 头 -> 最后锚点 的无限直线
//   PerfectCircleGenerator.cs     — P 型且恰好 3 控制点: 三点外接圆 (完整圆, 更多点直接排除)
//   PerfectCircleBlanketGenerator.cs — 同筛选, 取圆心为辅助点
// 吸附 (mapping tools RelevantLine/Circle/Point.NearestPoint): 线 = 垂足, 圆 = 径向投射, 点 = 自身
// 与本项目差异 (按用户规格): 仅作用于选中滑条; 线/圆用红色虚线 (mapping tools 线默认绿, 圆红);
// 线增加"以直线段开头/结尾"的非 L 滑条 (首/尾段恰 2 控制点)
import type { HitObject } from './parser';
import { OBJECT_SNAP_RADIUS, type Pt } from './objectSnap';

/** 无限直线: 点 (x,y) + 单位方向 (dx,dy) */
export interface GeoLine { x: number; y: number; dx: number; dy: number }
export interface GeoCircle { cx: number; cy: number; r: number }

/**
 * v91: 物件移动拖拽的几何辅助修正 — 各拖拽点按当前位移试探辅助点/线/圆,
 * 命中取最近修正; 与物件吸附修正取更近者 (objCorrDist = 物件修正的位移改变量, 无物件修正传 null)
 */
export function geoDragCorrection(
  dragPts: Pt[], dx: number, dy: number,
  snap: (p: Pt) => Pt | null,
  objCorrDist: number | null,
): { dx: number; dy: number } | null {
  let best: { dx: number; dy: number; dist: number } | null = null;
  for (const dp of dragPts) {
    const g = snap({ x: dp.x + dx, y: dp.y + dy });
    if (!g) continue;
    const dist = Math.hypot(g.x - (dp.x + dx), g.y - (dp.y + dy));
    if (!best || dist < best.dist) best = { dx: Math.round(g.x - dp.x), dy: Math.round(g.y - dp.y), dist };
  }
  if (!best) return null;
  if (objCorrDist !== null && best.dist >= objCorrDist) return null; // 物件修正更近, 不覆盖
  return { dx: best.dx, dy: best.dy };
}

/** mapping tools RelevantLine 裁剪框: 游玩区 (0,0)-(512,384) 四边各外扩 1000 osu px */
export const GEO_CLIP_BOX = { left: -1000, top: -1000, right: 1512, bottom: 1384 };

/**
 * v134/v139: 视觉间距辅助线吸附 — 被拖/放置参考点 (物件头/尾中心, 即光标持点) 直接吸附到
 * 可见金色环带上 (WYSIWYG: 吸的就是画出来的那条线)。
 * snap 目标 = 源轮廓外扩 distR 的等距曲线 (= 绘制的环带中心线):
 *  - 单点源: 圆环 (圆心 = 源中心, 半径 = distR) — 径向投射;
 *  - 滑条源: 路径等距曲线 (到路径折线最近距离 = distR) — 沿最近点法向投射;
 *    折线最近点含端点, 端帽 (半圆) 的等距目标由此自然覆盖, 无需单独处理。
 * 阈值 = OBJECT_SNAP_RADIUS (6.4 osu px, 与物件/几何辅助吸附相同); 命中返回最近候选, 否则 null
 * v139: 目标从 (distR + dragR) 改为 distR — v134 "边缘贴环带"语义下吸附带在环带外侧一个物件半径处,
 *  用户把物件中心拖到金线上反而不触发 (感觉不到吸附); 改为参考点直接吸到可见环带
 * @param distR 绘制环带的半径 = csToRadius(CS) + geoDistValue (源物件边缘外扩距离)
 * @param circles 单点源中心列 (含堆叠偏移); paths 滑条源路径点列 (含堆叠偏移)
 */
export function distGuideSnap(p: Pt, distR: number, circles: Pt[], paths: Pt[][]): Pt | null {
  const target = distR;
  let best: Pt | null = null, bestScore = OBJECT_SNAP_RADIUS;
  for (const c of circles) {
    const dc = Math.hypot(p.x - c.x, p.y - c.y);
    if (dc < 1e-6) continue;
    const score = Math.abs(dc - target);
    if (score < bestScore) {
      bestScore = score;
      best = { x: c.x + (p.x - c.x) / dc * target, y: c.y + (p.y - c.y) / dc * target };
    }
  }
  for (const pts of paths) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i].x, ay = pts[i].y, bx = pts[i + 1].x, by = pts[i + 1].y;
      // 包围盒早退: 段与 p 距离必大于当前 bestScore + target 时跳过 (长路径滑条性能)
      const reach = target + bestScore;
      if (p.x < Math.min(ax, bx) - reach || p.x > Math.max(ax, bx) + reach ||
          p.y < Math.min(ay, by) - reach || p.y > Math.max(ay, by) + reach) continue;
      const abx = bx - ax, aby = by - ay;
      const len2 = abx * abx + aby * aby;
      let t = len2 < 1e-12 ? 0 : ((p.x - ax) * abx + (p.y - ay) * aby) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + t * abx, qy = ay + t * aby;
      const d = Math.hypot(p.x - qx, p.y - qy);
      if (d < 1e-6) continue; // p 在路径上, 法向不定
      const score = Math.abs(d - target);
      if (score < bestScore) {
        bestScore = score;
        best = { x: qx + (p.x - qx) / d * target, y: qy + (p.y - qy) / d * target };
      }
    }
  }
  return best;
}


/** v88: 辅助图形来源 (面板互斥勾选项) — all: 当前可见所有滑条; selection: 当前选中 ∪ 上次选中 (prevIds) */
export function geoHelperSources(
  scope: 'all' | 'selection', objects: HitObject[],
  selected: ReadonlySet<number>, prevIds: ReadonlySet<number>,
  visible: (o: HitObject) => boolean,
): HitObject[] {
  if (scope === 'all') return objects.filter(o => o.type === 'slider' && visible(o));
  return objects.filter(o => o.type === 'slider' && (selected.has(o.id) || prevIds.has(o.id)));
}

/** v126: 视觉间距辅助线来源 — 同 geoHelperSources 范围语义, 但作用于单点+滑条 (转盘全屏无意义, 排除) */
export function geoDistSources(
  scope: 'all' | 'selection', objects: HitObject[],
  selected: ReadonlySet<number>, prevIds: ReadonlySet<number>,
  visible: (o: HitObject) => boolean,
): HitObject[] {
  const ok = (o: HitObject) => o.type === 'circle' || o.type === 'slider';
  if (scope === 'all') return objects.filter(o => ok(o) && visible(o));
  return objects.filter(o => ok(o) && (selected.has(o.id) || prevIds.has(o.id)));
}

/**
 * v126: 折线双侧等距偏移 (视觉间距辅助线的滑条轮廓):
 * 顶点法线 = 相邻段法线平均, miter 补偿 1/dot 并限幅 3 倍防尖刺; 掉头段退化为单侧法线。
 * 返回左/右两条偏移折线 (左 = 行进方向左手侧); 两端端帽 (半圆) 由调用方绘制
 * v133: 渲染已改用描边环带法 (renderer.drawDistanceGuideRing, 圆角 join/cap 粗描边 + 镂空 = 精确等距),
 * 此函数在曲率半径 < 偏移量的内弯处会产生尖刺/回折 (miter 限幅仅缓解), 不再用于间距辅助线渲染, 保留供纯函数测试
 */
export function offsetPolyline(pts: Pt[], d: number): { left: Pt[]; right: Pt[] } {
  const n = pts.length;
  if (n < 2) return { left: [], right: [] };
  const segN: Pt[] = []; // 各段单位法线 (左手侧)
  for (let i = 0; i + 1 < n; i++) {
    const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) { segN.push(i ? segN[i - 1] : { x: 0, y: 1 }); continue; } // 重合点沿用前段法线
    segN.push({ x: -dy / len, y: dx / len });
  }
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let nx: number, ny: number;
    if (i === 0) { nx = segN[0].x; ny = segN[0].y; }
    else if (i === n - 1) { nx = segN[n - 2].x; ny = segN[n - 2].y; }
    else {
      nx = segN[i - 1].x + segN[i].x; ny = segN[i - 1].y + segN[i].y;
      const l = Math.hypot(nx, ny);
      if (l < 1e-6) { nx = segN[i].x; ny = segN[i].y; } // 180° 掉头: 用单侧法线
      else {
        nx /= l; ny /= l;
        const dot = Math.max(1 / 3, nx * segN[i - 1].x + ny * segN[i - 1].y); // miter 限幅
        nx /= dot; ny /= dot;
      }
    }
    left.push({ x: pts[i].x + nx * d, y: pts[i].y + ny * d });
    right.push({ x: pts[i].x - nx * d, y: pts[i].y - ny * d });
  }
  return { left, right };
}

/** 三点外接圆 (mapping tools MathUtil/CircleArc.cs barycentric 外心公式); 退化 (共线/重合) 返回 null */
export function circumCircle(a: Pt, b: Pt, c: Pt): GeoCircle | null {
  const aSq = (b.x - c.x) ** 2 + (b.y - c.y) ** 2;
  const bSq = (a.x - c.x) ** 2 + (a.y - c.y) ** 2;
  const cSq = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  if (aSq < 1e-8 || bSq < 1e-8 || cSq < 1e-8) return null;
  const s = aSq * (bSq + cSq - aSq), t = bSq * (aSq + cSq - bSq), u = cSq * (aSq + bSq - cSq);
  const d = s + t + u;
  if (Math.abs(d) < 1e-8) return null;
  const cx = (s * a.x + t * b.x + u * c.x) / d, cy = (s * a.y + t * b.y + u * c.y) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

const allPoints = (o: HitObject): Pt[] => [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];

/** 三点圆弧辅助圆/圆心: 仅 'P' 型且恰好 3 个控制点 (mapping tools: 更多点直接排除) */
export function sliderHelperCircle(o: HitObject): GeoCircle | null {
  if (o.type !== 'slider' || o.curveType !== 'P') return null;
  const pts = allPoints(o);
  if (pts.length !== 3) return null;
  return circumCircle(pts[0], pts[1], pts[2]);
}

/** 红锚点重复对分段: 返回各段 [start, end] 下标区间 (重复边界点只算分界, 不计入段内点数) */
function segments(pts: Pt[]): [number, number][] {
  const segs: [number, number][] = [];
  let start = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    if (pts[i].x === pts[i + 1].x && pts[i].y === pts[i + 1].y) { segs.push([start, i]); start = i + 1; i++; }
  }
  segs.push([start, pts.length - 1]);
  return segs;
}

/**
 * 延伸辅助线 (mapping tools LinearLineGenerator + 用户规格扩展):
 * - 'L': 单条无限线 = 头 -> 最后锚点 (mapping tools 原语义, 中间锚点忽略)
 * - 其他类型: 首段恰 2 控制点 => 头部延伸线 (过前两点); 尾段恰 2 点 => 尾部延伸线 (过后两点)
 */
export function sliderHelperLines(o: HitObject): GeoLine[] {
  if (o.type !== 'slider') return [];
  const pts = allPoints(o);
  if (pts.length < 2) return [];
  const mk = (a: Pt, b: Pt): GeoLine | null => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return len < 1e-6 ? null : { x: a.x, y: a.y, dx: dx / len, dy: dy / len };
  };
  if (o.curveType === 'L') {
    const l = mk(pts[0], pts[pts.length - 1]);
    return l ? [l] : [];
  }
  const segs = segments(pts);
  const first = segs[0], last = segs[segs.length - 1];
  const out: GeoLine[] = [];
  if (first[1] - first[0] === 1) { const l = mk(pts[first[0]], pts[first[1]]); if (l) out.push(l); }
  if (last[0] !== first[0] && last[1] - last[0] === 1) { const l = mk(pts[last[0]], pts[last[1]]); if (l) out.push(l); }
  return out;
}

/** 无限线裁剪到矩形 (mapping tools Line2.Intersection(Box2)); 返回线段端点, 不相交返回 null */
export function clipLineToBox(
  l: GeoLine, left: number, top: number, right: number, bottom: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  let t0 = -Infinity, t1 = Infinity;
  if (Math.abs(l.dx) < 1e-9) {
    if (l.x < left || l.x > right) return null;
  } else {
    let ta = (left - l.x) / l.dx, tb = (right - l.x) / l.dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (Math.abs(l.dy) < 1e-9) {
    if (l.y < top || l.y > bottom) return null;
  } else {
    let ta = (top - l.y) / l.dy, tb = (bottom - l.y) / l.dy;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (t0 > t1) return null;
  return { x1: l.x + t0 * l.dx, y1: l.y + t0 * l.dy, x2: l.x + t1 * l.dx, y2: l.y + t1 * l.dy };
}

/**
 * 辅助几何吸附 (mapping tools RelevantObject.NearestPoint + GetNearestDrawable 偏置):
 * - 点: 欧氏距离, 候选 = 点自身, 偏置 -3 (PointsBias=3, 点优先于线/圆)
 * - 圆: |到圆心距离 - 半径|, 候选 = 径向投射到圆周
 * - 线: 到无限直线垂直距离, 候选 = 垂足
 * 阈值 = OBJECT_SNAP_RADIUS (6.4 osu px, 与物件吸附相同); 命中返回最近候选, 否则 null
 */
export function geoHelperSnap(p: Pt, lines: GeoLine[], circles: GeoCircle[], points: Pt[]): Pt | null {
  let best: Pt | null = null, bestScore = OBJECT_SNAP_RADIUS;
  for (const t of points) {
    const d = Math.hypot(t.x - p.x, t.y - p.y) - 3;
    if (d < bestScore) { bestScore = d; best = t; }
  }
  for (const c of circles) {
    const dc = Math.hypot(p.x - c.cx, p.y - c.cy);
    if (dc < 1e-6) continue;
    const d = Math.abs(dc - c.r);
    if (d < bestScore) {
      bestScore = d;
      best = { x: c.cx + (p.x - c.cx) / dc * c.r, y: c.cy + (p.y - c.cy) / dc * c.r };
    }
  }
  for (const l of lines) {
    const t = (p.x - l.x) * l.dx + (p.y - l.y) * l.dy;
    const fx = l.x + t * l.dx, fy = l.y + t * l.dy;
    const d = Math.hypot(p.x - fx, p.y - fy);
    if (d < bestScore) { bestScore = d; best = { x: fx, y: fy }; }
  }
  return best;
}
