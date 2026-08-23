// F2-F4 共享贝塞尔工具: 任意滑条 (L/P/B/C) 统一转成贝塞尔段序列, 支持弧长测量与剖分
// 转换公式对齐 lazer BezierConverter.cs:
//   C -> ConvertCatmullToBezierAnchors (:259) 精确三次贝塞尔公式
//   L -> ConvertLinearToBezierAnchors (:287) 直线段直接转
//   P -> ConvertCircleToBezierAnchors (:195) 圆弧转三次贝塞尔近似 (这里用标准 k=4/3*tan(θ/4) 分块近似, 目标同为最小形状变化)
//   B -> 红锚点 (重复点) 分段, 每段保留原阶贝塞尔 (形状无损)
import type { HitObject, Vec2 } from '../parser';

/** 一条贝塞尔曲线段: 控制点列 (2=线性, 3=二次, 4=三次, 更多=高阶原样保留) */
export type BezierSeg = Vec2[];

/** de Casteljau 求值 (任意阶) */
export function deCasteljau(pts: Vec2[], t: number): Vec2 {
  const work = pts.map(p => ({ x: p.x, y: p.y }));
  for (let k = work.length - 1; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      work[i] = { x: work[i].x + (work[i + 1].x - work[i].x) * t, y: work[i].y + (work[i + 1].y - work[i].y) * t };
    }
  }
  return work[0];
}

/** de Casteljau 剖分: t 处切成 [左半, 右半], 两半共享剖分点 (形状无损) */
export function splitBezier(pts: Vec2[], t: number): [BezierSeg, BezierSeg] {
  const left: Vec2[] = [pts[0]];
  const right: Vec2[] = [pts[pts.length - 1]];
  const work = pts.map(p => ({ x: p.x, y: p.y }));
  for (let k = work.length - 1; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      work[i] = { x: work[i].x + (work[i + 1].x - work[i].x) * t, y: work[i].y + (work[i + 1].y - work[i].y) * t };
    }
    left.push(work[0]);
    right.push(work[k - 1]);
  }
  right.reverse();
  return [left, right];
}

/** 提取子曲线 [t0, t1] (先切 t1 取左, 再在左半上切 t0/t1 取右) */
export function subBezier(pts: Vec2[], t0: number, t1: number): BezierSeg {
  if (t1 <= t0) { const p = deCasteljau(pts, t0); return [p, { ...p }]; }
  const [l] = splitBezier(pts, t1);
  if (t0 <= 0) return l;
  const [, r] = splitBezier(l, t0 / t1);
  return r;
}

/** lazer ConvertCatmullToBezierAnchors: 卡特姆点列 -> 每对相邻点一条三次贝塞尔 (精确) */
export function catmullToBezier(pts: Vec2[]): BezierSeg[] {
  const out: BezierSeg[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const v1 = i > 0 ? pts[i - 1] : pts[i];
    const v2 = pts[i];
    const v3 = i < n - 1 ? pts[i + 1] : { x: 2 * v2.x - v1.x, y: 2 * v2.y - v1.y };
    const v4 = i < n - 2 ? pts[i + 2] : { x: 2 * v3.x - v2.x, y: 2 * v3.y - v2.y };
    out.push([
      { x: v2.x, y: v2.y },
      { x: (-v1.x + 6 * v2.x + v3.x) / 6, y: (-v1.y + 6 * v2.y + v3.y) / 6 },
      { x: (-v4.x + 6 * v3.x + v2.x) / 6, y: (-v4.y + 6 * v3.y + v2.y) / 6 },
      { x: v3.x, y: v3.y },
    ]);
  }
  return out;
}

/**
 * 三点圆弧 -> 三次贝塞尔近似序列 (ConvertCircleToBezierAnchors 同款目标):
 * 圆由三点外接圆确定, 方向取三角形取向 (经过中间点); 共线退化为直线。
 * 弧按 <=90° 分块, 每块一条三次贝塞尔, 控制柄长 k = 4/3*tan(θ/4) (标准圆弧近似, 90° 内误差 <0.03%)
 */
export function circleToBezier(a: Vec2, b: Vec2, c: Vec2): BezierSeg[] {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return [[{ ...a }, { ...c }]]; // 共线 -> 直线
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const dir = cross > 0 ? 1 : -1; // 经过 b 的绕行方向
  const norm = (ang: number, from: number) => {
    let dd = (ang - from) * dir;
    while (dd < 0) dd += Math.PI * 2;
    return dd * dir;
  };
  const start = Math.atan2(a.y - cy, a.x - cx);
  const total = norm(Math.atan2(c.y - cy, c.x - cx), start); // 有符号扫描角 (sign = dir)
  const chunks = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)));
  const step = total / chunks;
  const out: BezierSeg[] = [];
  for (let i = 0; i < chunks; i++) {
    // v41 修复: step 已带符号, 角度推进不再乘 dir (旧实现 dir=-1 时扫描方向反转, 顺时针弧完全变形)
    const a0 = start + step * i, a1 = a0 + step;
    const k = (4 / 3) * Math.tan(step / 4) * r; // 有符号控制柄长 (sign(step)=dir, 配合角度增加方向切向, 两个方向统一)
    const p0 = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
    const p3 = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
    // 角度增加方向的单位切向; k 的符号处理行进方向
    const t0 = { x: -Math.sin(a0), y: Math.cos(a0) };
    const t1 = { x: -Math.sin(a1), y: Math.cos(a1) };
    out.push([
      p0,
      { x: p0.x + k * t0.x, y: p0.y + k * t0.y },
      { x: p3.x - k * t1.x, y: p3.y - k * t1.y },
      p3,
    ]);
  }
  return out;
}

