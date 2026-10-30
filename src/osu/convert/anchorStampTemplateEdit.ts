// v519: 批量插入窗口内的子滑条几何编辑 — 不依赖全局 store/主谱面选区
import type { Vec2 } from '../parser';
import {
  altNodeToggleGroup, deleteSliderPoint, deleteSliderPoints, isRedPairPoint, nearestOnSegment,
  redPairPartner, resolveSliderCurveType, toggleSliderPointRed,
} from '../sliderPath';
import { anchorHitRadius } from '../nodeSelection';
import type { AnchorStampTemplate } from './anchorStamp';

export interface AnchorStampTemplateEditState {
  template: AnchorStampTemplate;
  selected: Set<number>;
  manualCurve: boolean;
}

export const cloneStampTemplate = (t: AnchorStampTemplate): AnchorStampTemplate => ({
  curveType: t.curveType,
  points: t.points.map(p => ({ x: p.x, y: p.y })),
});

export const cloneStampEditState = (s: AnchorStampTemplateEditState): AnchorStampTemplateEditState => ({
  template: cloneStampTemplate(s.template), selected: new Set(s.selected), manualCurve: s.manualCurve,
});

export const stampEditState = (t: AnchorStampTemplate): AnchorStampTemplateEditState => ({
  template: cloneStampTemplate(t), selected: new Set(), manualCurve: false,
});

/** 点列写回并保持主游玩区的曲线类型推断/手动类型语义 */
export function applyStampPoints(s: AnchorStampTemplateEditState, points: Vec2[], selected = s.selected): AnchorStampTemplateEditState {
  return {
    template: {
      curveType: s.manualCurve ? s.template.curveType : resolveSliderCurveType(points, s.template.curveType),
      points: points.map(p => ({ x: p.x, y: p.y })),
    },
    selected: new Set([...selected].filter(i => i >= 0 && i < points.length)),
    manualCurve: s.manualCurve,
  };
}

export function setStampCurveType(s: AnchorStampTemplateEditState, curveType: string): AnchorStampTemplateEditState {
  return { ...cloneStampEditState(s), template: { ...cloneStampTemplate(s.template), curveType }, manualCurve: true };
}

/** 以操作前快照为基准变换选中点 (indices=null = 全部点)，拖拽期间不累计舍入误差 */
export function transformStampFrom(
  before: AnchorStampTemplateEditState, indices: ReadonlySet<number> | null,
  fn: (p: Vec2) => Vec2,
): AnchorStampTemplateEditState {
  const pts = before.template.points.map((p, i) => {
    if (indices && !indices.has(i)) return { ...p };
    const q = fn(p);
    return { x: Math.round(q.x), y: Math.round(q.y) };
  });
  return applyStampPoints(before, pts);
}

export const stampPointCenter = (pts: Vec2[], indices?: ReadonlySet<number>): Vec2 => {
  let x = 0, y = 0, n = 0;
  pts.forEach((p, i) => { if (!indices || indices.has(i)) { x += p.x; y += p.y; n++; } });
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
};

/** v519: 所有几何命令都扩展红锚点重复对, 禁止只动一端把红色语义拆散 */
export function expandedStampSelection(s: AnchorStampTemplateEditState): Set<number> | null {
  if (!s.selected.size) return null;
  const out = new Set(s.selected);
  for (const i of s.selected) {
    const partner = redPairPartner(s.template.points, i);
    if (partner !== null) out.add(partner);
  }
  return out;
}

const actionIndices = (s: AnchorStampTemplateEditState): Set<number> | null =>
  s.selected.size > 1 ? expandedStampSelection(s) : null;

export function rotateStamp(s: AnchorStampTemplateEditState, deg: number): AnchorStampTemplateEditState {
  const indices = actionIndices(s), c = stampPointCenter(s.template.points, indices ?? undefined);
  const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  return transformStampFrom(s, indices, p => ({
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos,
  }));
}

