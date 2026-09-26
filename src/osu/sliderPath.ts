// 滑条路径计算: 直线(L) / 三点圆弧(P) / 贝塞尔(B) / 卡特姆(C) / B样条(B4, lazer 扩展)
import { sliderVelocityAt, timingAt, snapAcrossRedLine, type Beatmap, type HitObject, type TimingPoint, type Vec2 } from './parser';
import { bSplineToPiecewiseLinear } from './freehand/pathApproximator';
import { convertCircleToBezierAnchors } from './freehand/freehandFit';

export class SliderPath {
  points: Vec2[] = []; // 等距采样点
  cumulative: number[] = []; // 每个采样点的累计长度
  totalLength = 0;

  constructor(curveType: string, controlPoints: Vec2[], expectedLength: number) {
    const raw = SliderPath.computeRawPath(curveType, controlPoints);
    this.buildEvenSpacing(raw, expectedLength);
  }

  static computeRawPath(curveType: string, pts: Vec2[]): Vec2[] {
    if (pts.length < 2) return pts.slice();
    switch (curveType) {
      case 'L': return linearPath(pts);
      case 'P': return perfectArcPath(pts);
      case 'C': return catmullPath(pts);
      case 'B4': return bsplinePath(pts); // lazer 扩展: degree-4 B 样条
      default: return bezierPath(pts); // B
    }
  }

  private buildEvenSpacing(raw: Vec2[], expectedLength: number) {
    // 先按弧长细分, 再重采样为等间距
    const fine: Vec2[] = [];
    const SEG = 1; // 每段细分为1px左右
    for (let i = 0; i < raw.length - 1; i++) {
      const a = raw[i], b = raw[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(d / SEG));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        fine.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    fine.push(raw[raw.length - 1]);
    // 重采样: acc 累积全部细分长度 (总长不丢), 点距上次保留点 >0.5px 才保留 (去抖)
    // v39 修复: 原实现按相邻细分点 d>0.5 才 acc += d — 密集采样路径 (如高密度 B->C 的 catmull, 细分 ~0.6px/步)
    // 大量步长 <=0.5 被整条跳过, 总长丢失 (276px 路径只剩 238px) 且曲线上留下长弦; 改为 since 累计判定
    this.points = []; this.cumulative = [0];
    if (fine.length === 0) return;
    this.points.push(fine[0]);
    let acc = 0, since = 0;
    for (let i = 1; i < fine.length; i++) {
      const d = Math.hypot(fine[i].x - fine[i - 1].x, fine[i].y - fine[i - 1].y);
      // v283: pixelLength 截断精确落点 (lazer SliderPath.calculateLength: 截短后把末顶点沿末段方向
      //   精确移到 expectedDistance 处) — 跨界时按 (expected-prev)/d 插值出精确切点加入再停;
      //   原实现 acc >= expected 直接 break, 0.5px 去抖还可能吞掉跨界点, 尾点落后 expected 且
      //   totalLength 与 cumulative 表互相矛盾 (positionAt(totalLength) 与 lazer 尾点不一致)
      if (acc + d >= expectedLength) {
        const t = d > 1e-9 ? (expectedLength - acc) / d : 0;
        this.points.push({ x: fine[i - 1].x + (fine[i].x - fine[i - 1].x) * t, y: fine[i - 1].y + (fine[i].y - fine[i - 1].y) * t });
        this.cumulative.push(expectedLength);
        acc = expectedLength;
        break;
      }
      acc += d; since += d;
      if (since > 0.5) { this.points.push(fine[i]); this.cumulative.push(acc); since = 0; }
    }
    // v148: expectedLength > 几何全长时沿末端切线线性延长 (lazer SliderPath.calculateLength:
    // calculatedPath[^1] = calculatedPath[^2] + dir * (expectedDistance - calculatedLength);
    // 例外: 路径末两点重合则不延长 (stable 同款 — lazer 注释: In osu-stable, if the last two
    // path points of a slider are equal, extension is not performed)。原实现只截短不延长,
    // 导致同一 .osu 滑条在 stable 中尾部超出末节点 (pixelLength > 几何长度), 本编辑器却恰好收在末节点。
    // 末点重合判定在 raw 上做: 重采样去重 (since>0.5) 会抹掉重合端点
    const rawEndDup = raw.length >= 2 && raw[raw.length - 1].x === raw[raw.length - 2].x && raw[raw.length - 1].y === raw[raw.length - 2].y;
    if (!rawEndDup && acc < expectedLength && this.points.length >= 2) {
      const p1 = this.points[this.points.length - 1], p0 = this.points[this.points.length - 2];
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const dl = Math.hypot(dx, dy);
      if (dl > 1e-6) {
        this.points.push({ x: p1.x + dx / dl * (expectedLength - acc), y: p1.y + dy / dl * (expectedLength - acc) });
        this.cumulative.push(expectedLength);
        acc = expectedLength;
      }
    }
    this.totalLength = Math.min(acc, expectedLength);
  }

  positionAt(length: number): Vec2 {
    if (this.points.length === 0) return { x: 0, y: 0 };
    if (length <= 0) return this.points[0];
    if (length >= this.totalLength) return this.points[this.points.length - 1];
    // 二分查找
    let lo = 0, hi = this.cumulative.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid] <= length) lo = mid; else hi = mid;
    }
    const l0 = this.cumulative[lo], l1 = this.cumulative[hi];
    const t = l1 > l0 ? (length - l0) / (l1 - l0) : 0;
    return {
      x: this.points[lo].x + (this.points[hi].x - this.points[lo].x) * t,
      y: this.points[lo].y + (this.points[hi].y - this.points[lo].y) * t,
    };
  }
}

