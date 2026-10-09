// v66: 手绘滑条 — osu-framework PathApproximator 移植 (B 样条相关子集)
// 来源: osu.Framework/Utils/PathApproximator.cs (BSplineToPiecewiseLinear / PiecewiseLinearToBSpline 及全部私有依赖)
export interface Vec { x: number; y: number; }

export const BEZIER_TOLERANCE = 0.25;

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
const lenSq = (a: Vec): number => a.x * a.x + a.y * a.y;
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- BSplineToPiecewiseLinear (Boehm 节点插入转 Bezier + 自适应细分) ----------

function bezierIsFlatEnough(controlPoints: Vec[]): boolean {
  for (let i = 1; i < controlPoints.length - 1; i++) {
    const d = add(sub(controlPoints[i - 1], scale(controlPoints[i], 2)), controlPoints[i + 1]);
    if (lenSq(d) > BEZIER_TOLERANCE * BEZIER_TOLERANCE * 4) return false;
  }
  return true;
}

/** De Casteljau 中点细分: 返回 [左半, 右半] 两组 count 控制点 */
function bezierSubdivide(controlPoints: Vec[]): [Vec[], Vec[]] {
  const count = controlPoints.length;
  const midpoints = controlPoints.map(p => ({ ...p }));
  const l: Vec[] = [];
  const r: Vec[] = new Array(count);
  for (let i = 0; i < count; i++) {
    l.push(midpoints[0]);
    r[count - i - 1] = midpoints[count - i - 1];
    for (let j = 0; j < count - i - 1; j++)
      midpoints[j] = scale(add(midpoints[j], midpoints[j + 1]), 0.5);
  }
  return [l, r];
}

/** De Casteljau 扩展: 用与原控制点等量的点逼近 Bezier 曲线 */
function bezierApproximate(controlPoints: Vec[], output: Vec[]): void {
  const count = controlPoints.length;
  const [l0, r] = bezierSubdivide(controlPoints);
  const l: Vec[] = [...l0];
  for (let i = 0; i < count - 1; ++i) l.push(r[i + 1]);
  output.push(controlPoints[0]);
  for (let i = 1; i < count - 1; ++i) {
    const index = 2 * i;
    output.push(scale(add(add(l[index - 1], scale(l[index], 2)), l[index + 1]), 0.25));
  }
}

/** Boehm 算法把 B 样条在节点处细分为一系列 Bezier 段 (返回正序段列与可能被下调的 degree) */
function bSplineToBezierInternal(controlPoints: Vec[], degreeIn: number): { segments: Vec[][]; degree: number } {
  const degree = Math.min(degreeIn, controlPoints.length - 1);
  const pointCount = controlPoints.length - 1;
  const points = controlPoints.map(p => ({ ...p }));
  const segments: Vec[][] = [];
  if (degree === pointCount) {
    segments.push(points);
  } else {
    for (let i = 0; i < pointCount - degree; i++) {
      const subBezier: Vec[] = new Array(degree + 1);
      subBezier[0] = points[i];
      for (let j = 0; j < degree - 1; j++) {
        subBezier[j + 1] = points[i + 1];
        for (let k = 1; k < degree - j; k++) {
          const l = Math.min(k, pointCount - degree - i);
          points[i + k] = scale(add(scale(points[i + k], l), points[i + k + 1]), 1 / (l + 1));
        }
      }
      subBezier[degree] = points[i + 1];
      segments.push(subBezier);
    }
    segments.push(points.slice(pointCount - degree));
  }
  return { segments, degree };
}

/** clamped 均匀 B 样条 -> 分段线性逼近 (degree 过大时退化为 Bezier) */
export function bSplineToPiecewiseLinear(controlPoints: Vec[], degreeIn: number): Vec[] {
  if (controlPoints.length < 2) return controlPoints.length === 0 ? [] : [{ ...controlPoints[0] }];
  const { segments } = bSplineToBezierInternal(controlPoints, degreeIn);
  const output: Vec[] = [];
  const stack = [...segments].reverse(); // pop = 正序 (C# Stack 反转后等价)
  while (stack.length > 0) {
    const parent = stack.pop()!;
    if (bezierIsFlatEnough(parent)) {
      bezierApproximate(parent, output);
      continue;
    }
    const [l, r] = bezierSubdivide(parent);
    stack.push(r);
    stack.push(l);
  }
  output.push(controlPoints[controlPoints.length - 1]);
  return output;
}