const samePt = (p: Vec2, q: Vec2) => p.x === q.x && p.y === q.y;

/**
 * 滑条 -> 贝塞尔段序列 (统一入口)。
 * 控制点 = 头部 + curvePoints (绝对坐标); 红锚点 (连续重复点对) 为分段边界, 各段独立转换;
 * 段与段之间的接缝即原红锚点/原分段, 转回控制点时以重复点保持分段语义。
 */
export function sliderToBezierSegments(o: HitObject): BezierSeg[] {
  const pts: Vec2[] = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
  if (pts.length < 2) return [];
  // 红锚点分段
  const groups: Vec2[][] = [];
  let cur: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (samePt(pts[i], pts[i - 1])) { if (cur.length > 1) groups.push(cur); cur = [pts[i]]; }
    else cur.push(pts[i]);
  }
  if (cur.length > 1) groups.push(cur);

  const type = o.curveType ?? 'L';
  const out: BezierSeg[] = [];
  for (const g of groups) {
    if (type === 'C') {
      out.push(...catmullToBezier(g));
    } else if (type === 'P') {
      // 与 sliderPath perfectArcPath 同款分组: 每次 3 点步进 2, 剩 2 点退化为直线
      for (let i = 0; i + 1 < g.length; i += 2) {
        if (i + 2 < g.length) out.push(...circleToBezier(g[i], g[i + 1], g[i + 2]));
        else out.push([{ ...g[i] }, { ...g[i + 1] }]);
      }
    } else if (type === 'L') {
      for (let i = 0; i + 1 < g.length; i++) out.push([{ ...g[i] }, { ...g[i + 1] }]);
    } else {
      // B: 整组保留原阶贝塞尔 (形状无损)
      out.push(g.map(p => ({ ...p })));
    }
  }
  return out;
}

// ---------- 弧长测量与剖分 ----------

/** 测量后的段序列: 每段的等参采样弧长表 + 全局累计弧长 */
export interface MeasuredSegments {
  segs: BezierSeg[];
  /** 每段内等参采样点的段内累计弧长 (steps+1 项, 0 起) */
  lens: number[][];
  /** 每段起点在全局的累计弧长 (segs.length+1 项, 0 起) */
  cum: number[];
  /** 全局总弧长 */
  total: number;
  /** 每段采样步数 */
  steps: number[];
}

/** 弧长测量: 按控制多边形长度自适应采样密度 (16~512 步/段) */
export function measureSegments(segs: BezierSeg[]): MeasuredSegments {
  const lens: number[][] = [], cum: number[] = [0], steps: number[] = [];
  let acc = 0;
  for (const seg of segs) {
    let poly = 0;
    for (let i = 1; i < seg.length; i++) poly += Math.hypot(seg[i].x - seg[i - 1].x, seg[i].y - seg[i - 1].y);
    const n = Math.max(16, Math.min(512, Math.ceil(poly)));
    steps.push(n);
    const arr = [0];
    let prev = seg[0], la = 0;
    for (let i = 1; i <= n; i++) {
      const p = deCasteljau(seg, i / n);
      la += Math.hypot(p.x - prev.x, p.y - prev.y);
      arr.push(la);
      prev = p;
    }
    lens.push(arr);
    acc += la;
    cum.push(acc);
  }
  return { segs, lens, cum, total: acc, steps };
}

/** 段内弧长 la -> 参数 t (采样表二分 + 线性插值) */
function tAtLength(m: MeasuredSegments, seg: number, la: number): number {
  const arr = m.lens[seg], n = m.steps[seg];
  if (la <= 0) return 0;
  if (la >= arr[n]) return 1;
  let lo = 0, hi = n;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (arr[mid] <= la) lo = mid; else hi = mid; }
  const l0 = arr[lo], l1 = arr[hi];
  return (lo + (l1 > l0 ? (la - l0) / (l1 - l0) : 0)) / n;
}

/**
 * 按全局弧长区间 [d0, d1] 截取子段序列 (de Casteljau 剖分, 形状无损)。
 * 返回的每条贝塞尔对应原段的一部分; 跨原段边界处的接缝由调用方转回控制点时以重复点 (红锚点) 保留。
 */
export function extractRange(m: MeasuredSegments, d0: number, d1: number): BezierSeg[] {
  const a = Math.max(0, Math.min(d0, m.total));
  const b = Math.max(a, Math.min(d1, m.total));
  const out: BezierSeg[] = [];
  for (let i = 0; i < m.segs.length; i++) {
    const s0 = m.cum[i], s1 = m.cum[i + 1];
    if (s1 <= a + 1e-9 || s0 >= b - 1e-9) continue;
    const la0 = Math.max(0, a - s0), la1 = Math.min(s1 - s0, b - s0);
    if (la1 - la0 < 1e-6) continue;
    out.push(subBezier(m.segs[i], tAtLength(m, i, la0), tAtLength(m, i, la1)));
  }
  return out;
}

/**
 * 贝塞尔段序列 -> .osu 控制点列 (含头部 = 首段首点)。
 * 跨段接缝用重复点 (红锚点) 保持分段语义: 段 k 末点 = 段 k+1 首点, 连续写两次。
 */
export function segmentsToPoints(segs: BezierSeg[]): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k];
    if (k > 0) out.push({ x: seg[0].x, y: seg[0].y }); // 红锚点接缝 (与上一点同坐标)
    for (let i = k > 0 ? 1 : 0; i < seg.length; i++) out.push({ x: seg[i].x, y: seg[i].y });
  }
  return out;
}