function subdivide(a: Vec2, b: Vec2, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function linearPath(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    out.push(...subdivide(pts[i], pts[i + 1], Math.max(1, Math.ceil(d / 4))));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function perfectArcPath(pts: Vec2[]): Vec2[] {
  // v283: lazer SliderPath.calculateSubPath PERFECT_CURVE 对齐 (原实现把多段三点弧拼接 / 退化回退折线):
  //   点数 != 3 不由本函数承担 — 解析层 (parser.ts v283) 已把 P≠3 整条转 'B'、3 点共线转 'L'
  //   (lazer ConvertHitObjectParser.convertPoints); 此处兜底同样转贝塞尔
  //   (lazer: subControlPoints.Length != 3 → break → BSplineToPiecewiseLinear, 即贝塞尔)
  if (pts.length !== 3) return bezierPath(pts);
  const [a, b, c] = pts;
  const arc = circumArc(a, b, c);
  // v283: 退化 (近共线, lazer CircularArcProperties.IsValid = false) 回退贝塞尔过 a,b,c (原回退折线)
  if (!arc) return bezierPath(pts);
  const { cx, cy, r, thetaStart, thetaRange, dir } = arc;
  // v283: 采样数按径向误差 <=0.1px (lazer CircularArcToPiecewiseLinear):
  //   amountPoints = ceil(θ / (2·acos(1−0.1/r))); 2r <= 0.1 的病态小弧取 2;
  //   subPoints >= 1000 回退贝塞尔 (lazer SliderPath.calculateSubPath: 需 ~12 万 px 弧长才触发)
  const subPoints = 2 * r <= 0.1 ? 2 : Math.max(2, Math.ceil(thetaRange / (2 * Math.acos(1 - 0.1 / r))));
  if (subPoints >= 1000) return bezierPath(pts);
  const out: Vec2[] = [];
  for (let i = 0; i < subPoints; i++) {
    const theta = thetaStart + dir * (i / (subPoints - 1)) * thetaRange;
    out.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
  }
  return out;
}

// v283: lazer CircularArcProperties 移植 — 退化判定统一到 double AlmostEquals(0, cross) (容差 1e-7,
//   原 |d|<1e-6); 方向用 b 相对 AC 的侧向 (ortho 点积), 与 lazer 完全一致
function circumArc(a: Vec2, b: Vec2, c: Vec2): { cx: number; cy: number; r: number; thetaStart: number; thetaRange: number; dir: number } | null {
  const cross = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
  if (Math.abs(cross) <= 1e-7) return null;
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const thetaStart = Math.atan2(a.y - cy, a.x - cx);
  let thetaEnd = Math.atan2(c.y - cy, c.x - cx);
  while (thetaEnd < thetaStart) thetaEnd += 2 * Math.PI;
  let dir = 1, thetaRange = thetaEnd - thetaStart;
  // 方向: b 在 A->C 哪一侧 (lazer: orthoAtoC = (ac.y, -ac.x), dot(ortho, b-a) < 0 → 反向)
  const acx = c.x - a.x, acy = c.y - a.y;
  if (acy * (b.x - a.x) - acx * (b.y - a.y) < 0) { dir = -1; thetaRange = 2 * Math.PI - thetaRange; }
  return { cx, cy, r, thetaStart, thetaRange, dir };
}

function bezierPath(pts: Vec2[]): Vec2[] {
  // 红点(重复点)分段, 每段 flattenBezier (v99: 原实现每采样点 O(k²) de Casteljau 密集求值,
  // 1000 控制点单段 = 12000 采样 × ~500k 次内循环 ≈ 6e9, 卡数十秒)
  const out: Vec2[] = [];
  let segment: Vec2[] = [];
  const flush = () => {
    if (segment.length >= 2) flattenBezier(segment, out);
    segment = [];
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    // v283: lazer convertPoints — 最后一个控制点不允许开启新的隐式段:
    //   末尾重复对保留在同一贝塞尔段内 (更高阶); 原实现 flush 前段并丢弃最后的单点段 (贝塞尔降一阶)
    if (i < pts.length - 1 && segment.length > 0 && p.x === segment[segment.length - 1].x && p.y === segment[segment.length - 1].y) {
      // 红点: 结束当前段
      flush();
    }
    segment.push(p);
  }
  flush();
  if (out.length === 0) return linearPath(pts);
  return out;
}

// v283: lazer PathApproximator.BSplineToPiecewiseLinear (degree = n-1, 即 BezierToPiecewiseLinear) 移植,
//   全阶数统一: 迭代栈 + de Casteljau 中点剖分 (无递归, 大输入不会栈溢出), 平坦度 = 二阶差容差
//   (lazer bezierIsFlatEnough, BEZIER_TOLERANCE = 0.25), 平坦段 lazer bezierApproximate 输出
//   (与控制点同数量级的近似点)。扁平 number 数组零内层分配 — 1000 控制点锯齿/正弦实测 ~3-10ms
//   (v99 性能语义保持: 原每采样点 O(k²) de Casteljau 卡数十秒)。
//   原双轨 (<=24 弦高剖分 / >24 十二倍等参采样 + 截断 Bernstein) 移除: 大段等参采样在参数速度
//   剧烈变化时曲率大区会留 >0.5px 的弦, 与 lazer 递归剖分结果不符。
const BEZIER_FLAT_TOL_SQ = 0.25 * 0.25 * 4; // lazer: |p[i-1] - 2·p[i] + p[i+1]|² > 0.25²·4 → 不平坦

// lazer bezierIsFlatEnough: 控制多边形二阶差 (曲率近似) 全部在容差内即足够平坦
function bezierFlatEnough(xs: number[], ys: number[], n: number): boolean {
  for (let i = 1; i < n - 1; i++) {
    const dx = xs[i - 1] - 2 * xs[i] + xs[i + 1];
    const dy = ys[i - 1] - 2 * ys[i] + ys[i + 1];
    if (dx * dx + dy * dy > BEZIER_FLAT_TOL_SQ) return false;
  }
  return true;
}

// lazer bezierSubdivide: de Casteljau 中点剖分为左右两段同阶控制点 (mxs/mys 为工作缓冲)
function bezierSubdivideBuf(xs: number[], ys: number[], lxs: number[], lys: number[],
  rxs: number[], rys: number[], mxs: number[], mys: number[], n: number): void {
  for (let i = 0; i < n; i++) { mxs[i] = xs[i]; mys[i] = ys[i]; }
  for (let i = 0; i < n; i++) {
    lxs[i] = mxs[0]; lys[i] = mys[0];
    rxs[n - i - 1] = mxs[n - i - 1]; rys[n - i - 1] = mys[n - i - 1];
    for (let j = 0; j < n - i - 1; j++) {
      mxs[j] = (mxs[j] + mxs[j + 1]) / 2;
      mys[j] = (mys[j] + mys[j + 1]) / 2;
    }
  }
}

// lazer bezierApproximate: 平坦段用 de Casteljau 扩展输出 n-1 个近似点 (含首点; 全曲线末点由 flattenBezier 最后统一补)
function bezierApproximateBuf(xs: number[], ys: number[], n: number, out: Vec2[]): void {
  const lxs = new Array<number>(2 * n - 1), lys = new Array<number>(2 * n - 1);
  const rxs = new Array<number>(n), rys = new Array<number>(n), mxs = new Array<number>(n), mys = new Array<number>(n);
  bezierSubdivideBuf(xs, ys, lxs, lys, rxs, rys, mxs, mys, n);
  for (let i = 0; i < n - 1; i++) { lxs[n + i] = rxs[i + 1]; lys[n + i] = rys[i + 1]; }
  out.push({ x: xs[0], y: ys[0] });
  for (let i = 1; i < n - 1; i++) {
    const k = 2 * i;
    out.push({ x: 0.25 * (lxs[k - 1] + 2 * lxs[k] + lxs[k + 1]), y: 0.25 * (lys[k - 1] + 2 * lys[k] + lys[k + 1]) });
  }
}

export function flattenBezier(pts: Vec2[], out: Vec2[]): void {
  if (pts.length < 2) { for (const p of pts) out.push({ x: p.x, y: p.y }); return; }
  // 迭代栈模拟递归 (lazer 同款 DFS, 先左后右); 相邻段共享剖分顶点, 天然无重复接缝点
  const stack: { xs: number[]; ys: number[] }[] = [{ xs: pts.map(p => p.x), ys: pts.map(p => p.y) }];
  while (stack.length > 0) {
    const seg = stack.pop()!;
    const n = seg.xs.length;
    if (bezierFlatEnough(seg.xs, seg.ys, n)) { bezierApproximateBuf(seg.xs, seg.ys, n, out); continue; }
    const lxs = new Array<number>(n), lys = new Array<number>(n), rxs = new Array<number>(n), rys = new Array<number>(n),
      mxs = new Array<number>(n), mys = new Array<number>(n);
    bezierSubdivideBuf(seg.xs, seg.ys, lxs, lys, rxs, rys, mxs, mys, n);
    stack.push({ xs: rxs, ys: rys }, { xs: lxs, ys: lys });
  }
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }); // 全曲线精确末点
}