export function flipStamp(s: AnchorStampTemplateEditState, axis: 'h' | 'v'): AnchorStampTemplateEditState {
  const indices = actionIndices(s), c = stampPointCenter(s.template.points, indices ?? undefined);
  return transformStampFrom(s, indices, p => axis === 'h'
    ? { x: 2 * c.x - p.x, y: p.y }
    : { x: p.x, y: 2 * c.y - p.y });
}

export function nudgeStamp(s: AnchorStampTemplateEditState, dx: number, dy: number): AnchorStampTemplateEditState {
  const indices = expandedStampSelection(s);
  return transformStampFrom(s, indices, p => ({ x: p.x + dx, y: p.y + dy }));
}

export function reverseStamp(s: AnchorStampTemplateEditState): AnchorStampTemplateEditState {
  const n = s.template.points.length;
  return applyStampPoints(s, s.template.points.slice().reverse(), new Set([...s.selected].map(i => n - 1 - i)));
}

/** Ctrl+点击空白插点: 光标原位置, 最近非零长控制线段之后 */
export function insertStampPoint(s: AnchorStampTemplateEditState, p: Vec2): AnchorStampTemplateEditState {
  const pts = s.template.points;
  if (pts.length < 2) return s;
  let seg = pts.length - 2, best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i].x === pts[i + 1].x && pts[i].y === pts[i + 1].y) continue;
    const d = nearestOnSegment(pts[i], pts[i + 1], p).dist;
    if (d < best) { best = d; seg = i; }
  }
  const next = [...pts.slice(0, seg + 1), { x: Math.round(p.x), y: Math.round(p.y) }, ...pts.slice(seg + 1)];
  const out = applyStampPoints(s, next);
  if (!s.manualCurve && s.template.curveType === 'L' && next.length === 3) out.template.curveType = 'P';
  return out;
}

/** Ctrl+点击已有锚点: 白→红 (复制重复点), 红→白 (合并重复对) */
export function toggleStampPoint(s: AnchorStampTemplateEditState, index: number): AnchorStampTemplateEditState | null {
  const next = toggleSliderPointRed(s.template.points, index);
  return next ? applyStampPoints(s, next) : null;
}

/** 右键: 白点删除, 红锚点合并转白; 头部可删但至少保留两点 */
export function contextStampPoint(s: AnchorStampTemplateEditState, index: number): AnchorStampTemplateEditState | null {
  const pts = s.template.points;
  const next = index > 0 && isRedPairPoint(pts, index) ? toggleSliderPointRed(pts, index) : deleteSliderPoint(pts, index);
  return next ? applyStampPoints(s, next) : null;
}

/** Delete: 红锚点配对展开后批量删除, 至少保留两点 */
export function deleteStampSelection(s: AnchorStampTemplateEditState): AnchorStampTemplateEditState | null {
  if (!s.selected.size) return null;
  const expanded = new Set(s.selected);
  for (const i of s.selected) {
    const partner = redPairPartner(s.template.points, i);
    if (partner !== null) expanded.add(partner);
  }
  const next = deleteSliderPoints(s.template.points, expanded);
  return next ? applyStampPoints(s, next, new Set()) : null;
}

export function toggleStampNodeGroup(s: AnchorStampTemplateEditState, index: number): AnchorStampTemplateEditState {
  const selected = new Set(s.selected);
  for (const i of altNodeToggleGroup(s.template.points, index, j => selected.has(j))) {
    if (selected.has(i)) selected.delete(i); else selected.add(i);
  }
  return { ...s, selected };
}

export function nearestStampNode(points: Vec2[], p: Vec2, devicePxPerOsu: number): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i].x - p.x, points[i].y - p.y);
    if (d <= anchorHitRadius(i === 0, devicePxPerOsu) && d < bestD) { best = i; bestD = d; }
  }
  return best;
}

/** 每条规则独立的稳定负数物件 id, 避免与主谱面/其它模板的渲染缓存冲突 */
export function stableStampObjectId(uid: string): number {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
  return -1 - (h === -0x80000000 ? 0 : Math.abs(h)) % 1_000_000;
}