/**
 * v73: clamped 均匀 B 样条 -> 一系列 Bezier 锚点 (framework PathApproximator.BSplineToBezier):
 * Boehm 节点插入后的各 piece 平铺, 相邻 piece 共享端点 => 结果中保留连续重复点。
 * 控制点 <= degree+1 个时退化为单条 Bezier (= 原样返回)。
 */
export function bSplineToBezier(controlPoints: Vec[], degreeIn: number): Vec[] {
  if (controlPoints.length < 2) return controlPoints.length === 0 ? [] : [{ ...controlPoints[0] }];
  const { segments } = bSplineToBezierInternal(controlPoints, degreeIn);
  const out: Vec[] = [];
  for (const seg of segments) for (const p of seg) out.push(p);
  return out;
}

/**
 * v377: 'B4' (lazer 内存扩展 B 样条) -> stable 兼容 'B' 控制点列, 锚点尽量少 (soulten: 红锚点分段不好改)。
 * 双候选取锚点少者: Schneider/Graphics Gems FitCurve 容差拟合 (光滑笔迹锚点远少于精确转换)
 *   与 Boehm 精确转换 (退化单条 Bezier / 高抖动段更省且零误差);
 *   原红锚点 (连续重复点) 切段保留, 段间接缝重复点 = stable 红锚点分段 (stable 唯一的分段方式)。
 * 放在本文件 (而非 sliderPath.ts) 以避免 parser <-> sliderPath 循环依赖。
 */
export const BSPLINE_FIT_TOLERANCE = 1.0; // px — 拟合最大偏差 (亚像素级, 远低于游玩可见阈值)

// ---------- Graphics Gems FitCurve (Schneider) 三次贝塞尔最小锚点拟合 ----------

const normalize = (v: Vec): Vec => { const l = Math.hypot(v.x, v.y); return l > 1e-12 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }; };

/** 弦长参数化 points[first..last] -> u[] (0..1) */
function chordLengthParameterize(points: Vec[], first: number, last: number): number[] {
  const u: number[] = new Array(last - first + 1);
  u[0] = 0;
  for (let i = first + 1; i <= last; i++) u[i - first] = u[i - first - 1] + dist(points[i], points[i - 1]);
  const total = u[last - first];
  if (total < 1e-12) { for (let i = 1; i <= last - first; i++) u[i] = i / (last - first); return u; }
  for (let i = 1; i <= last - first; i++) u[i] /= total;
  return u;
}

/** 最小二乘生成三次贝塞尔 (端点固定, 两端切线方向固定, 求 alpha) */
function generateBezier(points: Vec[], first: number, last: number, u: number[], tHat1: Vec, tHat2: Vec): [Vec, Vec, Vec, Vec] {
  const p0 = points[first], p3 = points[last];
  const nPts = last - first + 1;
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < nPts; i++) {
    const t = u[i];
    const b0 = (1 - t) ** 3, b1 = 3 * t * (1 - t) ** 2, b2 = 3 * t * t * (1 - t), b3 = t ** 3;
    const a1 = { x: tHat1.x * b1, y: tHat1.y * b1 };
    const a2 = { x: tHat2.x * b2, y: tHat2.y * b2 };
    c00 += a1.x * a1.x + a1.y * a1.y;
    c01 += a1.x * a2.x + a1.y * a2.y;
    c11 += a2.x * a2.x + a2.y * a2.y;
    const tmp = sub(points[first + i], add(scale(p0, b0 + b1), scale(p3, b2 + b3)));
    x0 += a1.x * tmp.x + a1.y * tmp.y;
    x1 += a2.x * tmp.x + a2.y * tmp.y;
  }
  const det = c00 * c11 - c01 * c01;
  let alphaL = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0;
  let alphaR = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
  const segLength = dist(p0, p3);
  const epsilon = 1e-6 * segLength;
  if (alphaL < epsilon || alphaR < epsilon) { // 退化: 1/3 弦长
    alphaL = alphaR = segLength / 3;
  }
  return [p0, add(p0, scale(tHat1, alphaL)), add(p3, scale(tHat2, alphaR)), p3];
}

