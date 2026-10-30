// v519: 批量插入规则的可编辑子滑条画布 — 局部选区/历史/拖拽, 不触碰主谱面
import { useEffect, useRef, useState } from 'react';
import { csToRadius, type Beatmap, type HitObject, type Vec2 } from '@/osu/parser';
import { computeCombos, drawSliderControlPoints, getSliderPath, invalidatePath, renderPlayfield } from '@/osu/renderer';
import { getSkin } from '@/osu/skin';
import { nearestOnSegment, redPairPartner, sliderGeometryLength } from '@/osu/sliderPath';
import { nodeBounds } from '@/osu/nodeSelection';
import {
  anchorOpposite, anchorAxis, anchorPoint, dragToScale, hitRotationHandle, hitScaleHandle,
  rotationHandlePoints, ROT_HANDLE_OUT, angleDeltaDeg, snapRotation, scaleHandleAnchors,
  scaledPosition, selectionDisplayQuad, selectionScaleQuad,
  type Quad, type RotateCorner, type ScaleAnchor,
} from '@/osu/selectionBox';
import type { AnchorStampTemplate } from '@/osu/convert/anchorStamp';
import {
  cloneStampEditState, contextStampPoint, deleteStampSelection, flipStamp,
  insertStampPoint, nearestStampNode, nudgeStamp, reverseStamp, rotateStamp, setStampCurveType, stampEditState,
  stampPointCenter, stableStampObjectId, toggleStampNodeGroup, toggleStampPoint, transformStampFrom,
  type AnchorStampTemplateEditState,
} from '@/osu/convert/anchorStampTemplateEdit';
import { activateAnchorStampEditor, releaseAnchorStampEditor } from '@/osu/convert/anchorStampEditScope';
import { useT } from '@/i18n';

interface View { scale: number; cx: number; cy: number; width: number; height: number; dpr: number }
interface DragBase { before: AnchorStampTemplateEditState; changed: boolean }
type Drag = DragBase & (
  | { kind: 'move' | 'node'; start: Vec2; indices: Set<number> | null; toggleIndex?: number }
  | { kind: 'marquee'; start: Vec2; current: Vec2; base: Set<number>; subtract: boolean }
  | { kind: 'scale'; anchor: ScaleAnchor; quad: Quad; start: Vec2; indices: Set<number> | null; defaultOrigin: Vec2 }
  | { kind: 'rotate'; corner: RotateCorner; last: Vec2; raw: number; origin: Vec2; indices: Set<number> | null }
);
interface ResizeDrag { x: number; y: number; dialogWidth: number; height: number; horizontal: boolean; vertical: boolean }

