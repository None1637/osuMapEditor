// v66: 手绘滑条 — osu-framework IncrementalBSplineBuilder 逐行移植
// 来源: osu.Framework/Utils/IncrementalBSplineBuilder.cs
// 三阶段: 1) FD_EPSILON 间隔采样生成 7 阶平滑 B 样条; 2) 局部曲率极大值阈值检测拐角;
//         3) 段内按 Tolerance×曲率密度布点, 近直线段特判只留两端点; 松开时 200 次最小二乘迭代
import { bSplineToPiecewiseLinear, piecewiseLinearToBSpline, BEZIER_TOLERANCE, type Vec } from './pathApproximator';

/** 样条相关有限差分计算的间距 (lazer FD_EPSILON = 2.0) */
export const FD_EPSILON = BEZIER_TOLERANCE * 8;

const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const norm = (a: Vec): Vec => { const l = Math.hypot(a.x, a.y); return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }; };
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;

function getPathAt(path: Vec[], cumulativeDistances: number[], t: number): Vec {
  if (path.length === 1) return path[0];
  if (t <= 0) return path[0];
  if (t >= cumulativeDistances[cumulativeDistances.length - 1]) return path[path.length - 1];

  // C# List.BinarySearch + 按位取反
  let lo = 0, hi = cumulativeDistances.length - 1, index = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cumulativeDistances[mid] === t) { index = mid; break; }
    if (cumulativeDistances[mid] < t) lo = mid + 1; else hi = mid - 1;
  }
  if (index < 0) index = lo; // C#: ~BinarySearch 返回值再取反 = 插入点

  const lengthBefore = index === 0 ? 0 : cumulativeDistances[index - 1];
  const lengthAfter = cumulativeDistances[index];
  const segmentT = (t - lengthBefore) / (lengthAfter - lengthBefore);
  return lerp(path[index], path[index + 1], segmentT);
}

/** 路径上 t 处的绝对转角 (弧度, 有限差分) */
function getAbsWindingAt(path: Vec[], cumulativeDistances: number[], t: number): number {
  const xminus = getPathAt(path, cumulativeDistances, t - FD_EPSILON);
  const x = getPathAt(path, cumulativeDistances, t);
  const xplus = getPathAt(path, cumulativeDistances, t + FD_EPSILON);
  const tminus = x.x === xminus.x && x.y === xminus.y ? { x: 0, y: 0 } : norm({ x: x.x - xminus.x, y: x.y - xminus.y });
  const tplus = xplus.x === x.x && xplus.y === x.y ? { x: 0, y: 0 } : norm({ x: xplus.x - x.x, y: xplus.y - x.y });
  return Math.abs(Math.acos(Math.max(-1, Math.min(1, dot(tminus, tplus)))));
}

/** 点到线段的最短距离平方 (osu-framework Line.DistanceSquaredToPoint, 段内钳制) */
function distanceSquaredToSegment(a: Vec, b: Vec, p: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return wx * wx + wy * wy;
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return dist(p, b) ** 2;
  const t = c1 / c2;
  return dist(p, { x: a.x + t * vx, y: a.y + t * vy }) ** 2;
}

export class IncrementalBSplineBuilder {
  private inputPath: Vec[] = [];
  private cumulativeInputPathLength: number[] = [];

  degree: number;
  tolerance: number;
  cornerThreshold: number;

  private outputCacheValid = false;
  private outputPath: Vec[] = [];
  private controlPointsValid = false;
  private controlPoints: Vec[][] = [];
  private shouldOptimiseLastSegment = false;
  private finishedDrawing = false;

  constructor(degree = 3, tolerance = 1.5, cornerThreshold = 0.4) {
    this.degree = degree;
    this.tolerance = tolerance;
    this.cornerThreshold = cornerThreshold;
  }

  private get inputPathLength(): number {
    return this.cumulativeInputPathLength.length === 0 ? 0 : this.cumulativeInputPathLength[this.cumulativeInputPathLength.length - 1];
  }

  clear(): void {
    this.inputPath = [];
    this.cumulativeInputPathLength = [];
    this.controlPoints = [];
    this.outputPath = [];
    this.controlPointsValid = false;
    this.outputCacheValid = false;
    this.shouldOptimiseLastSegment = false;
    this.finishedDrawing = false;
  }

  addLinearPoint(v: Vec): void {
    this.outputCacheValid = false;
    this.shouldOptimiseLastSegment = true;

    // 实现细节 (C# 注释): 丢弃小于 FD_EPSILON*2 的输入细节以免干扰转角计算,
    // 但路径末端始终保留一个精确跟随输入的点, 使绘制不"卡"; 因此非空路径至少有两个点
    if (this.inputPath.length === 0) {
      this.inputPath.push(v);
      this.inputPath.push(v);
      this.cumulativeInputPathLength.push(0);
      return;
    }

    this.inputPath[this.inputPath.length - 1] = v;
    const inputDistance = dist(v, this.inputPath[this.inputPath.length - 2]);
    this.cumulativeInputPathLength[this.cumulativeInputPathLength.length - 1] = inputDistance;
    if (this.cumulativeInputPathLength.length > 1)
      this.cumulativeInputPathLength[this.cumulativeInputPathLength.length - 1] +=
        this.cumulativeInputPathLength[this.cumulativeInputPathLength.length - 2];

    if (inputDistance < FD_EPSILON * 2) return;

    this.inputPath.push(v);
    this.cumulativeInputPathLength.push(this.cumulativeInputPathLength[this.cumulativeInputPathLength.length - 1]);
  }