/** 三次贝塞尔求值 */
function bezierAt(bez: [Vec, Vec, Vec, Vec], t: number): Vec {
  const mt = 1 - t;
  return {
    x: bez[0].x * mt ** 3 + bez[1].x * 3 * t * mt * mt + bez[2].x * 3 * t * t * mt + bez[3].x * t ** 3,
    y: bez[0].y * mt ** 3 + bez[1].y * 3 * t * mt * mt + bez[2].y * 3 * t * t * mt + bez[3].y * t ** 3,
  };
}

/** 最大平方误差与分裂点 */
function computeMaxError(points: Vec[], first: number, last: number, bez: [Vec, Vec, Vec, Vec], u: number[]): { maxSq: number; split: number } {
  let maxSq = 0, split = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const p = bezierAt(bez, u[i - first]);
    const d = sub(p, points[i]);
    const sq = d.x * d.x + d.y * d.y;
    if (sq > maxSq) { maxSq = sq; split = i; }
  }
  return { maxSq, split };
}

/** Newton-Raphson 重参数化一轮 */
function reparameterize(points: Vec[], first: number, last: number, u: number[], bez: [Vec, Vec, Vec, Vec]): number[] {
  const out = u.slice();
  for (let i = first; i <= last; i++) {
    const t = u[i - first];
    const p = bezierAt(bez, t);
    const d1: Vec = { // Q'(t)
      x: 3 * (1 - t) ** 2 * (bez[1].x - bez[0].x) + 6 * (1 - t) * t * (bez[2].x - bez[1].x) + 3 * t * t * (bez[3].x - bez[2].x),
      y: 3 * (1 - t) ** 2 * (bez[1].y - bez[0].y) + 6 * (1 - t) * t * (bez[2].y - bez[1].y) + 3 * t * t * (bez[3].y - bez[2].y),
    };
    const d2: Vec = { // Q''(t)
      x: 6 * (1 - t) * (bez[2].x - 2 * bez[1].x + bez[0].x) + 6 * t * (bez[3].x - 2 * bez[2].x + bez[1].x),
      y: 6 * (1 - t) * (bez[2].y - 2 * bez[1].y + bez[0].y) + 6 * t * (bez[3].y - 2 * bez[2].y + bez[1].y),
    };
    const diff = sub(p, points[i]);
    const num = diff.x * d1.x + diff.y * d1.y;
    const den = d1.x * d1.x + d1.y * d1.y + diff.x * d2.x + diff.y * d2.y;
    if (Math.abs(den) > 1e-12) out[i - first] = Math.max(0, Math.min(1, t - num / den));
  }
  return out;
}

/** 递归拟合, 每段输出 4 个控制点 push 到 pieces */
function fitCubic(points: Vec[], first: number, last: number, tHat1: Vec, tHat2: Vec, error: number, pieces: [Vec, Vec, Vec, Vec][]): void {
  const nPts = last - first + 1;
  const p0 = points[first], p3 = points[last];
  if (nPts === 2) { // 两点 => 直线段 (1/3, 2/3 控制点)
    const d = dist(p0, p3) / 3;
    pieces.push([p0, add(p0, scale(tHat1, d)), add(p3, scale(tHat2, d)), p3]);
    return;
  }
  let u = chordLengthParameterize(points, first, last);
  let bez = generateBezier(points, first, last, u, tHat1, tHat2);
  let { maxSq, split } = computeMaxError(points, first, last, bez, u);
  if (maxSq < error * error) { pieces.push(bez); return; }
  if (maxSq < 4 * error * error) { // 接近容差: 重参数化一轮再试
    u = reparameterize(points, first, last, u, bez);
    bez = generateBezier(points, first, last, u, tHat1, tHat2);
    ({ maxSq, split } = computeMaxError(points, first, last, bez, u));
    if (maxSq < error * error) { pieces.push(bez); return; }
  }
  // 分裂: 中心切线 = (prev - next) 归一 (Graphics Gems ComputeCenterTangent 的等价反向约定)
  const tHatCenter = normalize(sub(points[split - 1], points[split + 1]));
  fitCubic(points, first, split, tHat1, tHatCenter, error, pieces);
  fitCubic(points, split, last, { x: -tHatCenter.x, y: -tHatCenter.y }, tHat2, error, pieces);
}