// v74: lazer B4| (degree-4 clamped 均匀 B 样条, 红点(重复点)分段; 手绘滑条落盘格式, 控制点少)
function bsplinePath(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  let segment: Vec2[] = [];
  const flush = () => {
    if (segment.length >= 2) {
      const pl = bSplineToPiecewiseLinear(segment, 4);
      for (let i = 0; i < pl.length; i++) {
        if (out.length > 0 && i === 0) continue; // 段间共享端点去重
        out.push(pl[i]);
      }
    }
    segment = [];
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (segment.length > 0 && p.x === segment[segment.length - 1].x && p.y === segment[segment.length - 1].y) flush();
    segment.push(p);
  }
  flush();
  if (out.length === 0) return linearPath(pts);
  return out;
}

function catmullPath(pts: Vec2[]): Vec2[] {
  // lazer PathApproximator.CatmullToPiecewiseLinear / BezierConverter.ConvertCatmullToBezierAnchors(:259) 同款端点约定:
  //   首端 clamp (v1 = v2), 末端外推 (v4 = 2*v3 - v2) — 与 C→B 转换 (bezierPath.ts catmullToBezier) 是同一曲线,
  //   保证 catmull->bezier 转换后渲染形状精确不变 (v39 修复: 原实现末端也 clamp, 末段与 lazer 有 ~0.074*末段长 的偏差)
  // 红锚点 (重复点): lazer 传统格式解码时 catmull 不按重复点分段 (ConvertHitObjectParser.cs:403
  //   "Legacy CATMULL sliders don't support multiple segments"), 整条作为一个样条链 (重复点为双重结点), 此处行为一致
  const out: Vec2[] = [];
  const n0 = pts.length;
  const get = (i: number): Vec2 => {
    if (i < 0) return pts[0]; // 首端 clamp
    if (i >= n0) { // 末端外推: v4 = 2*v3 - v2
      const a = pts[n0 - 2], b = pts[n0 - 1];
      return { x: 2 * b.x - a.x, y: 2 * b.y - a.y };
    }
    return pts[i];
  };
  for (let i = 0; i < n0 - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const n = 50; // v283: lazer PathApproximator.catmull_detail = 50 (原 15, 采样密度不足)
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------- 已放置滑条的路径缓存 (供渲染/stacking 共用; 几何变化需 invalidateSliderPath) ----------
const pathCache = new Map<number, SliderPath>();

export function getSliderPath(_bm: Beatmap, o: HitObject): SliderPath {
  void _bm;
  let p = pathCache.get(o.id);
  if (!p) {
    const pts = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
    const curveType = o.curveType ?? 'L';
    // v283: length 缺失 (lazer ExpectedDistance = null) 用几何全长, 不再 ?? 100 截到 100px
    //   (解析层 parser.ts v283 加载时已填几何全长, 此处兜底程序化构造的无 length 对象)
    p = new SliderPath(curveType, pts, o.length ?? sliderGeometryLength(curveType, pts));
    pathCache.set(o.id, p);
  }
  return p;
}

export function invalidateSliderPath(id?: number) {
  if (id === undefined) pathCache.clear();
  else pathCache.delete(id);
}

// ---------- 已建滑条的节点编辑 (纯函数; 点列含头部 pts[0], 红锚点 = 连续相同坐标对) ----------
// 数据规则 (.osu 惯例): 红锚点在文件里是"连续两个相同坐标的点"; 渲染时该对的第二个点画红色手柄

const samePt = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

/** pts[i] 是否属于红锚点重复对 (与相邻点同坐标) */
export function isRedPairPoint(pts: Vec2[], i: number): boolean {
  return (i > 0 && samePt(pts[i], pts[i - 1])) || (i < pts.length - 1 && samePt(pts[i], pts[i + 1]));
}

/** 红锚点重复对的配对下标: i 属于某个重复对时返回对中另一个点的下标, 否则 null (拖拽红点时成对移动用) */
export function redPairPartner(pts: Vec2[], i: number): number | null {
  if (i > 0 && samePt(pts[i], pts[i - 1])) return i - 1;
  if (i < pts.length - 1 && samePt(pts[i], pts[i + 1])) return i + 1;
  return null;
}

/** 点列中是否存在红锚点重复对 */
export function hasRedPair(pts: Vec2[]): boolean {
  for (let i = 1; i < pts.length; i++) if (samePt(pts[i], pts[i - 1])) return true;
  return false;
}

/** 点 p 到线段 a->b 的最近点: 返回投影参数 t (钳制 [0,1])、最近点坐标与距离 */
export function nearestOnSegment(a: Vec2, b: Vec2, p: Vec2): { t: number; x: number; y: number; dist: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const x = a.x + dx * t, y = a.y + dy * t;
  return { t, x, y, dist: Math.hypot(p.x - x, p.y - y) };
}

/** 插入节点: 在线段 pts[segIndex] -> pts[segIndex+1] 的参数 t 处插入 (坐标取整), 返回新点列 */
export function insertSliderPoint(pts: Vec2[], segIndex: number, t: number): Vec2[] {
  const a = pts[segIndex], b = pts[segIndex + 1];
  const tc = Math.max(0, Math.min(1, t));
  const np = { x: Math.round(a.x + (b.x - a.x) * tc), y: Math.round(a.y + (b.y - a.y) * tc) };
  return [...pts.slice(0, segIndex + 1), np, ...pts.slice(segIndex + 1)];
}

/**
 * 删除节点: 头部 (index 0) 不可删; 删到少于 2 个点不可删;
 * 红点 (重复对) 删除时成对删除 (无论命中对中哪一个), 返回新点列, 不可删返回 null
 */
export function deleteSliderPoint(pts: Vec2[], index: number): Vec2[] | null {
  if (index <= 0 || index >= pts.length) return null;
  let from = index, count = 1;
  if (index > 0 && samePt(pts[index], pts[index - 1])) { from = index - 1; count = 2; }
  else if (index < pts.length - 1 && samePt(pts[index], pts[index + 1])) { from = index; count = 2; }
  if (pts.length - count < 2) return null;
  return [...pts.slice(0, from), ...pts.slice(from + count)];
}

/**
 * 切换白/红: 头部不可切换; 白->红 在该点后复制一个相同坐标点 (形成重复对);
 * 红->白 把重复对合并成一个点 (命中对中任意一个均可), 返回新点列, 不可切换返回 null
 */
export function toggleSliderPointRed(pts: Vec2[], index: number): Vec2[] | null {
  if (index <= 0 || index >= pts.length) return null;
  if (index > 0 && samePt(pts[index], pts[index - 1])) {
    // 命中对中第二个: 去掉自己即合并
    return [...pts.slice(0, index), ...pts.slice(index + 1)];
  }
  if (index < pts.length - 1 && samePt(pts[index], pts[index + 1])) {
    // 命中对中第一个: 去掉后一个
    return [...pts.slice(0, index + 1), ...pts.slice(index + 2)];
  }
  const dup = { x: pts[index].x, y: pts[index].y };
  return [...pts.slice(0, index + 1), dup, ...pts.slice(index + 1)];
}

/**
 * 节点增删后的 curveType 解析: 红点存在 -> 'B' (v15 放置规则同款);
 * 'B4' 有红点对仍合法 (B 样条分段), 保持 'B4' (v74);
 * 原类型仍合法则保持 ('P' 恰好 3 点合法, 'L'/'B'/'C' 任意 >=2 点合法), 否则按 inferSegmentType 降级
 */
export function resolveSliderCurveType(pts: Vec2[], current: string): string {
  if (current === 'B4') return 'B4';
  if (hasRedPair(pts)) return 'B';
  if (current === 'P' && pts.length !== 3) return inferSegmentType(pts.length);
  return current;
}

// ---------- 放置中的滑条 (lazer SliderPlacementBlueprint 对齐) ----------
export interface PendingPoint extends Vec2 { redAnchor?: boolean; bspline?: boolean }

export interface PendingPathResult {
  /** 逐段推断类型后拼接的原始路径点 (供预览绘制) */
  raw: Vec2[];
  /** 几何全长 (px) */
  length: number;
  /** 导出用单字母类型 (stable 规则: 无红点 2点L/3点P/4+B, 有红点 B) */
  curveType: string;
  /** 含红点加倍的控制点 (pend, 不含 cursor) */
  controlPoints: Vec2[];
}

/** 单段类型推断: lazer updatePathType — 段内 1~2 点 L, 3 点 P, 4+ B */
export function inferSegmentType(len: number): string {
  return len <= 2 ? 'L' : len === 3 ? 'P' : 'B';
}

/**
 * v76: 放置预览的幻影尾点 (当前光标处的滑条尾控制点): cursor 距末点 >2 才计入
 * (computePendingPath 的路径幻影点与渲染的手柄/连线共用同一判定, 保证所见一致)
 */
export function pendingPhantomPoint(pend: Vec2[], cursor: Vec2 | null): Vec2 | null {
  if (!cursor) return null;
  if (pend.length === 0) return { x: cursor.x, y: cursor.y };
  const last = pend[pend.length - 1];
  return Math.hypot(cursor.x - last.x, cursor.y - last.y) > 2 ? { x: cursor.x, y: cursor.y } : null;
}

/**
 * 计算放置中滑条的路径: 按红点分段, 每段独立推断类型计算后拼接 (预览所见即最终形状)
 */
export function computePendingPath(pend: PendingPoint[], cursor: Vec2 | null): PendingPathResult {
  // 点列 = pend + (远离末点的 cursor 幻影点)
  const pts: PendingPoint[] = [...pend];
  const phantom = pendingPhantomPoint(pend, cursor);
  if (phantom) pts.push(phantom);
  // 按红点分段 (红点为段间共享点)
  const segments: Vec2[][] = [];
  let seg: Vec2[] = [];
  for (const p of pts) {
    seg.push({ x: p.x, y: p.y });
    if (p.redAnchor && seg.length > 1) { segments.push(seg); seg = [{ x: p.x, y: p.y }]; }
  }
  if (seg.length > 1 || segments.length === 0) segments.push(seg);

  const raw: Vec2[] = [];
  let length = 0;
  const bspline = pend.some(p => p.bspline); // v74: 手绘预览 => 段按 B 样条 ('B4') 渲染 (与落盘一致)
  for (const s of segments) {
    if (s.length < 2) continue;
    const segRaw = SliderPath.computeRawPath(bspline ? 'B4' : inferSegmentType(s.length), s);
    for (let i = 0; i < segRaw.length; i++) {
      if (raw.length > 0 && i === 0) continue;
      if (raw.length > 0) length += Math.hypot(segRaw[i].x - raw[raw.length - 1].x, segRaw[i].y - raw[raw.length - 1].y);
      raw.push(segRaw[i]);
    }
  }

  const hasRed = pend.some(p => p.redAnchor);
  const controlPoints: Vec2[] = [];
  for (let i = 0; i < pend.length; i++) {
    controlPoints.push({ x: pend[i].x, y: pend[i].y });
    if (pend[i].redAnchor && i < pend.length - 1) controlPoints.push({ x: pend[i].x, y: pend[i].y });
  }
  const curveType = hasRed ? 'B' : inferSegmentType(Math.max(2, pend.length));
  return { raw, length, curveType, controlPoints };
}

/**
 * v75: 落盘前把 'B' 控制点列中恰为 3 点的段转换为圆预设贝塞尔锚点
 * (lazer BezierConverter.ConvertCircleToBezierAnchors; lazer 导出 stable 时对 PERFECT_CURVE 段同款处理)。
 * 放置预览按段推断类型, 3 点段以 'P' 圆弧渲染; 落盘 'B' 若原样保留 3 点段会被 de Casteljau 当二次贝塞尔,
 * 形状塌掉 — 转换后渲染形状与预览一致 (WYSIWYG)。
 * 非 'B' 原样返回; 共线 3 点段 convertCircleToBezierAnchors 原样返回 (退化为直线, 形状亦不变);
 * 2 点/4+ 点段不动; 段间红锚点重复对保留; 输出坐标取整 (.osu 惯例)。
 */
export function preserveArcsForBezier(curveType: string, controlPoints: Vec2[]): Vec2[] {
  if (curveType !== 'B') return controlPoints;
  // 按红锚点 (连续重复点) 分段, 段间共享点 (与 bezierPath 同款切法)
  const segments: Vec2[][] = [];
  let seg: Vec2[] = [];
  for (const p of controlPoints) {
    if (seg.length > 0 && p.x === seg[seg.length - 1].x && p.y === seg[seg.length - 1].y) {
      segments.push(seg);
      seg = [];
    }
    seg.push({ x: p.x, y: p.y });
  }
  segments.push(seg);
  const out: Vec2[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i].length === 3 ? convertCircleToBezierAnchors(segments[i]) as Vec2[] : segments[i];
    // 相邻段共享边界点, 直接拼接即自动形成红锚点重复对 (段尾 + 段首同一坐标)
    for (const p of s) out.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  return out;
}

// ---------- 长度节拍吸附 (lazer SliderPathExtensions.SnapTo + FindSnappedDistance 对齐) ----------

/** v218: 节拍细分配置项 (节拍吸附下拉框可选值; App.tsx 下拉框与本模块共用同一常量, 即「配置中有的节拍细分」) */
export const BEAT_SNAP_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 16];

/**
 * v218: 滑条长度吸附细分 = 当前节拍细分的 1/2 (分母 ×2, 如 1/4 -> 1/8);
 * 仅当 ×2 后的细分存在于配置项 (BEAT_SNAP_OPTIONS) 中, 否则退回当前细分 (如 1/12 -> 1/12, 1/16 -> 1/16)。
 * 仅作用于长度吸附; 放置时刻 (snapPlacementTime) 与控制点位置仍按原规则, 不参与此对齐。
 */
export function sliderLengthSnapDivisor(beatSnap: number): number {
  const half = beatSnap * 2;
  return BEAT_SNAP_OPTIONS.includes(half) ? half : beatSnap;
}

/** v83: 放置时间吸附 — 当前时间按 beatSnap 就近 tick (finishSlider/finishFreehand/时间轴预览共用) */
export function snapPlacementTime(points: TimingPoint[], currentTime: number, beatSnap: number): number {
  const { red } = timingAt(points, currentTime);
  const div = red.beatLength / beatSnap;
  const snapped = red.time + Math.round((currentTime - red.time) / div) * div;
  return snapAcrossRedLine(points, currentTime, snapped); // v285: lazer 跨红线就近规则
}

/** v180: 转盘放置终点 — lazer SpinnerPlacementBlueprint.updateEndTimeFromCurrent:
 *  EndTime = max(StartTime + 起点处一拍, 当前时间按 beatSnap 吸附); 即放置中终点实时跟随编辑器时间, 至少一拍长 */
export function spinnerPlacementEnd(points: TimingPoint[], startTime: number, currentTime: number, beatSnap: number): number {
  const { red } = timingAt(points, startTime);
  return Math.max(startTime + red.beatLength, snapPlacementTime(points, currentTime, beatSnap));
}

/**
 * v83: 放置长度规则 — 几何全长 -> 锁定间距吸整拍 / v95: 非锁定走 snapSliderLength 节拍吸附 (lazer updateSlider 的
 * FindSnappedDistance: 尾端落在节拍 tick 上且不超几何全长; v218 起 tick 细分 = 当前细分的 1/2) -> 下限 20px
 * (finishSlider/finishFreehand/时间轴预览共用)
 * v160: 长度永不超几何全长 (末控制点位置) — lazer SliderPlacementBlueprint.updateSlider:
 *   ExpectedDistance = FindSnappedDistance(Path.CalculatedDistance), 吸附源即几何全长,
 *   超出 1ms 行程退一格 (ComposerDistanceSnapProvider.cs:298); 最后硬钳到几何全长。
 *   锁定间距分支原 Math.round 直接向上入 (可超几何近半拍, 触发 v148 末端切线延长), 现同样退一格+钳制。
 * v219 例外: 几何不足 1 个长度细分 tick 时对齐到 1 tick (允许超几何全长, 否则永远无法对齐)。
 */
export function placementLength(
  points: TimingPoint[], currentTime: number, sliderMultiplier: number,
  geometryLength: number, distanceLock: boolean, distanceSpacing: number, beatSnap: number,
): number {
  const { red } = timingAt(points, currentTime);
  const vel = sliderVelocityAt(points, currentTime, sliderMultiplier);
  const beatPx = vel * red.beatLength;
  const geoCap = Math.max(1, Math.floor(geometryLength)); // v160: floor — round 会四舍五入回超几何全长
  if (distanceLock && distanceSpacing > 0 && beatPx > 0) {
    // 整拍一定落在 tick 网格上 (1 拍 = beatSnap 个 tick), 无需再走 snapSliderLength
    let beats = Math.round(geometryLength / beatPx);
    if (beats * beatPx > geometryLength + vel * 1) beats -= 1; // lazer: 超出 1ms 行程退一拍
    beats = Math.max(1, beats);
    return Math.min(Math.max(20, Math.round(beats * beatPx)), geoCap);
  }
  const snapped = snapSliderLength(points, currentTime, sliderMultiplier, geometryLength, beatSnap);
  // v219: 亚 tick (几何不足 1 个长度细分 tick) — snapped 已对齐 1 tick, 不再受 20px 下限/geoCap 钳制 (否则预览/落盘长度退化为不对齐的 floor(几何))
  const tickPx = vel * red.beatLength / sliderLengthSnapDivisor(beatSnap);
  if (tickPx > geometryLength + vel * 1) return snapped;
  return Math.min(Math.max(20, snapped), geoCap);
}

/**
 * v82: 放置中滑条的时间轴预览区间 (与 EditorCanvas finishSlider 落盘同规则; v83 起共用上面两个纯函数)
 * - 时间 = snapPlacementTime; 长度 = computePendingPath 几何全长 (含幻影光标点) 过 placementLength
 * - end = time + len / vel (slides 恒 1)
 */
export function pendingSliderTimeline(
  points: TimingPoint[], sliderMultiplier: number,
  pend: PendingPoint[], cursor: Vec2 | null, currentTime: number, beatSnap: number,
  distanceLock: boolean, distanceSpacing: number,
): { time: number; end: number } {
  const time = snapPlacementTime(points, currentTime, beatSnap);
  const vel = sliderVelocityAt(points, currentTime, sliderMultiplier);
  const len = placementLength(points, currentTime, sliderMultiplier,
    computePendingPath(pend, cursor).length, distanceLock, distanceSpacing, beatSnap);
  return { time, end: time + len / vel };
}

/** 滑条路径几何全长 (px, 不做 expectedLength 截断; 与渲染路径同一 computeRawPath 算法) */
export function sliderGeometryLength(curveType: string, pts: Vec2[]): number {
  const raw = SliderPath.computeRawPath(curveType, pts);
  let len = 0;
  for (let i = 1; i < raw.length; i++) len += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
  return len;
}

/**
 * v219: 折线路径按弧长截断 (末段线性插值出切点) — 放置预览滑条身只画到节拍吸附后的预期长度
 * (lazer SliderPlacementBlueprint: 滑条身 = ExpectedDistance 截断); length ≥ 全长时返回原路径
 */
export function truncatePathAtLength(raw: Vec2[], length: number): Vec2[] {
  if (raw.length < 2) return raw.slice();
  const out: Vec2[] = [{ x: raw[0].x, y: raw[0].y }];
  let acc = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + d >= length) {
      const t = d > 1e-6 ? (length - acc) / d : 0;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return out;
    }
    acc += d;
    out.push({ x: b.x, y: b.y });
  }
  return out;
}