export function AnchorStampTemplateCanvas({ uid, testid, template, base, dialogWidth, height, onResize, onChange }: {
  uid: string;
  testid: string;
  template: AnchorStampTemplate;
  base: Beatmap;
  dialogWidth: number;
  height: number;
  onResize: (next: { dialogWidth: number; height: number }) => void;
  onChange: (next: AnchorStampTemplate) => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const objectId = useRef(stableStampObjectId(uid)).current;
  const [draft, setDraft] = useState<AnchorStampTemplateEditState>(() => stampEditState(template));
  const draftRef = useRef(draft);
  const [, setTick] = useState(0);
  const redraw = () => setTick(x => x + 1);
  const dragRef = useRef<Drag | null>(null);
  const resizeRef = useRef<ResizeDrag | null>(null);
  const viewRef = useRef<View | null>(null);
  const fitRef = useRef(true);
  const historyRef = useRef<{ undo: AnchorStampTemplateEditState[]; redo: AnchorStampTemplateEditState[] }>({ undo: [], redo: [] });
  const lastEmittedRef = useRef<AnchorStampTemplate>(template);
  const onChangeRef = useRef(onChange);
  const onResizeRef = useRef(onResize);
  onChangeRef.current = onChange;
  onResizeRef.current = onResize;

  const update = (next: AnchorStampTemplateEditState) => {
    // v519: 几何同步给父窗口, 关闭/Apply 永远拿到末次编辑; 选区变化不重算盖章
    if (next.template !== draftRef.current.template) {
      lastEmittedRef.current = next.template;
      onChangeRef.current(next.template);
    }
    draftRef.current = next;
    setDraft(next);
  };

  // 捕获/外部替换才重置本地会话; 自己 onChange 回显的同一引用不重置拖拽与选区
  useEffect(() => {
    if (template === lastEmittedRef.current) return;
    lastEmittedRef.current = template;
    const next = stampEditState(template);
    draftRef.current = next;
    setDraft(next);
    historyRef.current = { undo: [], redo: [] };
    dragRef.current = null;
    fitRef.current = true;
  }, [template]);

  useEffect(() => () => {
    invalidatePath(objectId);
    releaseAnchorStampEditor(uid);
  }, [objectId, uid]);

  // v520: 边缘拖动/浮窗 fit 改变实际画布尺寸后, 重算显示与命中共用的视图矩阵
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ro = new ResizeObserver(() => { fitRef.current = true; redraw(); });
    ro.observe(c);
    return () => ro.disconnect();
  }, [uid]);

  const makeScratch = (s: AnchorStampTemplateEditState): { bm: Beatmap; o: HitObject } => {
    const pts = s.template.points;
    const o: HitObject = {
      id: objectId, type: 'slider', x: pts[0].x, y: pts[0].y, time: 0,
      newCombo: true, comboSkip: 0, hitSound: 0, curveType: s.template.curveType,
      curvePoints: pts.slice(1).map(p => ({ ...p })), slides: 1,
      length: Math.max(1, sliderGeometryLength(s.template.curveType, pts)),
    };
    return { bm: { ...base, hitObjects: [o] }, o };
  };

  const fitView = () => {
    const c = canvasRef.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    const width = rect.width || 380, height = rect.height || 150, dpr = window.devicePixelRatio || 1;
    const pts = draftRef.current.template.points;
    const r = csToRadius(base.difficulty.cs);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
    }
    const scale = Math.max(0.05, Math.min(2, Math.min((width - 16) / Math.max(1, x1 - x0), (height - 16) / Math.max(1, y1 - y0))));
    viewRef.current = { scale, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, width, height, dpr };
    fitRef.current = false;
  };

  const toPoint = (e: { clientX: number; clientY: number }): Vec2 => {
    const c = canvasRef.current!, v = viewRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - v.width / 2) / v.scale + v.cx,
      y: (e.clientY - r.top - v.height / 2) / v.scale + v.cy,
    };
  };

  const currentQuads = (s: AnchorStampTemplateEditState): { q: Quad; dq: Quad } | null => {
    const { bm, o } = makeScratch(s);
    if (s.selected.size) return nodeBounds(bm, new Map([[objectId, s.selected]]), new Map(), 8);
    const q = selectionScaleQuad([o]);
    const dq = selectionDisplayQuad(bm, [o], csToRadius(base.difficulty.cs));
    return q && dq ? { q, dq } : null;
  };

  const bodyHit = (s: AnchorStampTemplateEditState, p: Vec2): boolean => {
    const { bm, o } = makeScratch(s);
    invalidatePath(objectId);
    const pts = getSliderPath(bm, o).points;
    const tol = csToRadius(base.difficulty.cs); // v519: 整个可见滑条身都可整体拖动
    for (let i = 0; i < pts.length - 1; i++) if (nearestOnSegment(pts[i], pts[i + 1], p).dist <= tol) return true;
    return false;
  };

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    if (fitRef.current || !viewRef.current) fitView();
    const v = viewRef.current!;
    const bw = Math.max(1, Math.round(v.width * v.dpr)), bh = Math.max(1, Math.round(v.height * v.dpr));
    if (c.width !== bw) c.width = bw;
    if (c.height !== bh) c.height = bh;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#08080c'; g.fillRect(0, 0, bw, bh);
    g.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale,
      v.dpr * (v.width / 2 - v.cx * v.scale), v.dpr * (v.height / 2 - v.cy * v.scale));
    const { bm, o } = makeScratch(draft);
    invalidatePath(objectId);
    renderPlayfield({ g, bm, skin: getSkin(), time: 1, selected: new Set(), comboInfo: computeCombos(bm), stackOffsets: new Map() });
    drawSliderControlPoints(g, o);

    const px = 1 / v.scale;
    if (draft.selected.size) {
      g.save(); g.strokeStyle = '#f2b544'; g.lineWidth = 2 * px;
      draft.template.points.forEach((p, i) => {
        if (!draft.selected.has(i)) return;
        g.beginPath(); g.arc(p.x, p.y, 9 * px, 0, Math.PI * 2); g.stroke();
      });
      g.restore();
    }
    const quads = currentQuads(draft);
    if (quads) {
      const { q, dq } = quads;
      g.save(); g.strokeStyle = '#f2b544'; g.lineWidth = 2 * px;
      g.strokeRect(dq.x, dq.y, dq.w, dq.h);
      g.fillStyle = '#f2b544'; g.strokeStyle = '#1a1a20'; g.lineWidth = px;
      for (const a of scaleHandleAnchors(q)) {
        const hp = anchorPoint(dq, a), sz = 9 * px;
        g.fillRect(hp.x - sz / 2, hp.y - sz / 2, sz, sz); g.strokeRect(hp.x - sz / 2, hp.y - sz / 2, sz, sz);
      }
      for (const h of rotationHandlePoints(dq, ROT_HANDLE_OUT * px)) {
        g.fillStyle = '#f2b544'; g.beginPath(); g.arc(h.x, h.y, 6 * px, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#1a1a20'; g.beginPath(); g.arc(h.x, h.y, 3 * px, -Math.PI * 0.7, Math.PI * 0.55); g.stroke();
      }
      g.restore();
    }
    const drag = dragRef.current;
    if (drag?.kind === 'marquee') {
      const x = Math.min(drag.start.x, drag.current.x), y = Math.min(drag.start.y, drag.current.y);
      const w = Math.abs(drag.start.x - drag.current.x), h = Math.abs(drag.start.y - drag.current.y);
      g.save(); g.fillStyle = 'rgba(242,181,68,0.08)'; g.strokeStyle = 'rgba(242,181,68,0.9)';
      g.lineWidth = 1.5 * px; g.setLineDash([5 * px, 4 * px]);
      g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h); g.restore();
    }
  });

  const pushUndo = (s: AnchorStampTemplateEditState) => {
    historyRef.current.undo.push(cloneStampEditState(s));
    if (historyRef.current.undo.length > 50) historyRef.current.undo.shift();
    historyRef.current.redo = [];
  };

  const perform = (fn: (s: AnchorStampTemplateEditState) => AnchorStampTemplateEditState | null): boolean => {
    const cur = draftRef.current, next = fn(cur);
    if (!next || next === cur) return false;
    pushUndo(cur); update(next);
    return true;
  };

  const applyDrag = (drag: Drag, next: AnchorStampTemplateEditState) => {
    if (!drag.changed) { pushUndo(drag.before); drag.changed = true; }
    update(next);
  };

  const expandedSelection = (s: AnchorStampTemplateEditState): Set<number> => {
    const out = new Set(s.selected);
    for (const i of s.selected) {
      const p = redPairPartner(s.template.points, i);
      if (p !== null) out.add(p);
    }
    return out;
  };

  const dispatchRef = useRef<(cmd: string) => boolean>(() => false);
  dispatchRef.current = (cmd: string): boolean => {
    if (!['undo', 'redo', 'delete', 'cancel', 'reverse', 'rot-ccw', 'rot-cw', 'flip-h', 'flip-v',
      'ctrl-left', 'ctrl-right', 'ctrl-up', 'ctrl-down'].includes(cmd)) return false;
    dragRef.current = null; // v519: 命令优先终止当前拖拽, 防止 undo 后旧快照继续覆盖
    const cur = draftRef.current, hist = historyRef.current;
    switch (cmd) {
      case 'undo': {
        const prev = hist.undo.pop(); if (!prev) return true;
        hist.redo.push(cloneStampEditState(cur)); update(prev); return true;
      }
      case 'redo': {
        const next = hist.redo.pop(); if (!next) return true;
        hist.undo.push(cloneStampEditState(cur)); update(next); return true;
      }
      case 'delete': perform(deleteStampSelection); return true;
      case 'cancel': update({ ...cur, selected: new Set() }); return true;
      case 'reverse': perform(s => reverseStamp(s)); return true;
      case 'rot-ccw': perform(s => rotateStamp(s, -90)); return true;
      case 'rot-cw': perform(s => rotateStamp(s, 90)); return true;
      case 'flip-h': perform(s => flipStamp(s, 'h')); return true;
      case 'flip-v': perform(s => flipStamp(s, 'v')); return true;
      case 'ctrl-left': perform(s => nudgeStamp(s, -1, 0)); return true;
      case 'ctrl-right': perform(s => nudgeStamp(s, 1, 0)); return true;
      case 'ctrl-up': perform(s => nudgeStamp(s, 0, -1)); return true;
      case 'ctrl-down': perform(s => nudgeStamp(s, 0, 1)); return true;
      default: return false;
    }
  };

  const claim = () => activateAnchorStampEditor(uid, cmd => dispatchRef.current(cmd));
  const activate = () => {
    claim();
    canvasRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      // v519: 点击自绘菜单后仍由活动模板接收菜单命令, 不能先退回主谱面作用域
      if (e.target instanceof Element && e.target.closest('[data-menu-bar]')) return;
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) releaseAnchorStampEditor(uid);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [uid]);

  const startResize = (e: React.MouseEvent, horizontal: boolean, vertical: boolean) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = null;
    resizeRef.current = { x: e.clientX, y: e.clientY, dialogWidth, height, horizontal, vertical };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !viewRef.current) return;
    e.preventDefault(); activate();
    const p = toPoint(e), s = draftRef.current;
    const quads = currentQuads(s);
    const indices = s.selected.size ? expandedSelection(s) : null;
    if (quads) {
      const corner = hitRotationHandle(quads.dq, p, 10 / viewRef.current.scale, ROT_HANDLE_OUT / viewRef.current.scale);
      if (corner) {
        dragRef.current = { kind: 'rotate', before: cloneStampEditState(s), changed: false, corner,
          last: p, raw: 0, origin: stampPointCenter(s.template.points, indices ?? undefined), indices };
        return;
      }
      const anchor = hitScaleHandle(quads.q, quads.dq, p, 9 / viewRef.current.scale);
      if (anchor) {
        dragRef.current = { kind: 'scale', before: cloneStampEditState(s), changed: false, anchor,
          quad: quads.q, start: p, indices, defaultOrigin: stampPointCenter(s.template.points, indices ?? undefined) };
        return;
      }
    }

    const hit = nearestStampNode(s.template.points, p, viewRef.current.scale);
    if (e.altKey) {
      if (hit >= 0) update(toggleStampNodeGroup(s, hit));
      else dragRef.current = { kind: 'marquee', before: cloneStampEditState(s), changed: false,
        start: p, current: p, base: (e.shiftKey || e.ctrlKey || e.metaKey) ? new Set(s.selected) : new Set(),
        subtract: e.shiftKey && !e.ctrlKey && !e.metaKey };
      redraw();
      return;
    }
    if (hit >= 0) {
      if (e.shiftKey) { update(toggleStampNodeGroup(s, hit)); return; }
      if (e.ctrlKey || e.metaKey) {
        const selected = new Set([hit]);
        const partner = redPairPartner(s.template.points, hit);
        if (partner !== null) selected.add(partner);
        dragRef.current = { kind: 'node', before: cloneStampEditState(s), changed: false,
          start: p, indices: selected, toggleIndex: hit };
        return;
      }
      const selected = s.selected.has(hit) ? new Set(s.selected) : new Set([hit]);
      const next = { ...s, selected };
      if (!s.selected.has(hit)) update(next);
      dragRef.current = { kind: 'move', before: cloneStampEditState(next), changed: false,
        start: p, indices: expandedSelection(next) };
      return;
    }
    if (e.ctrlKey || e.metaKey) { perform(s0 => insertStampPoint(s0, p)); return; }
    if (s.selected.size && quads
      && p.x >= quads.dq.x && p.x <= quads.dq.x + quads.dq.w && p.y >= quads.dq.y && p.y <= quads.dq.y + quads.dq.h) {
      dragRef.current = { kind: 'move', before: cloneStampEditState(s), changed: false, start: p, indices: expandedSelection(s) };
      return;
    }
    if (bodyHit(s, p)) {
      const next = { ...s, selected: new Set<number>() };
      if (s.selected.size) update(next);
      dragRef.current = { kind: 'move', before: cloneStampEditState(next), changed: false, start: p, indices: null };
      return;
    }
    update({ ...s, selected: new Set() });
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const rs = resizeRef.current;
      if (rs) {
        // v520: 目标尺寸始终以拖拽起点计算, 不在父组件中逐帧累加 delta
        onResizeRef.current({
          dialogWidth: Math.max(360, Math.min(1200, rs.dialogWidth + (rs.horizontal ? e.clientX - rs.x : 0))),
          height: Math.max(90, Math.min(600, rs.height + (rs.vertical ? e.clientY - rs.y : 0))),
        });
        return;
      }
      const drag = dragRef.current;
      if (!drag || !viewRef.current) return;
      const p = toPoint(e);
      if (drag.kind === 'marquee') {
        drag.current = p;
        const x0 = Math.min(drag.start.x, p.x), x1 = Math.max(drag.start.x, p.x);
        const y0 = Math.min(drag.start.y, p.y), y1 = Math.max(drag.start.y, p.y);
        const selected = new Set(drag.base);
        draftRef.current.template.points.forEach((pt, i) => {
          if (pt.x < x0 || pt.x > x1 || pt.y < y0 || pt.y > y1) return;
          if (drag.subtract) selected.delete(i); else selected.add(i);
        });
        update({ ...draftRef.current, selected });
        return;
      }
      if (drag.kind === 'move' || drag.kind === 'node') {
        const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        applyDrag(drag, transformStampFrom(drag.before, drag.indices, pt => ({ x: pt.x + dx, y: pt.y + dy })));
        return;
      }
      if (drag.kind === 'scale') {
        const raw = dragToScale(drag.anchor, drag.quad.w, drag.quad.h, p.x - drag.start.x, p.y - drag.start.y, e.shiftKey);
        const origin = e.altKey ? drag.defaultOrigin : anchorOpposite(drag.quad, drag.anchor);
        const axis = anchorAxis(drag.anchor);
        const sc = { x: axis === 'y' ? 1 : raw.x, y: axis === 'x' ? 1 : raw.y };
        applyDrag(drag, transformStampFrom(drag.before, drag.indices, pt => scaledPosition(sc, origin, pt)));
        return;
      }
      if (drag.kind === 'rotate') {
        drag.raw += angleDeltaDeg(drag.origin, drag.last, p); drag.last = p;
        const deg = snapRotation(drag.raw, e.shiftKey), rad = deg * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad), c = drag.origin;
        applyDrag(drag, transformStampFrom(drag.before, drag.indices, pt => ({
          x: c.x + (pt.x - c.x) * cos - (pt.y - c.y) * sin,
          y: c.y + (pt.x - c.x) * sin + (pt.y - c.y) * cos,
        })));
      }
    };
    const up = () => {
      if (resizeRef.current) { resizeRef.current = null; return; }
      const drag = dragRef.current; if (!drag) return;
      if (drag.kind === 'node' && !drag.changed && drag.toggleIndex !== undefined) {
        perform(s => toggleStampPoint(s, drag.toggleIndex!));
      }
      dragRef.current = null; redraw();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  return (
    <div ref={rootRef} data-anchor-stamp-editor={uid} data-conv={testid} onPointerDown={claim} className="relative space-y-1">
      <canvas ref={canvasRef} data-conv={`${testid}-canvas`} tabIndex={0} style={{ height }}
        className="block w-full rounded border border-white/15 cursor-crosshair outline-none focus:border-cyan-300/60"
        onMouseDown={onMouseDown}
        onFocus={claim}
        onContextMenu={e => {
          e.preventDefault(); activate();
          if (!viewRef.current) return;
          const hit = nearestStampNode(draftRef.current.template.points, toPoint(e), viewRef.current.scale);
          if (hit >= 0) perform(s => contextStampPoint(s, hit));
        }} />
      {/* v520: 右/下/角拖动编辑区, 浮窗尺寸由父组件同步 */}
      <div data-conv={`${testid}-resize-x`} onMouseDown={e => startResize(e, true, false)}
        className="absolute -right-1 top-0 w-2 cursor-ew-resize" style={{ height }} />
      <div data-conv={`${testid}-resize-y`} onMouseDown={e => startResize(e, false, true)}
        className="absolute left-0 right-0 h-2 cursor-ns-resize" style={{ top: height - 4 }} />
      <div data-conv={`${testid}-resize-xy`} onMouseDown={e => startResize(e, true, true)}
        className="absolute -right-1 w-3 h-3 cursor-nwse-resize border-r-2 border-b-2 border-white/45"
        style={{ top: height - 4 }} />
      <div className="flex items-center gap-2">
        <span className="text-white/40 text-xs">{t('convert.stamp_curve', 'Curve')}</span>
        <select data-conv={`${testid}-curve`} value={draft.template.curveType}
          onChange={e => perform(s => setStampCurveType(s, e.target.value))}
          className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white text-xs">
          {['L', 'P', 'B', 'C', 'B4'].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <span className="text-white/35 text-xs">{t('convert.stamp_editor_hint', 'Alt select / Ctrl add or red anchor / Right-click delete')}</span>
      </div>
    </div>
  );
}