/**
 * 折线 -> 三次贝塞尔锚点列 (Schneider 拟合): 相邻 piece 接缝保留连续重复点 (stable 红锚点分段)。
 * 端点切线取首末弦方向; maxError 单位 px。
 */
export function fitBezierToPolyline(input: Vec[], maxError: number): Vec[] {
  // 预处理: 去零长重复点 (拟合对密集采样点敏感)
  const points: Vec[] = [];
  for (const p of input) {
    if (points.length === 0 || dist(p, points[points.length - 1]) > 1e-9) points.push(p);
  }
  if (points.length < 2) return points.map(p => ({ ...p }));
  const tHat1 = normalize(sub(points[1], points[0]));
  const tHat2 = normalize(sub(points[points.length - 2], points[points.length - 1]));
  const pieces: [Vec, Vec, Vec, Vec][] = [];
  fitCubic(points, 0, points.length - 1, tHat1, tHat2, maxError, pieces);
  const out: Vec[] = [pieces[0][0]];
  for (const bez of pieces) {
    out.push(bez[1], bez[2], bez[3]);
    out.push({ ...bez[3] }); // 接缝重复点 = 红锚点 (stable 分段)
  }
  out.pop(); // 末段后不需要重复
  return out;
}

export function bsplineToStableBezier<T extends Vec>(pts: T[], degree = 4, maxError = BSPLINE_FIT_TOLERANCE): Vec[] {
  // 按连续重复点 (红锚点) 切段 (与 sliderPath bsplineRawPath 同款约定), 各段独立转换后以重复点接回
  const segs: T[][] = [];
  let cur: T[] = [];
  for (const p of pts) {
    if (cur.length > 0 && p.x === cur[cur.length - 1].x && p.y === cur[cur.length - 1].y) { segs.push(cur); cur = []; }
    cur.push(p);
  }
  segs.push(cur);
  const out: Vec[] = [];
  for (const seg of segs) {
    if (seg.length === 0) continue;
    // 双候选取锚点少者 (同点数取拟合 — 段内光滑无红锚点更好改):
    //   a) Boehm 精确转换 (退化单条 Bezier 时 0 误差且锚点最少; 高抖动锯齿段也常更省)
    //   b) Schneider 容差拟合 (光滑手绘笔迹锚点远少于精确转换, 偏差 <= maxError)
    const exact = bSplineToBezier(seg, degree);
    const fitted = fitBezierToPolyline(bSplineToPiecewiseLinear(seg, degree), maxError);
    const best = fitted.length < exact.length ? fitted : exact;
    for (const p of best) out.push(p); // 段间端点相同, 直接相接即成分段重复点 (红锚点拐角保留)
  }
  return out;
}


// ---------- PiecewiseLinearToBSpline (Adam 优化最小二乘拟合) ----------

function linspace(start: number, end: number, count: number): number[] {
  const result = new Array(count);
  for (let i = 0; i < count; i++) result[i] = start + (end - start) * i / (count - 1);
  return result;
}

/** (2,m) 点列的归一化累计距离分布 */
function getDistanceDistribution(points: number[][], result: number[], regularizingFactor = 0): void {
  const m = points[0].length;
  let accumulator = 0;
  result[0] = 0;
  for (let i = 1; i < m; i++) {
    accumulator += Math.hypot(points[0][i] - points[0][i - 1], points[1][i] - points[1][i - 1]) + regularizingFactor;
    result[i] = accumulator;
  }
  for (let i = 0; i < m; i++) result[i] /= accumulator;
}

/** 输入路径的弧长参数化插值器 */
class Interpolator {
  private readonly ny: number;
  private readonly ys: number[][]; // [resolution][2]