/**
 * lazer FindSnappedDistance: 把几何全长吸附到节拍分割 tick
 * - v218: 吸附细分 = 当前节拍细分的 1/2 (sliderLengthSnapDivisor, 如 1/4 -> 1/8; 配置中无 ×2 细分则退回当前细分)
 * - tick 长 = vel * beatLength / div px (= lazer GetBeatSnapDistance = 100*sv*sliderMultiplier/divisor)
 * - tick 数就近取整 (SnapTime round-to-nearest), 但绝不超过几何全长: 超出 1ms 容差则退一个 tick
 *   (lazer: snappedTime > actualDuration + 1ms -> snappedTime -= beatLength/divisor)
 * - 下限 1 个 tick (lazer 用 HasValidLengthForPlacement 回滚整次拖拽, 这里取钳制从简)
 * - v160: 最终硬钳到几何全长 (末控制点位置) — 1ms 容差内仍可能微超, 用户规则要求始终 ≤
 */
export function snapSliderLength(points: TimingPoint[], time: number, sliderMultiplier: number, geometryLength: number, beatSnap: number): number {
  const { red } = timingAt(points, time);
  const vel = sliderVelocityAt(points, time, sliderMultiplier); // px/ms
  const div = sliderLengthSnapDivisor(beatSnap); // v218: 长度按当前细分的 1/2 对齐
  if (vel <= 0 || red.beatLength <= 0 || div < 1) return Math.max(1, Math.round(geometryLength));
  const tickPx = vel * red.beatLength / div;
  let ticks = Math.round(geometryLength / tickPx);
  if (ticks * tickPx > geometryLength + vel * 1) ticks -= 1; // 1ms 容差换算成 px = vel * 1ms
  ticks = Math.max(1, ticks);
  const snapped = Math.round(ticks * tickPx);
  // v219: 几何不足 1 tick (1 tick 连 1ms 容差都放不下) — 仍对齐到 1 tick, 允许超几何全长;
  // 否则亚细分长度退回 floor(几何) 永远无法对齐 (时间轴上尾端不在 tick 网格)
  if (ticks === 1 && tickPx > geometryLength + vel * 1) return Math.max(1, snapped);
  return Math.max(1, snapped <= geometryLength ? snapped : Math.floor(geometryLength)); // v160: 严格 ≤ 几何全长 (末控制点)
}

/**
 * 节点编辑后重算滑条长度: 几何全长 -> 节拍吸附, 写回 o.length
 * (lazer PathControlPointVisualiser 拖拽/插入/删除控制点后均调用 hitObject.SnapTo)
 */
export function resnapSliderLength(bm: Beatmap, o: HitObject, beatSnap: number): void {
  if (o.type !== 'slider') return;
  const pts = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
  const geo = sliderGeometryLength(o.curveType ?? 'L', pts);
  o.length = snapSliderLength(bm.timingPoints, o.time, bm.difficulty.sliderMultiplier, geo, beatSnap);
}
