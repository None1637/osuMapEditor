// v117: 滑条节点多选 (Alt 层) 纯函数 — 命中/框选/包围盒/红锚点对扩展/快照/变换
// 交互语义见 EditorCanvas: Alt+点选(加选)/框选选中节点, 整体拖动/旋转/缩放; 物件层行为不受影响
import type { Beatmap, HitObject } from './parser';
import { redPairPartner } from './sliderPath';
import type { Pt, Quad } from './selectionBox';

/** 节点选区: objId -> 控制点下标集 (0 = 头部) */
export type NodeSel = ReadonlyMap<number, ReadonlySet<number>>;
export type NodeEntry = [number, number]; // [objId, 控制点下标]
type Offsets = Map<number, { dx: number; dy: number }>;

/** 控制点列 (含头部), 带堆叠偏移 (显示/命中共用) */
export function ctrlPoints(o: HitObject, off?: { dx: number; dy: number }): Pt[] {
  const dx = off?.dx ?? 0, dy = off?.dy ?? 0;
  return [{ x: o.x + dx, y: o.y + dy }, ...(o.curvePoints ?? []).map(p => ({ x: p.x + dx, y: p.y + dy }))];
}

/** 展平节点选区为 [objId, idx][] (框选 base/遍历用) */
export function nodeEntries(sel: NodeSel): NodeEntry[] {
  const out: NodeEntry[] = [];
  for (const [objId, idxs] of sel) for (const idx of idxs) out.push([objId, idx]);
  return out;
}

/** 跨滑条命中最优先: 距离最近者胜, 并列取序号在前 (与单滑条 nearestCtrlPoint 一致) */
export function nearestNode(sliders: HitObject[], offsets: Offsets, p: Pt, maxDist = 10): { objId: number; idx: number } | null {
  let best: { objId: number; idx: number } | null = null, bestD = maxDist;
  for (const o of sliders) {
    const ctrl = ctrlPoints(o, offsets.get(o.id));
    for (let i = 0; i < ctrl.length; i++) {
      const d = Math.hypot(ctrl[i].x - p.x, ctrl[i].y - p.y);
      if (d <= maxDist && (!best || d < bestD)) { best = { objId: o.id, idx: i }; bestD = d; }
    }
  }
  return best;
}

/** 框选: 返回落在矩形内的全部节点 (红锚点重复对坐标相同, 两个下标都会命中 — 变换时天然一起动) */
export function nodesInRect(sliders: HitObject[], offsets: Offsets, r: { minX: number; minY: number; maxX: number; maxY: number }): NodeEntry[] {
  const out: NodeEntry[] = [];
  for (const o of sliders) {
    const ctrl = ctrlPoints(o, offsets.get(o.id));
    for (let i = 0; i < ctrl.length; i++) {
      if (ctrl[i].x >= r.minX && ctrl[i].x <= r.maxX && ctrl[i].y >= r.minY && ctrl[i].y <= r.maxY) out.push([o.id, i]);
    }
  }
  return out;
}

/** 节点选区包围盒: q = 点集轴对齐盒 (变换数学用), dq = 外扩 pad (显示盒, 与物件框 q/dq 分离同款) */
export function nodeBounds(bm: Beatmap, sel: NodeSel, offsets: Offsets, pad = 8): { q: Quad; dq: Quad } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  for (const [objId, idxs] of sel) {
    const o = bm.hitObjects.find(x => x.id === objId);
    if (!o || o.type !== 'slider') continue;
    const ctrl = ctrlPoints(o, offsets.get(objId));
    for (const idx of idxs) {
      const pt = ctrl[idx];
      if (!pt) continue;
      n++;
      minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
    }
  }
  if (!n) return null;
  const q: Quad = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  return { q, dq: { x: q.x - pad, y: q.y - pad, w: q.w + pad * 2, h: q.h + pad * 2 } };
}

/** 红锚点对扩展: 只选对中一个时, 变换把另一个也带上 (v29 语义: 重复对不拆散) */
export function withRedPartners(bm: Beatmap, sel: NodeSel): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const [objId, idxs] of sel) {
    const o = bm.hitObjects.find(x => x.id === objId);
    if (!o || o.type !== 'slider') continue;
    const ctrl = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
    const s = new Set(idxs);
    for (const idx of idxs) {
      const partner = redPairPartner(ctrl, idx);
      if (partner !== null) s.add(partner);
    }
    out.set(objId, s);
  }
  return out;
}

/** 拖拽 Begin 快照: objId -> (idx -> 原始坐标, 不含堆叠偏移) */
export function snapshotNodes(bm: Beatmap, sel: NodeSel): Map<number, Map<number, Pt>> {
  const out = new Map<number, Map<number, Pt>>();
  for (const [objId, idxs] of sel) {
    const o = bm.hitObjects.find(x => x.id === objId);
    if (!o || o.type !== 'slider') continue;
    const m = new Map<number, Pt>();
    for (const idx of idxs) {
      if (idx === 0) m.set(0, { x: o.x, y: o.y });
      else {
        const pt = o.curvePoints?.[idx - 1];
        if (pt) m.set(idx, { x: pt.x, y: pt.y });
      }
    }
    if (m.size) out.set(objId, m);
  }
  return out;
}

/** 写回单个节点 (idx 0 = 头部) */
export function setNodePoint(o: HitObject, idx: number, p: Pt) {
  if (idx === 0) { o.x = p.x; o.y = p.y; }
  else if (o.curvePoints?.[idx - 1]) { o.curvePoints[idx - 1].x = p.x; o.curvePoints[idx - 1].y = p.y; }
}

/** 从快照按 fn 重算全部选中节点 (取整写回), 返回受影响滑条 id (调用方负责 resnap/invalidate) */
export function transformNodesFromSnapshot(bm: Beatmap, orig: Map<number, Map<number, Pt>>, fn: (p: Pt) => Pt): number[] {
  const affected: number[] = [];
  for (const [objId, pts] of orig) {
    const o = bm.hitObjects.find(x => x.id === objId);
    if (!o) continue;
    for (const [idx, pt] of pts) {
      const q = fn(pt);
      setNodePoint(o, idx, { x: Math.round(q.x), y: Math.round(q.y) });
    }
    affected.push(objId);
  }
  return affected;
}