  constructor(inputPath: Vec[], resolution = 1000) {
    const n = inputPath.length;
    const distArr = new Array(n);
    let acc = 0;
    distArr[0] = 0;
    for (let i = 1; i < n; i++) {
      acc += dist(inputPath[i], inputPath[i - 1]);
      distArr[i] = acc;
    }
    for (let i = 0; i < n; i++) distArr[i] /= acc;

    this.ny = resolution;
    this.ys = new Array(resolution);
    let current = 0;
    for (let i = 0; i < resolution; i++) {
      const target = i / (resolution - 1);
      while (distArr[current] < target) current++;
      const prev = Math.max(0, current - 1);
      const currDist = distArr[current];
      const prevDist = distArr[prev];
      let t = (currDist - target) / (currDist - prevDist);
      if (Number.isNaN(t)) t = 0;
      this.ys[i] = [
        t * inputPath[prev].x + (1 - t) * inputPath[current].x,
        t * inputPath[prev].y + (1 - t) * inputPath[current].y,
      ];
    }
  }

  interpolate(x: number[], result: number[][]): void {
    const nx = x.length;
    for (let i = 0; i < nx; i++) {
      const idx = x[i] * (this.ny - 1);
      let idxBelow = Math.floor(idx);
      const idxAbove = Math.min(idxBelow + 1, this.ny - 1);
      idxBelow = Math.max(idxAbove - 1, 0);
      const t = idx - idxBelow;
      result[0][i] = t * this.ys[idxAbove][0] + (1 - t) * this.ys[idxBelow][0];
      result[1][i] = t * this.ys[idxAbove][1] + (1 - t) * this.ys[idxBelow][1];
    }
  }
}

/** Cox-de Boor 计算 B 样条基函数矩阵 [numTestPoints][numControlPoints] */
function generateBSplineWeights(numControlPoints: number, numTestPoints: number, degree: number): number[][] {
  const x = linspace(0, 1, numTestPoints);
  const knots = new Array(numControlPoints + degree + 1).fill(0);
  for (let i = 0; i < degree; i++) {
    knots[i] = 0;
    knots[numControlPoints + degree - i] = 1;
  }
  for (let i = degree; i < numControlPoints + 1; i++)
    knots[i] = (i - degree) / (numControlPoints - degree);

  const prevOrder: number[][] = Array.from({ length: numTestPoints }, () => new Array(numControlPoints).fill(0));
  // C#: (int)MathHelper.Clamp(x*(ncp-degree), 0, ncp-degree-1) — Clamp 后 (int) 截断
  for (let i = 0; i < numTestPoints; i++) {
    const clamped = Math.max(0, Math.min(numControlPoints - degree - 1, x[i] * (numControlPoints - degree)));
    prevOrder[i][Math.trunc(clamped)] = 1;
  }

  for (let q = 1; q < degree + 1; q++) {
    for (let i = 0; i < numTestPoints; i++) {
      let prevAlpha = 0;
      for (let j = 0; j < numControlPoints - degree + q - 1; j++) {
        const alpha = (x[i] - knots[degree - q + 1 + j]) / (knots[degree + 1 + j] - knots[degree - q + 1 + j]);
        const alphaVal = alpha * prevOrder[i][j];
        const betaVal = (1 - alpha) * prevOrder[i][j];
        prevOrder[i][j] = prevAlpha + betaVal;
        prevAlpha = alphaVal;
      }
      prevOrder[i][numControlPoints - degree + q - 1] = prevAlpha;
    }
  }
  return prevOrder;
}

/** (m,p) × (n,p) -> (m,n) (C# 同款非标准 matmul, 约减维连续) */
function matmul(mat1: number[][], mat2: number[][], result: number[][]): void {
  const m = mat1.length, n = mat2.length, p = mat1[0].length;
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < p; k++) s += mat1[i][k] * mat2[j][k];
      result[i][j] = s;
    }
}

function adamUpdate(parameters: number[][], m: number[][], v: number[][], step: number, learningRate: number, b1: number, b2: number): void {
  const epsilon = 1e-8;
  const mMult = 1 / (1 - Math.pow(b1, step + 1));
  const vMult = 1 / (1 - Math.pow(b2, step + 1));
  for (let i = 0; i < parameters.length; i++)
    for (let j = 0; j < parameters[i].length; j++) {
      const mCorr = m[i][j] * mMult;
      const vCorr = v[i][j] * vMult;
      parameters[i][j] -= learningRate * mCorr / (Math.sqrt(vCorr) + epsilon);
    }
}