  /** 绘制结束: 末段做完整优化 (100 次迭代, 不用 mask) */
  finish(): void {
    this.outputCacheValid = false;
    this.shouldOptimiseLastSegment = true;
    this.finishedDrawing = true;
  }

  getInputPath(): Vec[] { return [...this.inputPath]; }

  /** 分段线性逼近的输出路径 */
  getOutputPath(): Vec[] {
    if (!this.outputCacheValid) this.redrawApproximatedPath();
    return this.outputPath;
  }

  /** 推断出的 B 样条控制点 (按段分组) */
  getControlPoints(): Vec[][] {
    if (!this.controlPointsValid) this.regenerateFullApproximatedPath();
    if (this.shouldOptimiseLastSegment) this.regenerateLastApproximatedSegment();
    return this.controlPoints;
  }

  /** 用 FD_EPSILON 间隔采样输入路径生成 7 阶平滑 B 样条, 返回平滑顶点与累计距离 */
  private computeSmoothedInputPath(): { vertices: Vec[]; distances: number[] } {
    const cps: Vec[] = [];
    const n = Math.floor(this.inputPathLength / FD_EPSILON);
    for (let i = 0; i < n; ++i)
      cps.push(getPathAt(this.inputPath, this.cumulativeInputPathLength, i * FD_EPSILON));

    const SMOOTHED_INPUT_PATH_DEGREE = 7; // 经验值: 平滑度与锐度的权衡
    const vertices = bSplineToPiecewiseLinear(cps, SMOOTHED_INPUT_PATH_DEGREE);
    const distances: number[] = [];
    let cumulativeLength = 0;
    for (let i = 1; i < vertices.length; ++i) {
      cumulativeLength += dist(vertices[i], vertices[i - 1]);
      distances.push(cumulativeLength);
    }
    return { vertices, distances };
  }

  /** 拐角检测: 局部曲率极大值超过阈值且超过邻域平均 4 倍; 窗口重叠内不重复标记 */
  private detectCorners(vertices: Vec[], distances: number[]): number[] {
    const cornerT: number[] = [0];
    const threshold = this.cornerThreshold / FD_EPSILON;
    const stepSize = FD_EPSILON;
    const nSteps = Math.floor(distances[distances.length - 1] / stepSize);
    const N_AVG_SAMPLES = 32; // 经验值: 32 采样窗口代表邻域曲率
    let avgCurvature = 0;

    for (let i = 0; i < nSteps; ++i) {
      const newt = i * stepSize;
      const newWinding = getAbsWindingAt(vertices, distances, newt);
      const oldt = (i - N_AVG_SAMPLES) * stepSize;
      const oldWinding = oldt < 0 ? 0 : getAbsWindingAt(vertices, distances, oldt);
      avgCurvature += (newWinding - oldWinding) / N_AVG_SAMPLES;

      const midt = (i - N_AVG_SAMPLES / 2) * stepSize;
      const midWinding = midt < 0 ? 0 : getAbsWindingAt(vertices, distances, midt);

      const distToPrevCorner = cornerT.length === 0 ? Number.MAX_VALUE : newt - cornerT[cornerT.length - 1];
      if (midWinding > threshold && midWinding > avgCurvature * 4 && distToPrevCorner > N_AVG_SAMPLES * stepSize)
        cornerT.push(midt);
    }

    cornerT.push(distances[distances.length - 1]); // 路径末端必为拐角
    return cornerT;
  }

  /** 段初始化: 按 Tolerance×曲率密度布控制点; 全程贴近端点连线则只留两端点 */
  private initializeSegment(vertices: Vec[], distances: number[], t0in: number, t1in: number):
    { cps: Vec[]; segmentPath: Vec[]; totalWinding: number } {
    const stepSize = FD_EPSILON;
    let totalWinding = 0;

    const c0 = getPathAt(vertices, distances, t0in);
    const c1 = getPathAt(vertices, distances, t1in);

    const t0 = t0in + stepSize * 2;
    const t1 = t1in - stepSize * 2;

    const cps: Vec[] = [c0];
    const segmentPath: Vec[] = [c0];
    let allOnLine = true;
    const onLineThreshold = 0.02 * this.tolerance * dist(c0, c1);

    if (t1 > t0) {
      const nSteps = Math.floor((t1 - t0) / stepSize);
      let currentWinding = 0.5 * this.tolerance;

      for (let j = 0; j < nSteps; ++j) {
        const t = t0 + j * stepSize;
        const winding = getAbsWindingAt(vertices, distances, t);
        totalWinding += winding;
        currentWinding += winding;

        const p = getPathAt(vertices, distances, t);
        segmentPath.push(p);

        if (currentWinding < this.tolerance) continue;

        if (distanceSquaredToSegment(c0, c1, p) > onLineThreshold * onLineThreshold)
          allOnLine = false;

        cps.push(p);
        currentWinding -= this.tolerance;
      }
    }

    cps.push(c1);
    segmentPath.push(c1);

    return allOnLine ? { cps: [c0, c1], segmentPath, totalWinding } : { cps, segmentPath, totalWinding };
  }

