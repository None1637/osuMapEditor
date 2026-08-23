// v66: 手绘滑条 — lazer SliderPlacementBlueprint.tryCircleArc / updateSliderPathFromBSplineBuilder 移植
// (osu.Game.Rulesets.Osu/Edit/Blueprints/Sliders/SliderPlacementBlueprint.cs:440-554)
// 每段先尝试用 3 点圆弧替代 (损失 ≤ CircleThreshold 且单向弯曲不超过一圈), 否则保留 B 样条段
// v73: 移植 BezierConverter.ConvertCircleToBezierAnchors (圆预设, 供 stable 兼容导出备用) + continue 语义修正
// v74: 落盘改 'B4' (lazer 扩展格式, 控制点 = builder 原始输出); 弧特判仅单段 (整条 'P'),
//      多段内弧段保留 B 样条控制点 (v73 曾转贝塞尔锚点落 'B', 控制点过多, 与 lazer 编辑器不一致)
import { bSplineToPiecewiseLinear, type Vec } from './pathApproximator';

export interface ArcProps {
  isValid: boolean;
  thetaStart: number;
  thetaRange: number;
  direction: number;
  radius: number;
  centre: Vec;
}

/** CircularArcProperties(3 点) 移植 (外接圆; 退化三角形 => invalid) */
export function circularArcProperties(a: Vec, b: Vec, c: Vec): ArcProps {
  const invalid: ArcProps = { isValid: false, thetaStart: 0, thetaRange: 0, direction: 0, radius: 0, centre: { x: 0, y: 0 } };
  // Precision.AlmostEquals(0, cross) — framework FLOAT_EPSILON = 1e-3
  if (Math.abs((b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y)) < 1e-3) return invalid;

  // https://en.wikipedia.org/wiki/Circumscribed_circle#Cartesian_coordinates_2
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const aSq = a.x * a.x + a.y * a.y;
  const bSq = b.x * b.x + b.y * b.y;
  const cSq = c.x * c.x + c.y * c.y;
  const centre = {
    x: (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d,
    y: (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d,
  };

  const radius = Math.hypot(a.x - centre.x, a.y - centre.y);
  const thetaStart = Math.atan2(a.y - centre.y, a.x - centre.x);
  let thetaEnd = Math.atan2(c.y - centre.y, c.x - centre.x);
  while (thetaEnd < thetaStart) thetaEnd += 2 * Math.PI;

  let direction = 1;
  let thetaRange = thetaEnd - thetaStart;

  // 按 B 在 AC 的哪一侧决定绘制方向
  const orthoX = c.y - a.y, orthoY = -(c.x - a.x);
  if (orthoX * (b.x - a.x) + orthoY * (b.y - a.y) < 0) {
    direction = -direction;
    thetaRange = 2 * Math.PI - thetaRange;
  }

  return { isValid: true, thetaStart, thetaRange, direction, radius, centre };
}

/**
 * 段 -> 3 点圆弧控制点 ([起, 中, 尾]), 不是合理圆弧则 null。
 * 判定: 弧长 ≤ 1000; 各采样点到圆周的距离均方损失 ≤ circleThreshold; 单向弯曲且总转角 ≤ 一圈。
 */
export function tryCircleArc(segment: Vec[], degree: number, circleThreshold: number): Vec[] | null {
  if (segment.length < 3 || circleThreshold === 0) return null;

  const points = bSplineToPiecewiseLinear(segment, degree);
  const circleArcControlPoints = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
  const arc = circularArcProperties(circleArcControlPoints[0], circleArcControlPoints[1], circleArcControlPoints[2]);
  if (!arc.isValid) return null;

  const length = arc.thetaRange * arc.radius;
  if (length > 1000) return null;

  let loss = 0;
  let lastPoint: Vec | null = null;
  let lastVec: Vec | null = null;
  let lastVec2: Vec | null = null;
  let lastDir: number | null = null;
  let lastDir2: number | null = null;
  let totalWinding = 0;

  for (const point of points) {
    const vec = { x: point.x - arc.centre.x, y: point.y - arc.centre.y };
    loss += Math.pow((Math.hypot(vec.x, vec.y) - arc.radius) / length, 2);

    if (lastVec) {
      const det = lastVec.x * vec.y - lastVec.y * vec.x;
      const dir = Math.sign(det);
      // v73: C# continue 语义 — dir==0 时跳过后续全部状态更新 (lastVec/lastVec2/lastPoint)
      if (dir === 0) continue;
      if (lastDir !== null && dir !== lastDir) return null; // 圆心不在多边形内
      lastDir = dir;
    }
    lastVec = vec;

    if (lastPoint) {
      const vec2 = { x: point.x - lastPoint.x, y: point.y - lastPoint.y };
      if (lastVec2) {
        const dotV = vec2.x * lastVec2.x + vec2.y * lastVec2.y;
        const detV = lastVec2.x * vec2.y - lastVec2.y * vec2.x;
        const angle = Math.atan2(detV, dotV);
        const dir2 = Math.sign(angle);
        // v73: C# continue 语义 — 跳过 lastVec2/lastPoint 更新 (lastVec 已更新)
        if (dir2 === 0) continue;
        if (lastDir2 !== null && dir2 !== lastDir2) return null; // 曲率变向 (S 形)
        totalWinding += Math.abs(angle);
        lastDir2 = dir2;
      }
      lastVec2 = vec2;
    }
    lastPoint = point;
  }

  loss /= points.length;
  return loss > circleThreshold || totalWinding > 2 * Math.PI ? null : circleArcControlPoints;
}

export interface FitPoint { x: number; y: number; red: boolean }

// ---------- v73: BezierConverter.ConvertCircleToBezierAnchors 移植 (osu.Game/Rulesets/Objects/BezierConverter.cs:28-40,195-253) ----------
// 多段滑条内的圆弧段不能像单段那样存 'P' (stable 只有整条滑条一种 curveType),
// lazer 导出 stable 时用圆预设贝塞尔锚点高精度逼近; 单段整弧仍走原生 'P' (见 fitSegmentsToPoints)

const CIRCLE_PRESETS: { arcLength: number; cps: [number, number][] }[] = [
  { arcLength: 0.4993379862754501, cps: [[1, 0], [1, 0.2549893626632736], [0.8778997558480327, 0.47884446188920726]] },
  { arcLength: 1.7579419829169447, cps: [[1, 0], [1, 0.6263026], [0.42931178, 1.0990661], [-0.18605515, 0.9825393]] },
  { arcLength: 3.1385246920140215, cps: [[1, 0], [1, 0.87084764], [0.002304826, 1.5033062], [-0.9973236, 0.8739115], [-0.9999953, 0.0030679568]] },
  { arcLength: 5.69720464620727, cps: [[1, 0], [1, 1.4137783], [-1.4305235, 2.0779421], [-2.3410065, -0.94017583], [0.05132711, -1.7309346], [0.8331702, -0.5530167]] },
  { arcLength: 2 * Math.PI, cps: [[1, 0], [1, 1.2447058], [-0.8526471, 2.118367], [-2.6211002, 7.854936e-06], [-0.8526448, -2.118357], [1, -1.2447058], [1, 0]] },
];

/** 3 点圆弧 -> 贝塞尔锚点列 (圆预设 + de Casteljau 收敛到 thetaRange; 非 3 点/退化弧 => 原样返回) */
export function convertCircleToBezierAnchors(controlPoints: Vec[]): Vec[] {
  if (controlPoints.length !== 3) return controlPoints.slice();
  const pr = circularArcProperties(controlPoints[0], controlPoints[1], controlPoints[2]);
  if (!pr.isValid) return controlPoints.slice();

  let preset = CIRCLE_PRESETS[CIRCLE_PRESETS.length - 1];
  for (const cbp of CIRCLE_PRESETS) {
    if (cbp.arcLength < pr.thetaRange) continue;
    preset = cbp;
    break;
  }

  let arcLength = preset.arcLength;
  const arc: [number, number][] = preset.cps.map(p => [p[0], p[1]]);

  // 收敛到 thetaRange (de Casteljau 在 t=tf 处取子曲线)
  const n = arc.length - 1;
  let tf = pr.thetaRange / arcLength;
  while (Math.abs(tf - 1) > 1e-7) {
    for (let j = 0; j < n; j++) {
      for (let i = n; i > j; i--) {
        arc[i] = [arc[i][0] * tf + arc[i - 1][0] * (1 - tf), arc[i][1] * tf + arc[i - 1][1] * (1 - tf)];
      }
    }
    arcLength = Math.atan2(arc[n][1], arc[n][0]);
    if (arcLength < 0) arcLength += 2 * Math.PI;
    tf = pr.thetaRange / arcLength;
  }

  // 旋转/半径/圆心归位
  const cos = Math.cos(pr.thetaStart), sin = Math.sin(pr.thetaStart);
  return arc.map(([x, y]) => ({
    x: (cos * x + -sin * pr.direction * y) * pr.radius + pr.centre.x,
    y: (sin * x + cos * pr.direction * y) * pr.radius + pr.centre.y,
  }));
}

export interface FitResult {
  /** 相对头部的控制点列 (points[0] 恒为 (0,0) 即头部; red = 段起点, .osu 红锚点) */
  points: FitPoint[];
  /** 唯一一段且成功圆弧替代 => 整条滑条应为 'P' 三点圆弧 */
  singleArc: boolean;
}

/**
 * builder 段列 -> 滑条控制点列 (lazer updateSliderPathFromBSplineBuilder 同构):
 * 每段首点带类型标记 (=> red 段分隔), 段中间点平铺, 仅末段补尾点。
 * v74: 落盘 curveType = 'B4' (lazer 扩展, degree-4 B 样条, 控制点 = builder 原始输出, 数量少);
 * 弧特判仅单段生效 (整条 'P' 三点, stable 原生); 多段内弧段保留 B 样条控制点
 * ('B4' 渲染形状与弧一致, lazer 虽记 PERFECT_CURVE 段但我方单类型模型不支持混合段类型,
 *  保留 B 样条控制点形状不变且可编辑点更少)。
 */
export function fitSegmentsToPoints(segments: Vec[][], degree: number, circleThreshold: number): FitResult {
  const points: FitPoint[] = [];
  let arcCount = 0;
  let realSegments = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.length === 0) continue;
    realSegments++;
    const isLastSegment = i === segments.length - 1;
    const arc = segments.length === 1 ? tryCircleArc(segment, degree, circleThreshold) : null;
    const red = points.length > 0;

    if (arc) {
      arcCount++;
      points.push({ x: arc[0].x, y: arc[0].y, red });
      points.push({ x: arc[1].x, y: arc[1].y, red: false });
    } else {
      points.push({ x: segment[0].x, y: segment[0].y, red });
      for (let j = 1; j < segment.length - 1; j++)
        points.push({ x: segment[j].x, y: segment[j].y, red: false });
    }

    if (isLastSegment) {
      const end = segment[segment.length - 1];
      points.push({ x: end.x, y: end.y, red: false });
    }
  }

  return { points, singleArc: arcCount === 1 && realSegments === 1 };
}