/** 任意样条的最小二乘拟合 (Adam 优化); weights [numTestPoints][numControlPoints] */
function piecewiseLinearToSpline(
  inputPath: Vec[], weights: number[][], maxIterations: number, learningRate: number,
  b1: number, b2: number, initialControlPoints: Vec[] | undefined, learnableMask: number[][] | undefined,
): Vec[] {
  const numControlPoints = weights[0].length;
  const numTestPoints = weights.length;

  const weightsTranspose: number[][] = Array.from({ length: numControlPoints }, () => new Array(numTestPoints));
  for (let i = 0; i < numControlPoints; i++)
    for (let j = 0; j < numTestPoints; j++)
      weightsTranspose[i][j] = weights[j][i];

  const interpolator = new Interpolator(inputPath, numTestPoints);

  const labels: number[][] = [new Array(numTestPoints).fill(0), new Array(numTestPoints).fill(0)];
  const controlPoints: number[][] = [new Array(numControlPoints).fill(0), new Array(numControlPoints).fill(0)];
  if (initialControlPoints) {
    for (let i = 0; i < numControlPoints; i++) {
      controlPoints[0][i] = initialControlPoints[i].x;
      controlPoints[1][i] = initialControlPoints[i].y;
    }
  } else {
    interpolator.interpolate(linspace(0, 1, numControlPoints), controlPoints);
  }

  const m: number[][] = [new Array(numControlPoints).fill(0), new Array(numControlPoints).fill(0)];
  const v: number[][] = [new Array(numControlPoints).fill(0), new Array(numControlPoints).fill(0)];

  let mask = learnableMask;
  if (!mask) {
    mask = [new Array(numControlPoints).fill(0), new Array(numControlPoints).fill(0)];
    for (let i = 1; i < numControlPoints - 1; i++) {
      mask[0][i] = 1;
      mask[1][i] = 1;
    }
  }

  const points: number[][] = [new Array(numTestPoints).fill(0), new Array(numTestPoints).fill(0)];
  const grad: number[][] = [new Array(numControlPoints).fill(0), new Array(numControlPoints).fill(0)];
  const distanceDistribution = new Array(numTestPoints).fill(0);

  for (let step = 0; step < maxIterations; step++) {
    matmul(controlPoints, weights, points);
    if (step % 11 === 0) {
      getDistanceDistribution(points, distanceDistribution, 0.1);
      interpolator.interpolate(distanceDistribution, labels);
    }
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < numTestPoints; j++) points[i][j] = labels[i][j] - points[i][j];
    matmul(points, weightsTranspose, grad);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < numControlPoints; j++) {
        grad[i][j] *= -1 / numControlPoints;
        grad[i][j] *= mask[i][j];
      }
    // m = m*b1 + grad*(1-b1); v = v*b2 + grad²*(1-b2)
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < numControlPoints; j++) {
        m[i][j] = m[i][j] * b1 + grad[i][j] * (1 - b1);
        v[i][j] = v[i][j] * b2 + grad[i][j] * grad[i][j] * (1 - b2);
      }
    adamUpdate(controlPoints, m, v, step, learningRate, b1, b2);
  }

  const result: Vec[] = [];
  for (let i = 0; i < numControlPoints; i++) result.push({ x: controlPoints[0][i], y: controlPoints[1][i] });
  return result;
}

/** 分段线性路径 -> B 样条最小二乘拟合 (degree 自动下调到 numControlPoints-1) */
export function piecewiseLinearToBSpline(
  inputPath: Vec[], numControlPoints: number, degreeIn: number,
  numTestPoints = 100, maxIterations = 100, learningRate = 8,
  b1 = 0.8, b2 = 0.99,
  initialControlPoints?: Vec[], learnableMask?: number[][],
): Vec[] {
  const degree = Math.min(degreeIn, numControlPoints - 1);
  numTestPoints = Math.max(numTestPoints, 3);
  return piecewiseLinearToSpline(inputPath, generateBSplineWeights(numControlPoints, numTestPoints, degree),
    maxIterations, learningRate, b1, b2, initialControlPoints, learnableMask);
}