  private updateLastSegment(vertices: Vec[], distances: number[], cornerTs: number[], segments: Vec[][],
    iterations: number, mask: boolean): void {
    if (segments.length === 0 || segments.length >= cornerTs.length) return;

    const i = segments.length - 1;
    const lastSegment = segments[i];
    const { cps, segmentPath, totalWinding } = this.initializeSegment(vertices, distances, cornerTs[i], cornerTs[i + 1]);

    // 保证末段端点正确
    if (lastSegment.length >= 1) lastSegment[0] = cps[0];
    else lastSegment.push(cps[0]);
    if (lastSegment.length >= 2) lastSegment[lastSegment.length - 1] = cps[cps.length - 1];
    else lastSegment.push(cps[cps.length - 1]);

    // 保证末段控制点数量正确
    if (cps.length > lastSegment.length) {
      const toAdd = cps.length - lastSegment.length;
      for (let j = 0; j < toAdd; j++)
        lastSegment.splice(lastSegment.length - 1, 0, cps[j + cps.length - toAdd - 1]);
    } else if (cps.length < lastSegment.length) {
      const toRemove = lastSegment.length - cps.length;
      lastSegment.splice(lastSegment.length - toRemove - 1, toRemove);
    }

    if (lastSegment.length <= 2 || lastSegment.length >= 100) return;

    let learnableMask: number[][] | undefined;
    if (mask) {
      // 实时绘制时只有段尾在延伸, 用 mask 固定对段尾几乎无影响的控制点与两个端点, 减少抖动
      learnableMask = [new Array(lastSegment.length).fill(0), new Array(lastSegment.length).fill(0)];
      // 仅末尾 2*degree 个控制点可学习 (实测范围外的点优化时几乎不动)
      for (let j = Math.max(1, lastSegment.length - this.degree * 2); j < lastSegment.length - 1; j++) {
        learnableMask[0][j] = 1;
        learnableMask[1][j] = 1;
      }
    }

    const res = Math.trunc(totalWinding * 10);
    segments[segments.length - 1] = piecewiseLinearToBSpline(segmentPath, lastSegment.length, this.degree,
      res, iterations, 4, 0.8, 0.99, lastSegment, learnableMask);
  }

  private regenerateLastApproximatedSegment(): void {
    if (!this.controlPointsValid) {
      this.regenerateFullApproximatedPath();
      return;
    }

    const { vertices, distances } = this.computeSmoothedInputPath();
    if (vertices.length < 2) {
      this.controlPoints = [vertices];
      this.controlPointsValid = true;
      return;
    }

    const cornerTs = this.detectCorners(vertices, distances);
    const segments = this.controlPoints;

    // 极少数情况下拐角比上一帧少, 裁掉多余段
    if (segments.length >= cornerTs.length) {
      const toRemove = segments.length + 1 - cornerTs.length;
      segments.splice(segments.length - toRemove, toRemove);
    }

    // 补足段数 (新增拐角可能截短前一段, 需去掉多余控制点并重新优化)
    while (segments.length < cornerTs.length - 1) {
      this.updateLastSegment(vertices, distances, cornerTs, segments, 100, false);
      segments.push([]);
    }

    if (this.finishedDrawing)
      this.updateLastSegment(vertices, distances, cornerTs, segments, 100, false);
    else
      this.updateLastSegment(vertices, distances, cornerTs, segments, 10, true);

    this.shouldOptimiseLastSegment = false;
  }

  private regenerateFullApproximatedPath(): void {
    const { vertices, distances } = this.computeSmoothedInputPath();
    if (vertices.length < 2) {
      this.controlPoints = [vertices];
      this.controlPointsValid = true;
      return;
    }

    this.controlPoints = [];
    const cornerTs = this.detectCorners(vertices, distances);
    const segments = this.controlPoints;

    for (let i = 1; i < cornerTs.length; ++i) {
      let { cps, segmentPath, totalWinding } = this.initializeSegment(vertices, distances, cornerTs[i - 1], cornerTs[i]);

      if (cps.length > 2 && cps.length < 100) {
        const res = Math.trunc(totalWinding * 10);
        cps = piecewiseLinearToBSpline(segmentPath, cps.length, this.degree,
          res, 200, 5, 0.8, 0.99, cps, undefined);
      }

      segments.push(cps);
    }

    this.controlPointsValid = true;
    this.shouldOptimiseLastSegment = false;
  }

  private redrawApproximatedPath(): void {
    this.outputPath = [];
    for (const segment of this.getControlPoints())
      this.outputPath.push(...bSplineToPiecewiseLinear(segment, this.degree));
    this.outputCacheValid = true;
  }
}
