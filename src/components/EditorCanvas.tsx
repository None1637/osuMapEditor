import { useEffect, useRef, useCallback } from 'react';
import { store, useEditor } from '@/osu/store';
import { getSkin, hitcircleSpriteWidth, type Skin } from '@/osu/skin';
import { renderPlayfield, computeCombos, getSliderPath, invalidatePath, mergedWithPreview, drawDistanceGuideRing, drawPendingSpinner } from '@/osu/renderer';
import { computePendingPath, insertSliderPoint, deleteSliderPoint, toggleSliderPointRed, resolveSliderCurveType, nearestOnSegment, sliderGeometryLength, snapSliderLength, resnapSliderLength, redPairPartner, isRedPairPoint, SliderPath, preserveArcsForBezier, placementLength, snapPlacementTime, spinnerPlacementEnd } from '@/osu/sliderPath';
import { objectSnapPoints, snapToNearby, snapDragDelta, type Pt } from '@/osu/objectSnap';
import { sliderHelperCircle, sliderHelperLines, clipLineToBox, geoHelperSnap, geoHelperSources, geoDistSources, distGuideSnap, geoDragCorrection, GEO_CLIP_BOX, type GeoLine, type GeoCircle } from '@/osu/geometryHelpers';
import { instantiatePattern } from '@/osu/patternLibrary';
import { snapToGrid, squareNormals, triangleGrid, type Pt as GridPt } from '@/osu/gridSnap';
import { computeStackOffsets } from '@/osu/stacking';
import { objectsInRect } from '@/osu/transform';
import { pickTimeNearestHit } from '@/osu/hitPick'; // v154: 重叠命中挑离当前时间最近者
import { selectionScaleQuad, scaleHandleAnchors, anchorPoint, hitScaleHandle, anchorAxis, dragToScale, anchorOpposite, minimumEnclosingCircleCenter, movablePoints, snapshotScaleStates, applyScaleDrag, selectionBoxVisible, selectionDisplayQuad, hitRotationHandle, rotationHandlePoints, angleDeltaDeg, snapRotation, rotationOrigin, applyRotateDrag, scaledPosition, type ScaleAnchor, type RotateCorner, type ScaleObjectState, type Quad } from '@/osu/selectionBox';
import { ctrlPoints, nodeEntries, nearestNode, nodesInRect, nodeBounds, withRedPartners, snapshotNodes, transformNodesFromSnapshot } from '@/osu/nodeSelection';
import { isVisibleAt } from '@/osu/lifecycle';
import { displaySettings } from '@/osu/displaySettings'; // v168: 背景图亮度
import { distanceLockRef, distanceLockDistance } from '@/osu/spacing'; // v145
import { genId, timingAt, csToRadius, arToPreempt, type Beatmap, type HitObject } from '@/osu/parser';
import { IncrementalBSplineBuilder } from '@/osu/freehand/bsplineBuilder';
import { fitSegmentsToPoints } from '@/osu/freehand/freehandFit';

const PW = 512, PH = 384; // osu 游玩区坐标系
const PAD_Y = 40; // 上下留白 (osu px): 摆放在上下边缘的物件 (半径~37px) 不超出屏幕, 对齐 stable 游玩区留边

// 游玩区视图变换 (渲染与鼠标换算共用, 两处必须一致)
// v45: 高度方向放大 1.1 倍 (吃一部分 PAD_Y 留白, 游玩区视觉扩大 ~10%, 宽度适配兜底防溢出)
// v130: 系数 1.1 → 1.2 (几乎吃满 PAD_Y 留白) — 1.1 时垂直 slack 居中分摊, 实测下间隔达 ~64px;
//       1.2 后 slack ≈ 0.7% 可用高, 实测间隔 ≈ 10+3 ≈ 13px (用户规格: 原实测 64px 的 1/5), 游玩区同步再放大 ~9%
// v129: 画布铺满整个主区 (面板改半透明浮层), 游玩区与上时间轴留 18px 间隔, 与下时间轴留 10px 间隔
//       — 预留 = 面板实际行高 + 间隔 (面板行高改动需同步, 见 App.tsx 浮层注释)
const PANEL_TOP_H = 93;    // 上时间轴行高: 92 (canvas h-[92px]) + 1 (border-b)
const PANEL_BOTTOM_H = 82; // 下时间轴行高: 80 (h-20) + 2 (border-t-2)
const GAP_TOP = 18, GAP_BOTTOM = 10; // 用户规格: 上 18px / 下 10px 间隔
const RESERVED_TOP = PANEL_TOP_H + GAP_TOP;        // 111
const RESERVED_BOTTOM = PANEL_BOTTOM_H + GAP_BOTTOM; // 92
function viewTransform(r: { width: number; height: number }) {
  const availH = Math.max(80, r.height - RESERVED_TOP - RESERVED_BOTTOM);
  const scale = Math.min(r.width / PW, (availH / (PH + PAD_Y * 2)) * 1.2); // v130: 1.1 → 1.2
  return { scale, ox: (r.width - PW * scale) / 2, oy: RESERVED_TOP + (availH - PH * scale) / 2 };
}

export function EditorCanvas() {
  useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skinRef = useRef<Skin | null>(null);
  const dragRef = useRef<{ ids: number[]; startX: number; startY: number; orig: Map<number, { x: number; y: number; curve?: { x: number; y: number }[] }>; moved: boolean } | null>(null);
  const nodeDragRef = useRef<{ objId: number; pointIndex: number; pairWith: number | null; startX: number; startY: number; moved: boolean; toggleRed: boolean } | null>(null);
  // 框选: 选择工具下空白处按下拖动 (base = 按下时已有选区, Shift 追加)
  const marqueeRef = useRef<{ x0: number; y0: number; x1: number; y1: number; base: number[] } | null>(null);
  // v34: 自定义变换原点标记拖拽 (UI 状态, 不进 undo)
  const originDragRef = useRef<boolean>(false);
  const gridOriginDragRef = useRef<boolean>(false); // v78: 自定义网格中心标记拖拽
  const symPointDragRef = useRef<0 | 1 | 2>(0); // v210: 自定义对称轴端点拖拽 (0=无, 1/2=端点序号)
  // v68: 批量复制向量箭头头拖拽 (参数在 DuplicateDialog, 经 store.dupVectorDragHandler 回写)
  const dupVectorDragRef = useRef<boolean>(false);
  // v49: 选中框缩放手柄拖拽 (lazer SelectionBoxScaleHandle; startP = 按下位置, states = Begin 快照)
  const scaleDragRef = useRef<{
    anchor: ScaleAnchor; quad: Quad; startP: { x: number; y: number }; lastP: { x: number; y: number };
    states: Map<number, ScaleObjectState>; defaultOrigin: { x: number; y: number };
    shift: boolean; alt: boolean; moved: boolean;
  } | null>(null);
  // v50: 选中框旋转手柄拖拽 (lazer SelectionBoxRotationHandle; 累积角度, Shift 吸附 15°)
  const rotateDragRef = useRef<{
    corner: RotateCorner; states: Map<number, ScaleObjectState>; origin: { x: number; y: number };
    lastP: { x: number; y: number }; rawAngle: number; snap: boolean; moved: boolean;
  } | null>(null);
  // v50: 手柄悬停 (光标形状 + 旋转手柄淡入显示; lazer hover 语义)
  const hoverHandleRef = useRef<{ type: 'scale' | 'rotate'; anchor: string } | null>(null);
  // v117: 节点多选拖拽 (Alt 层) — 整体移动 (anchor = 按下节点, orig = Begin 快照)
  const nodesMoveDragRef = useRef<{ anchor: { objId: number; idx: number }; startX: number; startY: number; orig: Map<number, Map<number, Pt>>; moved: boolean } | null>(null);
  // v117: 节点框选 (Alt+空白拖动; base = 修饰键追加的已有节点)
  const nodeMarqueeRef = useRef<{ x0: number; y0: number; x1: number; y1: number; base: [number, number][] } | null>(null);
  // v117: 节点选区缩放/旋转手柄拖拽 (复用物件手柄几何, 变换写回节点而非整物件)
  const nodeScaleDragRef = useRef<{
    anchor: ScaleAnchor; quad: Quad; startP: { x: number; y: number }; lastP: { x: number; y: number };
    orig: Map<number, Map<number, Pt>>; defaultOrigin: { x: number; y: number };
    shift: boolean; alt: boolean; moved: boolean;
  } | null>(null);
  const nodeRotateDragRef = useRef<{
    corner: RotateCorner; orig: Map<number, Map<number, Pt>>; origin: { x: number; y: number };
    lastP: { x: number; y: number }; rawAngle: number; snap: boolean; moved: boolean;
  } | null>(null);
  // v66: 手绘滑条 (lazer SliderPlacementBlueprint Drawing 模式) —
  // drawCand: 只有头部时按下左键的候选点 (超过 4px 阈值转手绘, 否则 mouseup 落点为普通控制点);
  // freehand: 手绘进行中 (builder 逐点采样, 实时拟合预览)
  const FREEHAND_CIRCLE_THRESHOLD = 0.0015; // lazer FreehandSliderToolboxGroup 默认值 (Tolerance 1.8 / Corner 0.4 为 builder 构造参数)
  const drawCandRef = useRef<{ x: number; y: number; sp: { x: number; y: number }; redAnchor: boolean; isHead?: boolean } | null>(null);
  // v208: 双击已存在的滑条末点 = 置红 (stable 语义), 不结束放置
  const dblRedSkipRef = useRef(false); // 置红后吞掉紧随的 React onDoubleClick finish
  const freehandRef = useRef<{ builder: IncrementalBSplineBuilder } | null>(null);
  // 选中可移动物件 (排除转盘; lazer selectedMovableObjects)
  const selectedMovable = (bm: Beatmap) => bm.hitObjects.filter(o => store.selected.has(o.id) && o.type !== 'spinner');
  // 当前缩放参考包围盒与显示包围盒 (手柄画在显示框上, 缩放数学用位置包围盒 — lazer 同款分离)
  // v50: 仅选中一个单点/转盘时不显示框 (selectionBoxVisible)
  // v52: 显示盒 = 路径实体盒 (lazer blueprint SelectionQuad union + INFLATE 5), P 滑条弧身鼓出也包住
  const currentQuads = (bm: Beatmap): { q: Quad; dq: Quad } | null => {
    // v117: 节点选区非空时, 选中框/手柄作用于选中节点 (节点层优先于物件层)
    if (store.nodeSelectionCount) return nodeBounds(bm, store.selectedNodes, getStackOffsets(bm), 8);
    const objs = selectedMovable(bm);
    if (!selectionBoxVisible(objs)) return null;
    const q = selectionScaleQuad(objs); // 缩放参考盒 (lazer OriginalSurroundingQuad: 头 + 控制点)
    const dq = selectionDisplayQuad(bm, objs, csToRadius(bm.difficulty.cs)); // 显示盒 (lazer: 整条路径含半径 + 5)
    return q && dq ? { q, dq } : null;
  };
  // 自定义原点标记可见条件: 自定义模式且有选区 (无选区时变换不生效, 标记无意义)
  // v165/v166: 批量复制窗口打开时改用弹窗独立的 dupOriginMode (勾选自定义即始终显示, 取消选中不消失; 与左侧栏变换互不干扰)
  const originMarkerVisible = () => store.conversionDialog === 'duplicate'
    ? store.dupOriginMode === 'custom'
    : store.originMode === 'custom' && store.selected.size > 0;
  // v166: 画布标记/拖拽当前绑定的自定义原点 (批量复制窗口打开 = 弹窗独立原点)
  const activeCustomOrigin = () => (store.conversionDialog === 'duplicate' ? store.dupCustomOrigin : store.customOrigin);
  const cursorRef = useRef<{ x: number; y: number; inside: boolean }>({ x: 0, y: 0, inside: false });
  // 堆叠偏移缓存: 仅谱面数据变更 (dataVersion) 时重算
  const stackRef = useRef<{ ver: number; bm: Beatmap; map: Map<number, { dx: number; dy: number }> } | null>(null);
  const getStackOffsets = (bm: Beatmap): Map<number, { dx: number; dy: number }> => {
    const ver = store.getDataVersion();
    if (!stackRef.current || stackRef.current.ver !== ver || stackRef.current.bm !== bm) {
      stackRef.current = { ver, bm, map: computeStackOffsets(bm) };
    }
    return stackRef.current.map;
  };

  // v56: 网格吸附 (lazer: 对象吸附 > 距离吸附 > 位置网格, 网格最后应用并覆盖; 间距 = gridSpacing ?? 谱面 GridSize)
  // v78: 原点 = currentGridOrigin (自定义网格中心或默认游玩区中心)
  const gridSnapAt = (bm: Beatmap, p: GridPt): GridPt =>
    store.gridSnap ? snapToGrid(p, store.gridType, store.currentGridOrigin(), store.gridSpacing ?? bm.editor.gridSize, store.gridRotation, store.limitToPlayfield) : p; // v163: 关闭限制后不钳制

  // v84: 几何辅助吸附 (选中滑条的辅助点/线/圆, mapping tools SnappingTools):
  // v88: 辅助图形来源 — all = 当前可见所有滑条; selection = 当前选中 + 上次选中 (prevGeoIds)
  // v90: geoEnabled 总开关 (工具栏「辅助线」按钮) — 关闭时渲染与吸附同时停
  const geoSourceSliders = (bm: Beatmap): HitObject[] => {
    if (!store.geoEnabled) return [];
    return geoHelperSources(store.geoScope, bm.hitObjects, store.selected, store.prevGeoIds, o => isVisibleAt(bm, o, store.currentTime));
  };
  // 与物件吸附取更近者 (点优先偏置 -3 在 geoHelperSnap 内); 目标随各开关启停
  // v91: exclude = 拖拽中的物件 id (移动拖拽时不吸自身辅助线/点, 否则自锁)
  const geoSnap = (bm: Beatmap, p: Pt, exclude?: ReadonlySet<number>): Pt | null => {
    if (!store.geoCenter && !store.geoCircle && !store.geoLines) return null;
    const lines: GeoLine[] = [], circles: GeoCircle[] = [], points: Pt[] = [];
    for (const o of geoSourceSliders(bm)) {
      if (exclude?.has(o.id)) continue;
      if (store.geoLines) lines.push(...sliderHelperLines(o));
      const c = sliderHelperCircle(o);
      if (c) {
        if (store.geoCircle) circles.push(c);
        if (store.geoCenter) points.push({ x: c.cx, y: c.cy });
      }
    }
    return lines.length || circles.length || points.length ? geoHelperSnap(p, lines, circles, points) : null;
  };
  // v134/v139: 视觉间距辅助线吸附 — 与渲染同一来源 (geoDistSources/geoScope/总开关), 参考点 (物件头/尾中心)
  // 直接吸附到可见金色环带 (distGuideSnap, 目标 = distR); exclude = 拖拽中的物件 id (防自锁, 同 geoSnap)
  const geoDistSnap = (bm: Beatmap, p: Pt, exclude?: ReadonlySet<number>): Pt | null => {
    if (!store.geoDist || !store.geoEnabled) return null;
    const r = csToRadius(bm.difficulty.cs);
    const offs = getStackOffsets(bm);
    const circles: Pt[] = [], paths: Pt[][] = [];
    for (const o of geoDistSources(store.geoScope, bm.hitObjects, store.selected, store.prevGeoIds, oo => isVisibleAt(bm, oo, store.currentTime))) {
      if (exclude?.has(o.id)) continue;
      const so = offs.get(o.id);
      const dx = so?.dx ?? 0, dy = so?.dy ?? 0;
      if (o.type === 'circle') circles.push({ x: o.x + dx, y: o.y + dy });
      else {
        const pts = getSliderPath(bm, o).points;
        if (pts.length > 1) paths.push(dx || dy ? pts.map(q => ({ x: q.x + dx, y: q.y + dy })) : pts);
      }
    }
    return circles.length || paths.length ? distGuideSnap(p, r + store.geoDistValue, circles, paths) : null; // v139: 目标 = 可见环带 (distR)
  };
  /** 物件吸附 + 几何辅助吸附 + 间距辅助线吸附 (v134) 合并: 更近者胜; exclude = 不参与辅助吸附的物件 id (v96: 节点拖拽排除被拖滑条自身 —
   *  直线/三点圆的辅助线由这些点决定, 点必在线上, 只能辅助线跟点动) */
  const snapWithGeo = (bm: Beatmap, p: Pt, obj: Pt | null, exclude?: ReadonlySet<number>): Pt | null => {
    let best = obj;
    for (const c of [geoSnap(bm, p, exclude), geoDistSnap(bm, p, exclude)]) {
      if (c && (!best || Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y))) best = c;
    }
    return best;
  };

  // 锁定间距 (DistanceSpacing): 新物件与上一个物件的距离固定为 DS * 100 * SliderMultiplier * SV * 间隔拍数 (v149: 随 SV, lazer DurationToDistance 同源)
  const snapPlacement = (p: { x: number; y: number }): { x: number; y: number } => {
    const bm = store.beatmap;
    if (!bm) return p;
    // v55: 物件吸附优先于锁定间距 (lazer: 对象吸附 > 距离吸附; 目标 = 可见且未选中物件的中心/滑条尾)
    // v84: 并入几何辅助吸附 (选中滑条的辅助点/线/圆), 与物件吸附取更近者
    const near = snapWithGeo(bm, p, snapToNearby(p, objectSnapPoints(bm, bm.hitObjects.filter(o => !store.selected.has(o.id) && isVisibleAt(bm, o, store.currentTime)))));
    if (near) return gridSnapAt(bm, near);
    if (!store.distanceLock || bm.editor.distanceSpacing <= 0) return gridSnapAt(bm, p);
    // v145: 参考件/期望距离收敛到 spacing.ts 共享纯函数 — 修复滑条结束时刻被当开始时刻
    // (原 (o.endTime ?? o.time): 滑条 endTime 字段恒 undefined, 长滑条参考时刻/间隔拍数全算错)
    const ref = distanceLockRef(bm, store.currentTime);
    if (!ref) return gridSnapAt(bm, p);
    const dist = distanceLockDistance(bm, ref.endTime, store.currentTime);
    const dx = p.x - ref.endX, dy = p.y - ref.endY;
    const d = Math.hypot(dx, dy);
    if (d < 1) return gridSnapAt(bm, { x: ref.endX + dist, y: ref.endY });
    // v163: 仅开启"限制物件在游玩区域内"时钳制到游玩区
    return gridSnapAt(bm, store.limitToPlayfield ? {
      x: Math.max(0, Math.min(PW, ref.endX + dx / d * dist)),
      y: Math.max(0, Math.min(PH, ref.endY + dy / d * dist)),
    } : { x: ref.endX + dx / d * dist, y: ref.endY + dy / d * dist });
  };

  if (!skinRef.current && typeof document !== 'undefined') skinRef.current = getSkin();

  // 节点编辑写回: 点列 (含头部) -> o.x/o.y/curvePoints/curveType (头部不可删, pts[0] 位置不变)
  const applySliderPoints = (o: HitObject, pts: { x: number; y: number }[]) => {
    o.x = pts[0].x; o.y = pts[0].y;
    o.curvePoints = pts.slice(1).map(p => ({ ...p }));
    o.curveType = resolveSliderCurveType(pts, o.curveType ?? 'L');
  };

  // 应用一次缩放拖拽 (lazer OsuSelectionScaleHandler.Update: 每次从 Begin 快照重算; modifier 实时生效)
  const applyScaleUpdate = (p: { x: number; y: number }, shift: boolean, alt: boolean) => {
    const bm = store.beatmap;
    const sd = scaleDragRef.current;
    if (!bm || !sd) return;
    const raw = dragToScale(sd.anchor, sd.quad.w, sd.quad.h, p.x - sd.startP.x, p.y - sd.startP.y, shift);
    if (Math.abs(raw.x - 1) > 1e-9 || Math.abs(raw.y - 1) > 1e-9) sd.moved = true;
    const origin = alt ? sd.defaultOrigin : anchorOpposite(sd.quad, sd.anchor);
    const r = applyScaleDrag(bm, selectedMovable(bm), sd.states, raw, origin, anchorAxis(sd.anchor), store.beatSnap, sd.quad);
    for (const id of r.sliders) invalidatePath(id);
  };

  // 应用一次旋转拖拽 (lazer OsuSelectionRotationHandler.Update: 累积角度 + Shift 吸附 15°, 从 Begin 快照重算)
  const applyRotateUpdate = (p: { x: number; y: number }, shift: boolean) => {
    const bm = store.beatmap;
    const rd = rotateDragRef.current;
    if (!bm || !rd) return;
    rd.rawAngle += angleDeltaDeg(rd.origin, rd.lastP, p);
    rd.lastP = p; rd.snap = shift;
    const deg = snapRotation(rd.rawAngle, shift);
    if (deg !== 0) rd.moved = true;
    const r = applyRotateDrag(selectedMovable(bm), rd.states, deg, rd.origin);
    for (const id of r.sliders) invalidatePath(id);
  };

  // v117: 节点选区缩放拖拽 (复用物件手柄几何: dragToScale/anchorOpposite/anchorAxis; 从 Begin 快照重算, 写回节点)
  const applyNodeScaleUpdate = (p: { x: number; y: number }, shift: boolean, alt: boolean) => {
    const bm = store.beatmap;
    const sd = nodeScaleDragRef.current;
    if (!bm || !sd) return;
    const raw = dragToScale(sd.anchor, sd.quad.w, sd.quad.h, p.x - sd.startP.x, p.y - sd.startP.y, shift);
    if (Math.abs(raw.x - 1) > 1e-9 || Math.abs(raw.y - 1) > 1e-9) sd.moved = true;
    const origin = alt ? sd.defaultOrigin : anchorOpposite(sd.quad, sd.anchor); // lazer: Alt = 默认原点
    const axis = anchorAxis(sd.anchor);
    const sc = { x: axis === 'y' ? 1 : raw.x, y: axis === 'x' ? 1 : raw.y };
    const ids = transformNodesFromSnapshot(bm, sd.orig, pt => scaledPosition(sc, origin, pt));
    for (const id of ids) {
      const o = bm.hitObjects.find(x => x.id === id);
      if (o) resnapSliderLength(bm, o, store.beatSnap);
      invalidatePath(id);
    }
  };

  // v117: 节点选区旋转拖拽 (累积角度 + Shift 吸附 15°, 从 Begin 快照重算)
  const applyNodeRotateUpdate = (p: { x: number; y: number }, shift: boolean) => {
    const bm = store.beatmap;
    const rd = nodeRotateDragRef.current;
    if (!bm || !rd) return;
    rd.rawAngle += angleDeltaDeg(rd.origin, rd.lastP, p);
    rd.lastP = p; rd.snap = shift;
    const deg = snapRotation(rd.rawAngle, shift);
    if (deg !== 0) rd.moved = true;
    const rad = deg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const ids = transformNodesFromSnapshot(bm, rd.orig, pt => ({
      x: rd.origin.x + (pt.x - rd.origin.x) * cos - (pt.y - rd.origin.y) * sin,
      y: rd.origin.y + (pt.x - rd.origin.x) * sin + (pt.y - rd.origin.y) * cos,
    }));
    for (const id of ids) {
      const o = bm.hitObjects.find(x => x.id === id);
      if (o) resnapSliderLength(bm, o, store.beatSnap);
      invalidatePath(id);
    }
  };

  // v50: 手柄对应的光标形状
  const handleCursor = (type: 'scale' | 'rotate', anchor: string, dragging: boolean): string => {
    if (type === 'rotate') return dragging ? 'grabbing' : 'grab';
    switch (anchor) {
      case 'cl': case 'cr': return 'ew-resize';
      case 'tc': case 'bc': return 'ns-resize';
      case 'tl': case 'br': return 'nwse-resize';
      default: return 'nesw-resize';
    }
  };

  // 更新光标与悬停手柄 (lazer: 旋转手柄平时隐藏, hover 对应角时淡入)
  const updateHandleHover = (p: { x: number; y: number } | null) => {
    const c = canvasRef.current;
    const bm = store.beatmap;
    if (!c) return;
    const sd = scaleDragRef.current, rd = rotateDragRef.current;
    if (sd) { c.style.cursor = handleCursor('scale', sd.anchor, true); return; }
    if (rd) { c.style.cursor = handleCursor('rotate', rd.corner, true); return; }
    let hover: { type: 'scale' | 'rotate'; anchor: string } | null = null;
    if (bm && p && store.tool === 'select') {
      const quads = currentQuads(bm);
      if (quads) {
        const tol = 10 / viewTransform(c.getBoundingClientRect()).scale;
        const rc = hitRotationHandle(quads.dq, p, tol);
        if (rc) hover = { type: 'rotate', anchor: rc };
        else {
          const sc = hitScaleHandle(quads.q, quads.dq, p, tol);
          if (sc) hover = { type: 'scale', anchor: sc };
          else {
            // lazer: hover 角缩放手柄附近也显示对应旋转手柄 (getCorrespondingRotationHandle)
            const nearCorner = (['tl', 'tr', 'bl', 'br'] as const).find(a => {
              const hp = anchorPoint(quads.dq, a);
              return Math.hypot(hp.x - p.x, hp.y - p.y) <= tol * 2;
            });
            if (nearCorner) hover = { type: 'rotate', anchor: nearCorner };
          }
        }
      }
    }
    hoverHandleRef.current = hover;
    c.style.cursor = hover ? handleCursor(hover.type, hover.anchor, false) : '';
  };

  const toOsu = useCallback((e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const { scale, ox, oy } = viewTransform(r);
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale };
  }, []);

  // 暴露给 CDP 测试: osu 坐标 -> client 坐标 / canvas 设备像素 (与渲染/命中共用同一变换, 含 PAD_Y 留白)
  useEffect(() => {
    const w = window as unknown as {
      __osuToClient?: (x: number, y: number) => { x: number; y: number } | null;
      __osuToCanvas?: (x: number, y: number) => { x: number; y: number } | null;
      __osuComboAt?: (id: number) => { combo: number; index: number } | null;
      __invalidatePath?: (id?: number) => void; // v99: 冷帧测量 (失效路径/body 缓存)
    };
    w.__osuToClient = (x, y) => {
      const c = canvasRef.current;
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const { scale, ox, oy } = viewTransform(r);
      return { x: r.left + ox + x * scale, y: r.top + oy + y * scale };
    };
    w.__osuToCanvas = (x, y) => {
      const c = canvasRef.current;
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const { scale, ox, oy } = viewTransform(r);
      return { x: (ox + x * scale) * (c.width / r.width), y: (oy + y * scale) * (c.height / r.height) };
    };
    w.__invalidatePath = (id) => invalidatePath(id);
    // v44: 与渲染同一 mergedWithPreview + computeCombos 管线, 供 CDP 断言预览 combo 数字/颜色
    w.__osuComboAt = (id) => {
      const bm = store.beatmap;
      if (!bm) return null;
      return computeCombos(mergedWithPreview(bm, store.conversionPreview)).get(id) ?? null;
    };
  }, []);

  // 拖拽在时间轴等画布外区域松开时, React onMouseUp 不会触发 — window 兜底清标志, 否则时间轴会一直不响应
  useEffect(() => {
    const finishHandleDrag = () => {
      // v50: 缩放/旋转拖拽收尾 (画布内 onMouseUp 已收尾时 ref 为 null, 这里 no-op)
      if (scaleDragRef.current) {
        if (scaleDragRef.current.moved) store.commitDrag(); else store.undo();
        scaleDragRef.current = null;
      }
      if (rotateDragRef.current) {
        if (rotateDragRef.current.moved) store.commitDrag(); else store.undo();
        rotateDragRef.current = null;
      }
      // v117: 节点层手柄拖拽收尾 (与物件层同款: 动过 commit, 没动弹出空快照)
      if (nodeScaleDragRef.current) {
        if (nodeScaleDragRef.current.moved) store.commitDrag(); else store.undo();
        nodeScaleDragRef.current = null;
      }
      if (nodeRotateDragRef.current) {
        if (nodeRotateDragRef.current.moved) store.commitDrag(); else store.undo();
        nodeRotateDragRef.current = null;
      }
      if (canvasRef.current) canvasRef.current.style.cursor = '';
    };
    const up = (e: MouseEvent) => {
      // v86: pattern 拖放收尾 — 分类标签上松开 = 移动分类; 直接在游玩区画布上松开 = 落盘 (首物件跟随鼠标+吸附,
      // 起点=当前时间吸附节拍); 其余 (面板/时间轴/窗外) = 取消。判定走 elementFromPoint, 与幻影预览 (cur.inside) 一致
      if (store.patternDrag) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const gl = el?.closest('[data-pattern-group]');
        if (gl) {
          store.movePattern(store.patternDrag.id, gl.getAttribute('data-pattern-group')!);
          store.cancelPatternDrag();
        } else {
          const p = toOsu(e);
          if (el === canvasRef.current && p.x >= 0 && p.x <= PW && p.y >= 0 && p.y <= PH) {
            store.dropPattern(snapPlacement(p) ?? p, snapTime(store.currentTime));
          } else store.cancelPatternDrag();
        }
        return;
      }
      store.canvasDragging = false; originDragRef.current = false; gridOriginDragRef.current = false; dupVectorDragRef.current = false; symPointDragRef.current = 0; finishHandleDrag();
      // v66: 画布外松开同样收尾手绘/候选 (否则残留状态会在下次经过画布时误续画)
      if (freehandRef.current) {
        const builder = freehandRef.current.builder;
        freehandRef.current = null; drawCandRef.current = null;
        builder.finish();
        finishFreehandSlider(builder);
      } else if (drawCandRef.current) {
        const c = drawCandRef.current; drawCandRef.current = null;
        // v74: 头部候选 = 头已在 mousedown 落好, 松开不加点不切红
        if (!c.isHead) {
          const head = store.pendingSlider[0];
          if (head && Math.hypot(c.x - head.x, c.y - head.y) < 8) head.redAnchor = !head.redAnchor;
          else {
            store.pendingSlider.push({ x: Math.round(c.sp.x), y: Math.round(c.sp.y), redAnchor: c.redAnchor });
          }
          store.emit();
        }
      }
    };
    // v50: 缩放/旋转拖拽移出画布仍跟随鼠标 (修复: 放大到一定程度光标出画布, 拖拽被 onMouseLeave 终止 = "卡住")
    const move = (e: MouseEvent) => {
      if (scaleDragRef.current) {
        const p = toOsu(e);
        const sd = scaleDragRef.current;
        sd.lastP = p; sd.shift = e.shiftKey; sd.alt = e.altKey;
        applyScaleUpdate(p, e.shiftKey, e.altKey);
      } else if (rotateDragRef.current) {
        applyRotateUpdate(toOsu(e), e.shiftKey);
      } else if (nodeScaleDragRef.current) {
        // v117: 节点层手柄拖拽出画布同样跟随鼠标
        const p = toOsu(e);
        const sd = nodeScaleDragRef.current;
        sd.lastP = p; sd.shift = e.shiftKey; sd.alt = e.altKey;
        applyNodeScaleUpdate(p, e.shiftKey, e.altKey);
      } else if (nodeRotateDragRef.current) {
        applyNodeRotateUpdate(toOsu(e), e.shiftKey);
      } else if (freehandRef.current && e.target !== canvasRef.current) {
        // v74: 手绘拖出画布 (如经过时间轴) 继续采样笔画, 不中断 (画布内由 onMouseMove 喂点, 避免重复)
        const head = store.pendingSlider[0];
        if (head) {
          const p = toOsu(e);
          const builder = freehandRef.current.builder;
          builder.addLinearPoint({ x: p.x - head.x, y: p.y - head.y });
          updateFreehandPreview(builder, head);
        }
      }
    };
    window.addEventListener('mouseup', up);
    window.addEventListener('mousemove', move);
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('mousemove', move); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v49/v50: 缩放/旋转拖拽中按下/松开 Shift (锁长宽比/吸附15°) / Alt (默认原点) 实时生效 (lazer OnKeyDown/OnKeyUp)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // v86: Esc 取消 pattern 拖拽
      if (e.type === 'keydown' && e.key === 'Escape' && store.patternDrag) { store.cancelPatternDrag(); return; }
      const sd = scaleDragRef.current;
      if (sd) {
        const shift = e.shiftKey, alt = e.altKey;
        if (shift === sd.shift && alt === sd.alt) return;
        sd.shift = shift; sd.alt = alt;
        applyScaleUpdate(sd.lastP, shift, alt);
        return;
      }
      const rd = rotateDragRef.current;
      if (rd && e.shiftKey !== rd.snap) applyRotateUpdate(rd.lastP, e.shiftKey);
      // v117: 节点层手柄拖拽中 Shift/Alt 实时生效 (与物件层同款)
      const nsd = nodeScaleDragRef.current;
      if (nsd) {
        const shift = e.shiftKey, alt = e.altKey;
        if (shift === nsd.shift && alt === nsd.alt) return;
        nsd.shift = shift; nsd.alt = alt;
        applyNodeScaleUpdate(nsd.lastP, shift, alt);
        return;
      }
      const nrd = nodeRotateDragRef.current;
      if (nrd && e.shiftKey !== nrd.snap) applyNodeRotateUpdate(nrd.lastP, e.shiftKey);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 渲染循环
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const c = canvasRef.current;
      const skin = skinRef.current;
      const bm = store.beatmap;
      store.tickClock(); // 暂停中也维持相位跟踪, 保证播放启动即 <1ms
      if (c && skin && bm) {
        if (store.playing) {
          store.currentTime = store.positionMs(); // WebAudio采样级时钟, offset < 1ms
          if (store.currentTime >= store.songLength()) store.pause();
        }
        const g = c.getContext('2d')!;
        const dpr = window.devicePixelRatio || 1;
        const r = c.getBoundingClientRect();
        if (c.width !== r.width * dpr) { c.width = r.width * dpr; c.height = r.height * dpr; }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#111116';
        g.fillRect(0, 0, r.width, r.height);
        const { scale, ox, oy } = viewTransform(r);
        g.save();
        g.translate(ox, oy); g.scale(scale, scale);
        // v56: 位置网格 (lazer PositionSnapGrid, 始终显示; 线 alpha 0.1, 过原点首线 0.2; 圆形首圆 0.8)
        // v119: gridType 'none' = 无网格, 不渲染 (贴近游玩表现)
        {
          const gs = store.gridSpacing ?? bm.editor.gridSize;
          if (gs > 0 && store.gridType !== 'none') {
            g.save();
            g.beginPath(); g.rect(0, 0, PW, PH); g.clip();
            g.strokeStyle = 'rgb(255,255,255)'; // 亮度走 globalAlpha (lazer: 线 0.1, 过原点首线 0.2, 圆 0.2 首圆 0.8)
            g.lineWidth = 1 / scale;
            const O = store.currentGridOrigin(); // v78: 网格线过自定义中心 (吸附与渲染同一原点)
            if (store.gridType === 'circle') {
              const maxD = Math.hypot(Math.max(O.x, PW - O.x), Math.max(O.y, PH - O.y));
              const n = Math.floor(maxD / gs) + 1;
              for (let i = 0; i <= n; i++) {
                g.globalAlpha = i === 0 ? 0.8 : 0.2;
                g.beginPath(); g.arc(O.x, O.y, Math.max(1.5 / scale, i * gs), 0, Math.PI * 2); g.stroke();
              }
              g.globalAlpha = 1;
            } else {
              const fams = store.gridType === 'square'
                ? { normals: squareNormals(store.gridRotation), lineSpacing: gs }
                : triangleGrid(gs, store.gridRotation);
              const maxD = Math.hypot(PW, PH);
              const K = Math.ceil(maxD / fams.lineSpacing) + 1;
              for (const nv of fams.normals) {
                for (let k = -K; k <= K; k++) {
                  const cx = O.x + nv.x * fams.lineSpacing * k, cy = O.y + nv.y * fams.lineSpacing * k;
                  g.globalAlpha = k === 0 ? 0.2 : 0.1; // lazer: 过原点首线更亮
                  g.beginPath();
                  g.moveTo(cx + nv.y * maxD, cy - nv.x * maxD);
                  g.lineTo(cx - nv.y * maxD, cy + nv.x * maxD);
                  g.stroke();
                }
              }
              g.globalAlpha = 1;
            }
            g.restore();
          }
        }
        // 谱面背景图 (压暗显示, cover 适配游玩区)
        // v168: 亮度 = 显示设置 bgBrightness (默认 35 = 旧固定 0.35, 表现不变)
        const bg = store.backgroundImg;
        if (bg) {
          const s = Math.max(PW / bg.width, PH / bg.height);
          const bw = bg.width * s, bh = bg.height * s;
          g.save();
          g.beginPath(); g.rect(0, 0, PW, PH); g.clip();
          g.globalAlpha = displaySettings.bgBrightness / 100;
          g.drawImage(bg, (PW - bw) / 2, (PH - bh) / 2, bw, bh);
          g.globalAlpha = 1;
          g.fillStyle = 'rgba(10,10,16,0.45)';
          g.fillRect(0, 0, PW, PH);
          g.restore();
        }
        // 游玩区边框
        g.strokeStyle = 'rgba(255,255,255,0.08)';
        g.strokeRect(0, 0, PW, PH);
        // 放置预览 (幽灵 note): 单点/转盘/滑条工具下实时显示
        const cur = cursorRef.current;
        // 转换预览 (F1-F4): v44 合并视图单趟渲染 — 源物件隐藏, 预览物件按时间并入,
        // combo 数字/颜色按合并后列表计算 (与转换应用后一致); 预览物件按选中渲染 (v40)
        const convPrev = store.conversionPreview;
        let bmView = mergedWithPreview(bm, convPrev);
        // v86: pattern 拖拽幻影 — 首物件跟随鼠标 (吸附与放置同源), 起点时间 = 当前时间吸附节拍, WYSIWYG (含对齐选项)
        if (store.patternDrag && cur.inside) {
          const sp = snapPlacement({ x: cur.x, y: cur.y }) ?? { x: cur.x, y: cur.y };
          const ghost = instantiatePattern(store.patternDrag, bm, sp, snapTime(store.currentTime),
            { greenlineAlign: store.patternAlign === 'greenline', scaleAlign: store.patternAlign === 'scale' });
          bmView = mergedWithPreview(bmView, { hideIds: [], objects: ghost.objects, timingPoints: ghost.greenlines });
        }
        const selView = convPrev && convPrev.objects.length
          ? new Set([...store.selected, ...convPrev.objects.map(o => o.id)])
          : store.selected;
        const __pt0 = performance.now(); // v99: 渲染性能采样 (CDP 读 window.__perfRender)
        renderPlayfield({
          g, bm: bmView, skin, time: store.currentTime,
          selected: selView, comboInfo: computeCombos(bmView), stackOffsets: getStackOffsets(bm),
        }, store.pendingSlider,
          // v207: 已有控制点时预览幻影用吸附后的 pendingCursor (onMouseMove 里与落点同公式), 否则原始光标 (头部幽灵)
          cur.inside && store.tool === 'slider' && !store.playing
            ? (store.pendingSlider.length > 0 ? store.pendingCursor : { x: cur.x, y: cur.y })
            : null);
        // v180: 转盘放置预览 (lazer SpinnerPiece alpha 0.5) — 终点实时跟随当前时间 (滚轮/播放均可拉长)
        if (store.pendingSpinner !== null) {
          drawPendingSpinner({ g, bm, skin, time: store.currentTime, selected: selView, comboInfo: new Map(), stackOffsets: getStackOffsets(bm) },
            store.pendingSpinner,
            spinnerPlacementEnd(bm.timingPoints, store.pendingSpinner, store.currentTime, store.beatSnap), arToPreempt(bm.difficulty.ar));
        }
        {
          const w = window as unknown as { __perfRender?: number[] };
          const pf = (w.__perfRender ??= []);
          pf.push(performance.now() - __pt0);
          if (pf.length > 900) pf.splice(0, pf.length - 900);
        }
        // 框选矩形
        const mq = marqueeRef.current;
        if (mq) {
          const rx = Math.min(mq.x0, mq.x1), ry = Math.min(mq.y0, mq.y1);
          const rw = Math.abs(mq.x1 - mq.x0), rh = Math.abs(mq.y1 - mq.y0);
          g.fillStyle = 'rgba(77,243,255,0.08)';
          g.strokeStyle = 'rgba(77,243,255,0.9)';
          g.lineWidth = 1.5;
          g.setLineDash([5, 4]);
          g.fillRect(rx, ry, rw, rh);
          g.strokeRect(rx, ry, rw, rh);
          g.setLineDash([]);
        }
        // v117: 节点框选矩形 (黄色系, 与物件框选的青色区分)
        const nmq = nodeMarqueeRef.current;
        if (nmq) {
          const rx = Math.min(nmq.x0, nmq.x1), ry = Math.min(nmq.y0, nmq.y1);
          const rw = Math.abs(nmq.x1 - nmq.x0), rh = Math.abs(nmq.y1 - nmq.y0);
          g.fillStyle = 'rgba(242,181,68,0.08)';
          g.strokeStyle = 'rgba(242,181,68,0.9)';
          g.lineWidth = 1.5;
          g.setLineDash([5, 4]);
          g.fillRect(rx, ry, rw, rh);
          g.strokeRect(rx, ry, rw, rh);
          g.setLineDash([]);
        }
        // v49: 选中框 (lazer SelectionBox): 黄色边框包住选区 (含物件半径外扩) + 边/角缩放手柄
        if (store.tool === 'select' && store.selected.size > 0) {
          const quads = currentQuads(bm);
          if (quads) {
            const { q, dq } = quads;
            const px = 1 / scale; // 屏幕恒定尺寸换算 (lazer: BORDER_RADIUS=3, 手柄 10x10 屏幕 px)
            g.save();
            g.strokeStyle = '#f2b544'; // lazer colours.YellowDark
            g.lineWidth = 3 * px;
            g.strokeRect(dq.x, dq.y, dq.w, dq.h);
            g.fillStyle = '#f2b544';
            g.strokeStyle = '#1a1a20';
            g.lineWidth = 1 * px;
            for (const a of scaleHandleAnchors(q)) {
              const hp = anchorPoint(dq, a);
              const s = 10 * px;
              g.fillRect(hp.x - s / 2, hp.y - s / 2, s, s);
              g.strokeRect(hp.x - s / 2, hp.y - s / 2, s, s);
            }
            g.restore();
            // v50: 四角外侧旋转手柄 (lazer: 平时隐藏, hover 对应角/拖拽时淡入; Size=15 圆 + redo 箭头)
            // v54: 尺寸对齐 lazer SelectionBoxControl.UpdateHoverState — hover/按住时 ScaleTo(1.5),
            //      手柄只在 hover/拖拽时显示, 故显示即 15*1.5=22.5px (屏幕恒定)
            const rd = rotateDragRef.current;
            const hover = hoverHandleRef.current;
            for (const h of rotationHandlePoints(dq)) {
              const active = rd?.corner === h.corner;
              const shown = active || (hover?.type === 'rotate' && hover.anchor === h.corner);
              if (!shown) continue;
              const s = 15 * 1.5 * px; // lazer: Size=15, hover/held ScaleTo(1.5)
              g.save();
              g.globalAlpha = active ? 1 : 0.9;
              g.fillStyle = '#f2b544';
              g.beginPath(); g.arc(h.x, h.y, s / 2, 0, Math.PI * 2); g.fill();
              // redo 弧形箭头 (lazer FontAwesome Redo, 按角翻转: x0 -> X+, y0 -> Y+)
              const fx = h.corner.includes('l') ? 1 : -1, fy = h.corner[0] === 't' ? 1 : -1;
              g.translate(h.x, h.y); g.scale(fx, fy);
              g.strokeStyle = '#1a1a20';
              g.lineWidth = 1.6 * px;
              const rr = s * 0.26;
              g.beginPath(); g.arc(0, 0, rr, -Math.PI * 0.7, Math.PI * 0.55); g.stroke();
              g.fillStyle = '#1a1a20';
              const ax = rr * Math.cos(Math.PI * 0.55), ay = rr * Math.sin(Math.PI * 0.55);
              g.beginPath();
              g.moveTo(ax + 4.5 * px, ay - 1.5 * px); g.lineTo(ax - 1 * px, ay + 1 * px); g.lineTo(ax + 1 * px, ay - 5 * px);
              g.closePath(); g.fill();
              g.restore();
            }
          }
        }
        // v117: 选中节点高亮 (黄环, 屏幕恒定半径; 含堆叠偏移, 与 drawSelectionDecor 控制点同源)
        if (store.nodeSelectionCount) {
          const offs = getStackOffsets(bm);
          const rr = 10 / scale; // ~10 屏幕 px 换算 osu px
          g.save();
          g.strokeStyle = '#f2b544';
          g.lineWidth = 2 / scale;
          for (const [objId, idxs] of store.selectedNodes) {
            const o = bm.hitObjects.find(x => x.id === objId);
            if (!o || o.type !== 'slider') continue;
            const ctrl = ctrlPoints(o, offs.get(objId));
            for (const idx of idxs) {
              const pt = ctrl[idx];
              if (!pt) continue;
              g.beginPath(); g.arc(pt.x, pt.y, rr, 0, Math.PI * 2); g.stroke();
            }
          }
          g.restore();
        }
        // v34: 自定义变换原点标记 (十字 + 圆, 可拖拽; osu 坐标系, 允许画出游玩区外)
        if (originMarkerVisible()) {
          const m = activeCustomOrigin(); // v166: 批量复制窗口打开时画弹窗独立原点
          g.save();
          g.strokeStyle = '#ffaa00';
          g.fillStyle = '#ffaa00';
          g.lineWidth = 2;
          g.beginPath(); g.arc(m.x, m.y, 8, 0, Math.PI * 2); g.stroke();
          g.beginPath();
          g.moveTo(m.x - 14, m.y); g.lineTo(m.x - 4, m.y);
          g.moveTo(m.x + 4, m.y); g.lineTo(m.x + 14, m.y);
          g.moveTo(m.x, m.y - 14); g.lineTo(m.x, m.y - 4);
          g.moveTo(m.x, m.y + 4); g.lineTo(m.x, m.y + 14);
          g.stroke();
          g.beginPath(); g.arc(m.x, m.y, 2.5, 0, Math.PI * 2); g.fill();
          g.restore();
        }
        // v210: 对称轴预览 (对称窗口打开即显示虚线; 自定义模式加两个可拖拽端点标记)
        if (store.transformDialog === 'symmetry') {
          const line = store.symAxisLine();
          if (line) {
            const { p1, p2 } = line;
            const dx = p2.x - p1.x, dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy) || 1;
            const ext = 1200; // 延长覆盖整个游玩区 (含区外)
            g.save();
            g.strokeStyle = '#c586ff';
            g.fillStyle = '#c586ff';
            g.lineWidth = 1.5;
            g.setLineDash([8, 6]);
            g.beginPath();
            g.moveTo(p1.x - (dx / len) * ext, p1.y - (dy / len) * ext);
            g.lineTo(p2.x + (dx / len) * ext, p2.y + (dy / len) * ext);
            g.stroke();
            g.setLineDash([]);
            if (store.symAxisMode === 'custom') {
              for (const m of [store.symP1, store.symP2]) {
                g.lineWidth = 2;
                g.beginPath(); g.arc(m.x, m.y, 7, 0, Math.PI * 2); g.stroke();
                g.beginPath(); g.arc(m.x, m.y, 2.5, 0, Math.PI * 2); g.fill();
              }
            }
            g.restore();
          }
        }
        // v78: 自定义网格中心标记 (青色十字 + 方框, 可拖拽; 网格开启自定义中心时显示, 与工具无关)
        // v119: 无网格时不显示/不可拖 (网格已关, 中心无意义)
        if (store.gridOriginCustom && store.gridType !== 'none') {
          const m = store.gridOrigin;
          g.save();
          g.strokeStyle = '#4df3ff';
          g.fillStyle = '#4df3ff';
          g.lineWidth = 2;
          g.beginPath(); g.rect(m.x - 7, m.y - 7, 14, 14); g.stroke();
          g.beginPath();
          g.moveTo(m.x - 14, m.y); g.lineTo(m.x - 4, m.y);
          g.moveTo(m.x + 4, m.y); g.lineTo(m.x + 14, m.y);
          g.moveTo(m.x, m.y - 14); g.lineTo(m.x, m.y - 4);
          g.moveTo(m.x, m.y + 4); g.lineTo(m.x, m.y + 14);
          g.stroke();
          g.beginPath(); g.arc(m.x, m.y, 2.5, 0, Math.PI * 2); g.fill();
          g.restore();
        }
        // v84: 几何辅助 (Mapping Tools Geometry Dashboard 三种); v88: 来源 = geoScope (all 可见所有 / selection 选中+上次选中)
        // 直线延伸线 = 红色虚线 (裁剪到游玩区外扩 1000px 框); 三点圆 = 红色虚线整圆; 圆心 = 青色圆环+实心点
        if (store.geoLines || store.geoCircle || store.geoCenter) {
          for (const o of geoSourceSliders(bm)) {
            g.save();
            if (store.geoLines) {
              g.strokeStyle = 'rgba(255,60,60,0.85)';
              g.lineWidth = 1.5;
              g.setLineDash([8, 6]);
              for (const l of sliderHelperLines(o)) {
                const seg = clipLineToBox(l, GEO_CLIP_BOX.left, GEO_CLIP_BOX.top, GEO_CLIP_BOX.right, GEO_CLIP_BOX.bottom);
                if (!seg) continue;
                g.beginPath(); g.moveTo(seg.x1, seg.y1); g.lineTo(seg.x2, seg.y2); g.stroke();
              }
              g.setLineDash([]);
            }
            const circ = sliderHelperCircle(o);
            if (circ) {
              if (store.geoCircle) {
                g.strokeStyle = 'rgba(255,60,60,0.85)';
                g.lineWidth = 1.5;
                g.setLineDash([8, 6]);
                g.beginPath(); g.arc(circ.cx, circ.cy, circ.r, 0, Math.PI * 2); g.stroke();
                g.setLineDash([]);
              }
              if (store.geoCenter) {
                g.strokeStyle = '#4df3ff';
                g.lineWidth = 1.5;
                g.beginPath(); g.arc(circ.cx, circ.cy, 4, 0, Math.PI * 2); g.stroke();
                g.fillStyle = '#4df3ff';
                g.beginPath(); g.arc(circ.cx, circ.cy, 1.5, 0, Math.PI * 2); g.fill();
              }
            }
            g.restore();
          }
        }
        // v126: 视觉间距辅助线 — 物件边缘外扩 geoDistValue px 的等距轮廓 (金色, 与红色几何辅助/黄色框选区分);
        // 单点 = 虚线圆环 (半径 = 物件半径 + 间距); v133: 滑条改描边环带法 (drawDistanceGuideRing: 粗描边圆角
        // join/cap = 路径与圆盘的 Minkowski 和, 再镂空出环带) — 直线/贝塞尔/完美圆弧/急弯滑条都是精确等距轮廓,
        // 内弯自动裁剪、端帽自动半圆, 取代 v126 折线 miter 偏移 (内弯尖刺/回折不准); v133: 轮廓随堆叠偏移平移
        // (对齐物件显示位置); 显示范围与几何辅助共用 geoScope/总开关 (v90 工具栏「辅助线」按钮);
        // v134/v139: 支持吸附 — 放置/拖拽时参考点 (物件中心) 直接吸到可见环带线 (distGuideSnap, 目标 = distR)
        if (store.geoDist && store.geoEnabled) {
          const distR = csToRadius(bm.difficulty.cs) + store.geoDistValue;
          const offs = getStackOffsets(bm); // v133: 辅助线对齐堆叠后显示位置
          for (const o of geoDistSources(store.geoScope, bm.hitObjects, store.selected, store.prevGeoIds, oo => isVisibleAt(bm, oo, store.currentTime))) {
            const so = offs.get(o.id);
            const dx = so?.dx ?? 0, dy = so?.dy ?? 0;
            if (o.type === 'circle') {
              g.save();
              g.strokeStyle = 'rgba(242,181,68,0.8)';
              g.lineWidth = 1.5;
              g.setLineDash([6, 5]);
              g.beginPath(); g.arc(o.x + dx, o.y + dy, distR, 0, Math.PI * 2); g.stroke();
              g.restore();
            } else {
              const pts = getSliderPath(bm, o).points;
              g.save();
              g.translate(dx, dy); // v133: 环带随堆叠偏移 (drawDistanceGuideRing 取 g 当前变换)
              drawDistanceGuideRing(g, pts, distR, 1.5, 'rgba(242,181,68,0.8)');
              g.restore();
            }
          }
        }
        // v68: 批量复制向量箭头 — 尾 = 第一批(源)物件结尾, 头 = 尾 + 每份向量 (头可拖拽)
        const dv = store.dupVectorView;
        if (dv && store.conversionDialog === 'duplicate') {
          const hx = dv.anchor.x + dv.dx, hy = dv.anchor.y + dv.dy;
          g.save();
          g.strokeStyle = '#4dd8ff';
          g.fillStyle = '#4dd8ff';
          g.lineWidth = 2.5;
          g.beginPath(); g.moveTo(dv.anchor.x, dv.anchor.y); g.lineTo(hx, hy); g.stroke();
          // 箭头翼
          const ang = Math.atan2(hy - dv.anchor.y, hx - dv.anchor.x);
          g.beginPath();
          g.moveTo(hx, hy);
          g.lineTo(hx - 12 * Math.cos(ang - 0.42), hy - 12 * Math.sin(ang - 0.42));
          g.moveTo(hx, hy);
          g.lineTo(hx - 12 * Math.cos(ang + 0.42), hy - 12 * Math.sin(ang + 0.42));
          g.stroke();
          // 尾部锚点 + 头部拖拽手柄
          g.beginPath(); g.arc(dv.anchor.x, dv.anchor.y, 4, 0, Math.PI * 2); g.fill();
          g.beginPath(); g.arc(hx, hy, 7, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#0d0d12'; g.lineWidth = 2;
          g.beginPath(); g.arc(hx, hy, 7, 0, Math.PI * 2); g.stroke();
          g.restore();
        }
        if (cur.inside && store.tool !== 'select' && !store.playing) {
          const r0 = csToRadius(bm.difficulty.cs);
          const sp = snapPlacement(cur);
          g.save();
          g.globalAlpha = 0.45;
          if (store.tool === 'circle') {
            // v150: 放置预览同按贴图固有尺寸 (与 drawCircle 一致)
            const s1 = r0 * 2 * hitcircleSpriteWidth(skin.hitcircle) / 128;
            const s2 = r0 * 2 * hitcircleSpriteWidth(skin.hitcircleoverlay) / 128;
            g.drawImage(skin.hitcircle, sp.x - s1 / 2, sp.y - s1 / 2, s1, s1);
            g.drawImage(skin.hitcircleoverlay, sp.x - s2 / 2, sp.y - s2 / 2, s2, s2);
          } else if (store.tool === 'spinner') {
            g.drawImage(skin.spinnerCircle, 256 - 170, 192 - 170, 340, 340);
          } else if (store.tool === 'slider' && store.pendingSlider.length === 0) {
            // 无锚点时预览起点 (有锚点后的路径预览由 drawPendingSlider 负责)
            const s1 = r0 * 2 * hitcircleSpriteWidth(skin.hitcircle) / 128;
            const s2 = r0 * 2 * hitcircleSpriteWidth(skin.hitcircleoverlay) / 128;
            g.drawImage(skin.hitcircle, sp.x - s1 / 2, sp.y - s1 / 2, s1, s1);
            g.drawImage(skin.hitcircleoverlay, sp.x - s2 / 2, sp.y - s2 / 2, s2, s2);
          }
          // 锁定间距指示: 画到上一个物件的距离圈
          if (store.distanceLock && bm.editor.distanceSpacing > 0 && store.tool !== 'spinner') {
            // v145: 从参考件结束位置画线 (滑条尾端, 与 snapPlacement 同源; 原 prev.x/prev.y 是滑条头)
            const ref = distanceLockRef(bm, store.currentTime);
            if (ref) {
              g.strokeStyle = 'rgba(77,243,255,0.35)';
              g.setLineDash([4, 4]);
              g.beginPath(); g.moveTo(ref.endX, ref.endY); g.lineTo(sp.x, sp.y); g.stroke();
              g.setLineDash([]);
            }
          }
          g.restore();
        }
        g.restore();
        // v117: 选中滑条时在游玩区下边缘提示节点多选高级用法 (屏幕坐标; 节点层激活时隐藏)
        if (store.tool === 'select' && !store.playing && !store.nodeSelectionCount
          && bm.hitObjects.some(o => store.selected.has(o.id) && o.type === 'slider')) {
          g.save();
          g.font = '11px sans-serif';
          g.textAlign = 'center';
          g.fillStyle = 'rgba(242,181,68,0.75)';
          g.fillText('滑条节点控制：Alt+点选/框选, Shift+Alt多选，按住Alt时可整体拖动 · 旋转 · 缩放 (Esc 退出)', r.width / 2, oy + PH * scale + 18);
          g.restore();
        }
        if (store.playing) store.emitPlayback(); // 播放中只刷 UI, 不使 hitsound 事件表失效
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // v35: 控制点手柄命中 — 多个手柄在鼠标下时取最近者; 距离相同取序号在前 (与渲染顺序一致: 序号在前者在更上层)
  const nearestCtrlPoint = (ctrl: { x: number; y: number }[], odx: number, ody: number, p: { x: number; y: number }, maxDist = 10): number => {
    let best = -1, bestD = maxDist;
    for (let i = 0; i < ctrl.length; i++) {
      const d = Math.hypot(ctrl[i].x + odx - p.x, ctrl[i].y + ody - p.y);
      if (d <= maxDist && (best < 0 || d < bestD)) { best = i; bestD = d; }
    }
    return best;
  };

  const hitTest = (px: number, py: number): HitObject | null => {
    const bm = store.beatmap!;
    const r = csToRadius(bm.difficulty.cs);
    const offs = getStackOffsets(bm); // 命中测试用堆叠后显示位置
    // 可见即可选: 命中窗口与渲染窗口完全一致 (含淡入/淡出期; 修复滑条开始 600ms 后
    // 仍在屏却点不中、以及 AR>5 时 preempt<1200 导致不可见物件可被误选的问题)
    const objs = bm.hitObjects.filter(o => isVisibleAt(bm, o, store.currentTime));
    // v154: 收集全部命中, 重叠时优先选离当前时间最近者 (旧逻辑倒序取首个 = 恒选最晚上层物件)
    const hits: HitObject[] = [];
    for (const o of objs) {
      const off = offs.get(o.id);
      const dx = off?.dx ?? 0, dy = off?.dy ?? 0;
      if (o.type === 'slider') {
        const p = getSliderPath(bm, o);
        for (const pt of p.points) {
          if (Math.hypot(pt.x + dx - px, pt.y + dy - py) <= r) { hits.push(o); break; }
        }
      } else if (o.type === 'spinner') {
        if (Math.hypot(256 - px, 192 - py) <= 170) hits.push(o);
      } else if (Math.hypot(o.x + dx - px, o.y + dy - py) <= r * 1.1) hits.push(o);
    }
    // v171: 命中中含已选中物件时优先返回已选中者 — 拖动/右键已选物件不被重叠的未选中物件抢走;
    //       多个已选物件重叠时仍在已选子集里挑离当前时间最近者
    const selHits = hits.filter(o => store.selected.has(o.id));
    return pickTimeNearestHit(selHits.length ? selHits : hits, store.currentTime);
  };

  const snapTime = (t: number): number => {
    const bm = store.beatmap!;
    const { red } = timingAt(bm.timingPoints, t);
    const div = red.beatLength / store.beatSnap;
    return red.time + Math.round((t - red.time) / div) * div;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const bm = store.beatmap;
    if (!bm) return;
    const p = toOsu(e);
    if (e.button === 2) return; // 右键在 contextmenu 处理
    // v78: 自定义网格中心标记命中最优先 (全工具可拖, 与自定义原点标记同款半径; 只改网格原点, 不进 undo)
    if (store.gridOriginCustom && store.gridType !== 'none' && Math.hypot(store.gridOrigin.x - p.x, store.gridOrigin.y - p.y) <= 12) { // v119: 无网格时标记不可拖
      gridOriginDragRef.current = true;
      store.canvasDragging = true;
      return;
    }
    if (store.tool === 'select') {
      // v210: 自定义对称轴端点命中优先 — 拖动只改对称轴, 不动物件, 不进 undo
      if (store.transformDialog === 'symmetry' && store.symAxisMode === 'custom') {
        const hit = ([store.symP1, store.symP2] as Pt[]).findIndex(m => Math.hypot(m.x - p.x, m.y - p.y) <= 12);
        if (hit >= 0) {
          symPointDragRef.current = (hit + 1) as 1 | 2;
          store.canvasDragging = true;
          return;
        }
      }
      // v68: 批量复制向量箭头头命中优先 — 拖动箭头头改每份向量 (回写弹窗参数)
      const dv0 = store.dupVectorView;
      if (dv0 && store.conversionDialog === 'duplicate'
        && Math.hypot(dv0.anchor.x + dv0.dx - p.x, dv0.anchor.y + dv0.dy - p.y) <= 10) {
        dupVectorDragRef.current = true;
        store.canvasDragging = true;
        return;
      }
      // v34: 自定义原点标记命中优先 — 拖动标记只改原点, 不动物件, 不进 undo
      if (originMarkerVisible() && Math.hypot(activeCustomOrigin().x - p.x, activeCustomOrigin().y - p.y) <= 12) {
        originDragRef.current = true;
        store.canvasDragging = true;
        return;
      }
      // v50: 选中框旋转手柄命中 (四角外侧, lazer SelectionBoxRotationHandle; 优先于缩放手柄)
      const quads0 = currentQuads(bm);
      if (quads0 && !store.lockNotes) { // v115: 锁定物件 — 旋转手柄禁用
        const c = canvasRef.current!;
        const tol = 10 / viewTransform(c.getBoundingClientRect()).scale;
        const corner = hitRotationHandle(quads0.dq, p, tol);
        if (corner) {
          // v117: 节点选区非空时手柄作用于选中节点 (快照 = 节点坐标, 原点 = 节点集 MEC 圆心)
          if (store.nodeSelectionCount) {
            const orig = snapshotNodes(bm, withRedPartners(bm, store.selectedNodes));
            const pts: Pt[] = [];
            for (const m of orig.values()) pts.push(...m.values());
            store.beginDrag(); // 一次拖拽一次 undo
            store.canvasDragging = true;
            nodeRotateDragRef.current = {
              corner, orig,
              origin: minimumEnclosingCircleCenter(pts),
              lastP: p, rawAngle: 0, snap: e.shiftKey, moved: false,
            };
            c.style.cursor = 'grabbing';
            return;
          }
          const objs = selectedMovable(bm);
          store.beginDrag(); // 一次拖拽一次 undo (lazer Begin/Commit)
          store.canvasDragging = true;
          rotateDragRef.current = {
            corner, states: snapshotScaleStates(objs),
            origin: rotationOrigin(objs), // lazer: DefaultOrigin = 物件位置 MEC 圆心
            lastP: p, rawAngle: 0, snap: e.shiftKey, moved: false,
          };
          c.style.cursor = 'grabbing';
          return;
        }
      }
      // v49: 选中框缩放手柄命中 (lazer SelectionBoxScaleHandle; 优先于节点编辑与物件命中)
      const quads = quads0;
      if (quads && !store.lockNotes && scaleHandleAnchors(quads.q).length) { // v115: 锁定物件 — 缩放手柄禁用
        const c = canvasRef.current!;
        const tol = 8 / viewTransform(c.getBoundingClientRect()).scale; // 8 屏幕 px 换算 osu px
        const anchor = hitScaleHandle(quads.q, quads.dq, p, tol);
        if (anchor) {
          // v117: 节点选区非空时手柄作用于选中节点 (快照 = 节点坐标, Alt 原点 = 节点集 MEC 圆心)
          if (store.nodeSelectionCount) {
            const orig = snapshotNodes(bm, withRedPartners(bm, store.selectedNodes));
            const pts: Pt[] = [];
            for (const m of orig.values()) pts.push(...m.values());
            store.beginDrag(); // 一次拖拽一次 undo
            store.canvasDragging = true;
            nodeScaleDragRef.current = {
              anchor, quad: quads.q, startP: p, lastP: p,
              orig,
              defaultOrigin: minimumEnclosingCircleCenter(pts),
              shift: e.shiftKey, alt: e.altKey, moved: false,
            };
            c.style.cursor = handleCursor('scale', anchor, true);
            return;
          }
          const objs = selectedMovable(bm);
          store.beginDrag(); // 一次拖拽一次 undo (lazer Begin/Commit = BeginChange/EndChange)
          store.canvasDragging = true;
          scaleDragRef.current = {
            anchor, quad: quads.q, startP: p, lastP: p,
            states: snapshotScaleStates(objs),
            defaultOrigin: minimumEnclosingCircleCenter(movablePoints(objs)), // lazer: 凸包最小包围圆圆心
            shift: e.shiftKey, alt: e.altKey, moved: false,
          };
          c.style.cursor = handleCursor('scale', anchor, true);
          return;
        }
      }
      // v117: Alt 层 — 节点多选 (点选/加选/框选 + 整体拖动); 物件层行为不受影响
      if (e.altKey && !store.lockNotes) { // v115: 锁定物件 — 节点选/拖禁用
        const offs = getStackOffsets(bm);
        const sliders = bm.hitObjects.filter(o => o.type === 'slider' && isVisibleAt(bm, o, store.currentTime));
        const hitNode = nearestNode(sliders, offs, p); // 跨滑条最近优先, 并列取序号在前
        if (hitNode) {
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            store.toggleSelectedNode(hitNode.objId, hitNode.idx); // 加选/取消单个节点
          } else {
            const cur = store.selectedNodes.get(hitNode.objId);
            if (!cur?.has(hitNode.idx)) store.setSelectedNodes([[hitNode.objId, hitNode.idx]]); // 未选中才重置 (保留拖动多选)
          }
          store.beginDrag();
          store.canvasDragging = true;
          nodesMoveDragRef.current = {
            anchor: hitNode, startX: p.x, startY: p.y,
            orig: snapshotNodes(bm, withRedPartners(bm, store.selectedNodes)), moved: false,
          };
          return;
        }
        // Alt+空白: 节点框选 (Shift/Ctrl 在现有节点选区上追加)
        nodeMarqueeRef.current = {
          x0: p.x, y0: p.y, x1: p.x, y1: p.y,
          base: (e.shiftKey || e.ctrlKey || e.metaKey) ? nodeEntries(store.selectedNodes) : [],
        };
        store.canvasDragging = true;
        return;
      }
      // 优先检测选中滑条的控制点手柄(节点编辑); v115: 锁定物件 — 节点拖拽/插点禁用
      const selObjs = bm.hitObjects.filter(o => store.selected.has(o.id));
      if (!store.lockNotes && selObjs.length === 1 && selObjs[0].type === 'slider') {
        const so = selObjs[0];
        const soff = getStackOffsets(bm).get(so.id); // 手柄随堆叠偏移绘制, 命中同样偏移
        const odx = soff?.dx ?? 0, ody = soff?.dy ?? 0;
        const ctrl = [{ x: so.x, y: so.y }, ...(so.curvePoints ?? [])];
        const hitIdx = nearestCtrlPoint(ctrl, odx, ody, p); // v35: 最近优先, 并列取序号在前
        if (hitIdx >= 0) {
          store.beginDrag();
          store.canvasDragging = true;
          // 红锚点记录配对下标: 拖拽时成对移动 (v29: 不再把红点拆成两个白点)
          // v118: toggleRed = 按下时 Ctrl — stable 行为: 按住 Ctrl 点击白点才转红, 直接点击仅选中
          nodeDragRef.current = { objId: so.id, pointIndex: hitIdx, pairWith: redPairPartner(ctrl, hitIdx), startX: p.x, startY: p.y, moved: false, toggleRed: e.ctrlKey || e.metaKey };
          return;
        }
        // v118: 按住 Ctrl 点击线段才在该线段最近点插入新白色节点 (stable 行为; 红锚点零长线段跳过; 不按 Ctrl 落到物件命中)
        if (e.ctrlKey || e.metaKey) {
          let best = -1, bestT = 0, bestD = 6;
          for (let i = 0; i < ctrl.length - 1; i++) {
            if (ctrl[i].x === ctrl[i + 1].x && ctrl[i].y === ctrl[i + 1].y) continue;
            const a = { x: ctrl[i].x + odx, y: ctrl[i].y + ody }, b = { x: ctrl[i + 1].x + odx, y: ctrl[i + 1].y + ody };
            const n = nearestOnSegment(a, b, p);
            if (n.dist < bestD) { bestD = n.dist; best = i; bestT = n.t; }
          }
          if (best >= 0) {
            store.pushUndo(); // 一次操作一次 undo; emit 顺带 bump dataVersion (长度可能变, tick 事件重建)
            applySliderPoints(so, insertSliderPoint(ctrl, best, bestT));
            resnapSliderLength(bm, so, store.beatSnap); // lazer: 插入控制点后 SnapTo (长度按新几何吸附节拍)
            invalidatePath(so.id);
            store.emit();
            return;
          }
        }
      }
      const hit = hitTest(p.x, p.y);
      if (hit) {
        // v40: Ctrl+点击 切换选中 (对齐 lazer/stable; Shift 兼容保留)
        if (e.ctrlKey || e.metaKey || e.shiftKey) store.toggleSelect(hit.id);
        else if (!store.selected.has(hit.id)) store.select([hit.id]);
        if (!store.lockNotes) { // v115: 锁定物件 — 可选中, 不可拖动
          store.beginDrag();
          store.canvasDragging = true;
          dragRef.current = {
            ids: [...store.selected], startX: p.x, startY: p.y, moved: false,
            orig: new Map([...store.selected].map(id => {
              const o = bm.hitObjects.find(x => x.id === id)!;
              return [id, { x: o.x, y: o.y, curve: o.curvePoints?.map(c => ({ ...c })) }];
            })),
          };
        }
      } else {
        // 空白处按下: 开始框选 (Shift 在现有选区上追加)
        marqueeRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, base: e.shiftKey ? [...store.selected] : [] };
        store.canvasDragging = true;
        if (!e.shiftKey) store.clearSelection();
      }
    } else if (store.tool === 'circle') {
      const sp = snapPlacement(p);
      store.addObject({
        id: genId(), type: 'circle', x: Math.round(sp.x), y: Math.round(sp.y),
        time: Math.round(snapTime(store.currentTime)), newCombo: false, comboSkip: 0, hitSound: 0,
      });
    } else if (store.tool === 'spinner') {
      // v180: 对齐 lazer SpinnerPlacementBlueprint — 左键只提交起点 (吸附当前细分), 进入放置中状态;
      // 之后终点实时跟随编辑器当前时间 (滚动时间轴/播放拉长), 右键完成; 放置中左键无效
      if (store.pendingSpinner === null) {
        store.pendingSpinner = Math.round(snapTime(store.currentTime));
        store.emit();
      }
    } else if (store.tool === 'slider') {
      const pendPts = store.pendingSlider;
      // v208: 无待点时的双击第二击直接吞掉 — 否则双击头部闭环后第二击会在原地新起一条滑条
      if (e.detail >= 2 && pendPts.length === 0) return;
      const lastPt = pendPts[pendPts.length - 1];
      const nearLastPt = !!lastPt && Math.hypot(p.x - lastPt.x, p.y - lastPt.y) < 8;
      if (e.detail >= 2) {
        // v208 (取代 v206 的"第一击刚放"例外): stable 语义 — 双击 = 末点置红, 永不结束放置
        // (结束放置用右键 / 点击头部闭环)。双击空白处: 第一击已把点放在光标处, 第二击命中
        // 刚放的末点 -> 置红, 这正是 stable 里快速放红锚点的操作 (用户两次反馈双击结束是 bug)
        if (nearLastPt) {
          lastPt.redAnchor = true;
          dblRedSkipRef.current = true; // 吞掉第二击 mouseup 后 React onDoubleClick 的 finishSlider
          store.emit();
          return;
        }
        // 第二击落在末点 8px 外 (快速连点不同位置): 不按双击处理, 落入下面普通加点分支
      }
      if (e.detail === 1 && pendPts.length >= 2 && Math.hypot(p.x - pendPts[0].x, p.y - pendPts[0].y) < 8) {
        finishSlider();
        return;
      }
      // v66: 只有头部时任何左键按下 = 手绘候选 (lazer OnDragStart: 拖动进 Drawing 模式;
      // 必须排在"点击末点切红"之前, 否则从头部附近起笔永远被切红截获, 无法手绘)
      // v74: 无待放点时左键按下 = 立即放头 + 同时登记手绘候选 (lazer: 按下即放头, 保持按住续拖直接进手绘);
      // 候选期间 canvasDragging=true — 拖过时间轴不 seek (v74 修复)
      if ((store.pendingSlider.length === 0 || store.pendingSlider.length === 1) && e.button === 0) {
        const isHead = store.pendingSlider.length === 0;
        // v145: 滑条头部与单点放置同源走 snapPlacement (物件吸附 > 锁定间距 > 网格; 修复锁定间距对滑条头不生效);
        // 第二个起的控制点维持原规则, 不走锁定间距 (见下方 v56 注释)
        const sp0 = isHead ? snapPlacement(p)
          : snapSliderCtrlPoint(p); // v207: 公式收敛 (与预览幻影同源)
        if (isHead) store.pendingSlider.push({ x: Math.round(sp0.x), y: Math.round(sp0.y), redAnchor: e.ctrlKey });
        drawCandRef.current = { x: p.x, y: p.y, sp: sp0, redAnchor: e.ctrlKey, isHead };
        store.canvasDragging = true;
        store.emit();
        return;
      }
      // lazer: 点击最后一个已放置的点 -> 标记红点 (段分隔), 不新增点
      const last = store.pendingSlider[store.pendingSlider.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 8) {
        last.redAnchor = !last.redAnchor;
        store.emit();
        return;
      }
      // v56: 滑条控制点同样吃 物件吸附 + 网格 (lazer SliderPlacementBlueprint; 不走锁定间距, 保持既有放置行为)
      // v207: 公式收敛到 snapSliderCtrlPoint (与预览幻影同源)
      const sp = snapSliderCtrlPoint(p);
      store.pendingSlider.push({ x: Math.round(sp.x), y: Math.round(sp.y), redAnchor: e.ctrlKey });
      store.emit();
    }
  };

  // v207: 滑条控制点吸附公式 (v56 规则: 物件吸附+辅助线 > 网格, 不走锁定间距) —
  // mousedown 落点与预览幻影 (pendingCursor/画布光标) 共用, 预览所见即所放
  const snapSliderCtrlPoint = (p: { x: number; y: number }) => {
    const bm0 = store.beatmap;
    if (!bm0) return p;
    return gridSnapAt(bm0, snapWithGeo(bm0, p, snapToNearby(p, objectSnapPoints(bm0, bm0.hitObjects.filter(o => !store.selected.has(o.id) && isVisibleAt(bm0, o, store.currentTime))))) ?? p);
  };

  const finishSlider = () => {
    const bm = store.beatmap;
    const pend = store.pendingSlider;
    drawCandRef.current = null; // v66: 清理手绘候选/进行态 (右键/双击结束也可能发生在按下后)
    freehandRef.current = null;
    if (!bm || pend.length < 2) { store.pendingSlider = []; store.pendingCursor = null; store.emit(); return; }
    // lazer: 长度 = 路径几何全长过 FindSnappedDistance (尾端吸附 1/beatSnap tick, 不超几何全长); 锁定间距时吸附整拍
    // v83: 规则收敛到共享纯函数 placementLength/snapPlacementTime (与 v82 时间轴预览同规则, 预览=落盘)
    const computed = computePendingPath(pend, null);
    const len = placementLength(bm.timingPoints, store.currentTime, bm.difficulty.sliderMultiplier,
      computed.length, store.distanceLock, bm.editor.distanceSpacing, store.beatSnap);
    // v75: 'B' 落盘前把恰 3 点的段转圆预设贝塞尔锚点 — 预览按 'P' 弧渲染, 不落锚点转换则 3 点段被当二次贝塞尔, 形状塌掉
    const finalCtrl = preserveArcsForBezier(computed.curveType, computed.controlPoints);
    const head = finalCtrl[0];
    const pathPts = finalCtrl.slice(1);
    store.addObject({
      id: genId(), type: 'slider', x: head.x, y: head.y,
      time: Math.round(snapPlacementTime(bm.timingPoints, store.currentTime, store.beatSnap)),
      curveType: computed.curveType, curvePoints: pathPts, slides: 1, length: len,
      newCombo: true, comboSkip: 0, hitSound: 0,
    });
    store.pendingSlider = [];
    store.pendingCursor = null;
    store.emit();
  };

  // ---- v66: 手绘滑条 (lazer SliderPlacementBlueprint Drawing 模式) ----
  /** 拖动中实时拟合预览: builder 控制点 -> pendingSlider (段起点 = 红锚点, bspline 标记 => 'B4' 渲染), 走既有放置预览渲染 */
  const updateFreehandPreview = (builder: IncrementalBSplineBuilder, head: { x: number; y: number }) => {
    const { points } = fitSegmentsToPoints(builder.getControlPoints(), builder.degree, FREEHAND_CIRCLE_THRESHOLD);
    if (points.length < 2) return; // 输入还太少, 保持仅头部
    store.pendingSlider = [
      { x: head.x, y: head.y, redAnchor: false, bspline: true },
      ...points.slice(1).map(pt => ({ x: head.x + pt.x, y: head.y + pt.y, redAnchor: pt.red, bspline: true })),
    ];
  };

  /** 松开鼠标: Finish 后取最终控制点建滑条 (单段圆弧 => 'P' 三点, 否则 'B4' B样条少控制点, 与 lazer 编辑器一致) */
  const finishFreehandSlider = (builder: IncrementalBSplineBuilder) => {
    const bm = store.beatmap;
    const head = store.pendingSlider[0];
    if (!bm || !head) { store.pendingSlider = []; store.emit(); return; }
    const { points, singleArc } = fitSegmentsToPoints(builder.getControlPoints(), builder.degree, FREEHAND_CIRCLE_THRESHOLD);
    if (points.length < 2) { store.pendingSlider = [head]; store.emit(); return; } // 退化 (几乎没画): 回到只有头部的点击流
    // 组装绝对控制点 (红锚点按 .osu 惯例加倍为连续重复点)
    const ctrl: { x: number; y: number }[] = [{ x: Math.round(head.x), y: Math.round(head.y) }];
    for (const pt of points.slice(1)) {
      const a = { x: Math.round(head.x + pt.x), y: Math.round(head.y + pt.y) };
      ctrl.push(a);
      if (pt.red) ctrl.push({ ...a });
    }
    // v74: 非单弧 => 'B4' (lazer 扩展 degree-4 B 样条, 控制点 = builder 原始输出)
    const curveType = singleArc && ctrl.length === 3 ? 'P' : 'B4';
    // 长度 = 几何全长, 锁定间距时吸附整拍 (与 finishSlider 同款规则; lazer endCurve: Finishing 状态 SnapTo)
    // v83: 规则收敛到共享纯函数 placementLength/snapPlacementTime
    const len = placementLength(bm.timingPoints, store.currentTime, bm.difficulty.sliderMultiplier,
      sliderGeometryLength(curveType, ctrl), store.distanceLock, bm.editor.distanceSpacing, store.beatSnap);
    store.addObject({
      id: genId(), type: 'slider', x: ctrl[0].x, y: ctrl[0].y,
      time: Math.round(snapPlacementTime(bm.timingPoints, store.currentTime, store.beatSnap)),
      curveType, curvePoints: ctrl.slice(1), slides: 1, length: len,
      newCombo: true, comboSkip: 0, hitSound: 0,
    });
    store.pendingSlider = [];
    store.pendingCursor = null;
    store.emit();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const cp = toOsu(e);
    cursorRef.current = { x: cp.x, y: cp.y, inside: cp.x >= 0 && cp.x <= PW && cp.y >= 0 && cp.y <= PH };
    // v82: 放置中光标 -> store (上方时间轴滑条预览幻影点)
    // v207: 控制点预览走落点同款吸附 (snapSliderCtrlPoint) — 幻影节点与点击落点一致, 所见即所放
    store.pendingCursor = store.tool === 'slider' && store.pendingSlider.length > 0 ? snapSliderCtrlPoint({ x: cp.x, y: cp.y }) : null;
    const bm = store.beatmap;
    // v145: 放置预览幽灵位置 -> store (间距面板实时预览间距; 与画布幻影同走 snapPlacement, 所见即所得。
    // 仅 圆圈工具 / 滑条无锚点 且 非拖拽非播放 且 光标在游玩区内 时有效, 否则置空)
    {
      const placing = store.tool === 'circle' || (store.tool === 'slider' && store.pendingSlider.length === 0);
      // v163: 关闭"限制物件在游玩区域内"后, 游玩区外也显示放置预览
      if (placing && bm && !store.playing && !store.canvasDragging && (cursorRef.current.inside || !store.limitToPlayfield))
        store.setPlacementPreview(snapPlacement({ x: cp.x, y: cp.y }));
      else store.setPlacementPreview(null);
    }
    // v68: 批量复制向量箭头拖拽 — 头位置 - 锚 = 每份向量, 回写弹窗参数 (实时预览)
    // v91: 向量头拖拽吃物件吸附 + 辅助线/点吸附 (取更近者, 与自定义原点同级)
    if (dupVectorDragRef.current) {
      const dv = store.dupVectorView;
      if (!dv || !store.dupVectorDragHandler) { dupVectorDragRef.current = false; return; }
      const sp = bm ? snapWithGeo(bm, cp, snapToNearby(cp, objectSnapPoints(bm, bm.hitObjects.filter(o => isVisibleAt(bm, o, store.currentTime))))) ?? cp : cp;
      store.dupVectorDragHandler(sp.x - dv.anchor.x, sp.y - dv.anchor.y);
      return;
    }
    // v78: 自定义网格中心标记拖拽 (物件吸附 + 辅助线/点吸附取更近者; 不做网格吸附 — 网格以标记自身为原点, 吸附会自锁跳动; 不钳制)
    if (gridOriginDragRef.current) {
      if (bm) {
        const targets = objectSnapPoints(bm, bm.hitObjects.filter(o => isVisibleAt(bm, o, store.currentTime)));
        store.setGridOrigin(snapWithGeo(bm, cp, snapToNearby(cp, targets)) ?? cp);
      } else store.setGridOrigin(cp);
      return;
    }
    // v210: 自定义对称轴端点拖拽 (与自定义原点同级吸附: 物件/辅助线取更近者 + 网格; 两点最小间距由 setSymPoint 钳制)
    if (symPointDragRef.current) {
      const i = symPointDragRef.current;
      if (store.transformDialog !== 'symmetry') { symPointDragRef.current = 0; return; }
      if (bm) {
        const targets = objectSnapPoints(bm, bm.hitObjects.filter(o => isVisibleAt(bm, o, store.currentTime)));
        store.setSymPoint(i, gridSnapAt(bm, snapWithGeo(bm, cp, snapToNearby(cp, targets)) ?? cp));
      } else store.setSymPoint(i, cp);
      return;
    }
    // v34: 自定义原点标记拖拽 (不钳制, 允许拖出游玩区; v68/v91: 物件吸附 + 辅助线/点吸附取更近者 + 网格吸附, 与物件放置同级)
    // v166: 批量复制窗口打开时写弹窗独立原点 dupCustomOrigin
    if (originDragRef.current) {
      const setO = (p: Pt) => { if (store.conversionDialog === 'duplicate') store.setDupCustomOrigin(p); else store.setCustomOrigin(p); };
      if (bm) {
        const targets = objectSnapPoints(bm, bm.hitObjects.filter(o => isVisibleAt(bm, o, store.currentTime)));
        setO(gridSnapAt(bm, snapWithGeo(bm, cp, snapToNearby(cp, targets)) ?? cp));
      } else setO(cp);
      return;
    }
    // v117: 节点选区旋转/缩放拖拽 (优先于物件层 — 两者互斥, 不会同时非空)
    if (nodeRotateDragRef.current && bm) {
      applyNodeRotateUpdate(cp, e.shiftKey);
      return;
    }
    if (nodeScaleDragRef.current && bm) {
      const sd = nodeScaleDragRef.current;
      sd.lastP = cp; sd.shift = e.shiftKey; sd.alt = e.altKey;
      applyNodeScaleUpdate(cp, e.shiftKey, e.altKey);
      return;
    }
    // v50: 选中框旋转拖拽
    if (rotateDragRef.current && bm) {
      applyRotateUpdate(cp, e.shiftKey);
      return;
    }
    // v49: 选中框缩放拖拽
    if (scaleDragRef.current && bm) {
      const sd = scaleDragRef.current;
      sd.lastP = cp; sd.shift = e.shiftKey; sd.alt = e.altKey;
      applyScaleUpdate(cp, e.shiftKey, e.altKey);
      return;
    }
    // v66: 手绘滑条 (候选超 4px 阈值进 Drawing 模式; 原始光标点逐点采样, 不走网格/物件吸附, 实时拟合预览)
    const cand = drawCandRef.current;
    if (cand && bm) {
      const head = store.pendingSlider[0];
      if (!head) { drawCandRef.current = null; return; }
      if (!freehandRef.current) {
        if (Math.hypot(cp.x - cand.x, cp.y - cand.y) <= 4) return; // 未超拖拽阈值, 仍是点击候选
        const builder = new IncrementalBSplineBuilder(4, 1.8, 0.4); // lazer: Degree 4 / Tolerance 1.8 / CornerThreshold 0.4
        builder.addLinearPoint({ x: 0, y: 0 });
        builder.addLinearPoint({ x: cand.x - head.x, y: cand.y - head.y });
        freehandRef.current = { builder };
        store.canvasDragging = true;
      }
      const builder = freehandRef.current.builder;
      builder.addLinearPoint({ x: cp.x - head.x, y: cp.y - head.y });
      updateFreehandPreview(builder, head);
      return;
    }
    // v50: 无拖拽时更新手柄悬停与光标形状
    updateHandleHover(bm && store.tool === 'select' ? cp : null);
    // v117: 节点框选拖拽: 实时更新节点选区 (只框当前可见滑条, 与物件框选同一可见窗口)
    const nmq = nodeMarqueeRef.current;
    if (nmq && bm) {
      nmq.x1 = cp.x; nmq.y1 = cp.y;
      const r = {
        minX: Math.min(nmq.x0, nmq.x1), minY: Math.min(nmq.y0, nmq.y1),
        maxX: Math.max(nmq.x0, nmq.x1), maxY: Math.max(nmq.y0, nmq.y1),
      };
      const sliders = bm.hitObjects.filter(o => o.type === 'slider' && isVisibleAt(bm, o, store.currentTime));
      store.setSelectedNodes([...nmq.base, ...nodesInRect(sliders, getStackOffsets(bm), r)]);
      return;
    }
    // v117: 节点整体拖动 (<=4px 视为点选, 不改形; 锚节点吃吸附, delta 取整后同步全部选中节点)
    const nmd = nodesMoveDragRef.current;
    if (nmd && bm) {
      if (!nmd.moved) {
        if (Math.hypot(cp.x - nmd.startX, cp.y - nmd.startY) <= 4) return;
        nmd.moved = true;
      }
      const offs = getStackOffsets(bm);
      const aOff = offs.get(nmd.anchor.objId);
      const a0 = nmd.orig.get(nmd.anchor.objId)?.get(nmd.anchor.idx);
      if (a0) {
        const a0d = { x: a0.x + (aOff?.dx ?? 0), y: a0.y + (aOff?.dy ?? 0) }; // 锚节点显示位置 (含堆叠偏移)
        const exclude = new Set(nmd.orig.keys()); // v96 同款: 辅助吸附排除被拖滑条自身, 防自锁
        const near = snapWithGeo(bm, cp, snapToNearby(cp, objectSnapPoints(bm, bm.hitObjects.filter(x => !exclude.has(x.id) && isVisibleAt(bm, x, store.currentTime)))), exclude);
        const sp = gridSnapAt(bm, near ?? cp);
        const dx = Math.round(sp.x - a0d.x), dy = Math.round(sp.y - a0d.y);
        const ids = transformNodesFromSnapshot(bm, nmd.orig, pt => ({ x: pt.x + dx, y: pt.y + dy }));
        for (const id of ids) {
          const o = bm.hitObjects.find(x => x.id === id);
          if (o) resnapSliderLength(bm, o, store.beatSnap); // 拖拽中实时 SnapTo (与单节点拖拽同款)
          invalidatePath(id);
        }
        store.commitDrag();
      }
      return;
    }
    // 框选拖拽: 实时更新选区
    const mq = marqueeRef.current;
    if (mq && bm) {
      mq.x1 = cp.x; mq.y1 = cp.y;
      const r = {
        minX: Math.min(mq.x0, mq.x1), minY: Math.min(mq.y0, mq.y1),
        maxX: Math.max(mq.x0, mq.x1), maxY: Math.max(mq.y0, mq.y1),
      };
      store.select([...mq.base, ...objectsInRect(
        // v45: 只框选当前可见物件 (与单击命中同一可见窗口, 不再把全时间物件都框进来)
        bm.hitObjects.filter(o => isVisibleAt(bm, o, store.currentTime)),
        r, getStackOffsets(bm))]);
      return;
    }
    // 滑条节点拖拽 (<=4px 视为点击, 不改形, mouseup 时白点切红)
    const nd = nodeDragRef.current;
    if (nd && bm) {
      const p = toOsu(e);
      if (!nd.moved) {
        if (Math.hypot(p.x - nd.startX, p.y - nd.startY) <= 4) return;
        nd.moved = true;
      }
      const o = bm.hitObjects.find(x => x.id === nd.objId);
      if (o) {
        // v29: 控制点允许超出游玩区域 (不钳制到 0..512/0..384)
        // v76: 节点拖拽吃物件吸附 + 网格吸附 (与放置同款规则: 物件吸附优先, 网格最后应用并覆盖;
        // 目标 = 除本滑条外的可见物件; 红锚点成对移动取同一吸附点, 重复对不拆散)
        // v96: 辅助吸附排除被拖滑条自身 (直线延伸线/三点圆由被拖点决定, 点必在辅助线上, 只能辅助线跟点动)
        const near = snapWithGeo(bm, p, snapToNearby(p, objectSnapPoints(bm, bm.hitObjects.filter(x => x.id !== nd.objId && isVisibleAt(bm, x, store.currentTime)))), new Set([nd.objId]));
        const sp = gridSnapAt(bm, near ?? p);
        const nx = Math.round(sp.x), ny = Math.round(sp.y);
        const setPt = (idx: number) => {
          if (idx === 0) { o.x = nx; o.y = ny; }
          else if (o.curvePoints && o.curvePoints[idx - 1]) {
            o.curvePoints[idx - 1].x = nx;
            o.curvePoints[idx - 1].y = ny;
          }
        };
        setPt(nd.pointIndex);
        if (nd.pairWith !== null) setPt(nd.pairWith); // 红锚点成对移动, 保持重复对不拆散
        // lazer DragInProgress: 拖拽中实时 SnapTo (长度按新几何全长吸附节拍, 预览即最终值)
        resnapSliderLength(bm, o, store.beatSnap);
        invalidatePath(o.id);
        store.commitDrag();
      }
      return;
    }
    const d = dragRef.current;
    if (!d || !bm) return;
    const p = toOsu(e);
    let dx = Math.round(p.x - d.startX), dy = Math.round(p.y - d.startY);
    if (Math.abs(dx) + Math.abs(dy) > 1) d.moved = true;
    // v55: 拖拽吸附到附近物件 (lazer checkSnappingBlueprintToNearbyObjects):
    // 被拖物件的头 + 滑条尾 (快照几何, 活物件 slides/length) 逐点试探可见非选中物件, 命中最近一对则修正位移
    {
      const dragPts: { x: number; y: number }[] = [];
      for (const id of d.ids) {
        const o = bm.hitObjects.find(x => x.id === id);
        const orig = d.orig.get(id);
        if (!o || !orig) continue;
        dragPts.push({ x: orig.x, y: orig.y });
        if (o.type === 'slider' && orig.curve) {
          const path = new SliderPath(o.curveType ?? 'L', [{ x: orig.x, y: orig.y }, ...orig.curve], o.length ?? 100);
          dragPts.push(path.positionAt((o.slides ?? 1) % 2 === 0 ? 0 : (o.length ?? path.totalLength)));
        }
      }
      const targets = objectSnapPoints(bm, bm.hitObjects.filter(o => !store.selected.has(o.id) && isVisibleAt(bm, o, store.currentTime)));
      const corr = snapDragDelta(dragPts, targets, dx, dy);
      let corrDist: number | null = null;
      if (corr) { corrDist = Math.hypot(corr.dx - dx, corr.dy - dy); dx = corr.dx; dy = corr.dy; }
      // v91: 拖拽吸附辅助线/点 (lazer 蓝图吸附同款语义: 与物件修正取更近者; 排除被拖物件自身辅助, 防自锁)
      const gc = geoDragCorrection(dragPts, dx, dy, p => geoSnap(bm, p, store.selected), corrDist);
      if (gc) { corrDist = Math.hypot(gc.dx - dx, gc.dy - dy); dx = gc.dx; dy = gc.dy; } // v134: 修正量传递, 供间距辅助线比较
      // v134: 拖拽吸附间距辅助线 (被拖头/尾边缘贴金色环带; 与物件/几何辅助修正取更近者; 排除被拖物件自身, 防自锁)
      const gdc = geoDragCorrection(dragPts, dx, dy, q => geoDistSnap(bm, q, store.selected), corrDist);
      if (gdc) { dx = gdc.dx; dy = gdc.dy; }
    }
    // v145: 拖拽锁定间距 (lazer CircularDistanceSnapGrid.GetSnappedPosition: 被拖首件头投影到
    // 以前件结束位置为圆心、期望距离为半径的圆上; 多选整体同 delta; 网格吸附仍在最后应用并覆盖)
    if (store.distanceLock && bm.editor.distanceSpacing > 0 && d.ids.length) {
      const anchor = bm.hitObjects.find(x => x.id === d.ids[0]);
      const aOrig = d.orig.get(d.ids[0]);
      if (anchor && aOrig) {
        const ref = distanceLockRef(bm, anchor.time, new Set(d.ids));
        if (ref) {
          const dist = distanceLockDistance(bm, ref.endTime, anchor.time);
          const rx = aOrig.x + dx - ref.endX, ry = aOrig.y + dy - ref.endY;
          const rl = Math.hypot(rx, ry);
          if (rl > 1e-6) {
            dx = Math.round(ref.endX + rx / rl * dist - aOrig.x);
            dy = Math.round(ref.endY + ry / rl * dist - aOrig.y);
          }
        }
      }
    }
    // v56: 网格吸附 (lazer TryMoveBlueprints: 位置网格最后应用并覆盖; 锚 = 第一个被拖物件的头)
    if (store.gridSnap && d.ids.length) {
      const orig = d.orig.get(d.ids[0]);
      if (orig) {
        const snapped = snapToGrid({ x: orig.x + dx, y: orig.y + dy }, store.gridType, store.currentGridOrigin(), store.gridSpacing ?? bm.editor.gridSize, store.gridRotation);
        dx = Math.round(snapped.x - orig.x); dy = Math.round(snapped.y - orig.y);
      }
    }
    for (const id of d.ids) {
      const o = bm.hitObjects.find(x => x.id === id);
      const orig = d.orig.get(id);
      if (o && orig) {
        // 头部钳制后的实际位移, 滑条控制点整体同步平移 (否则只动头会把滑条拉变形)
        // v163: 关闭"限制物件在游玩区域内"时不钳制, 物件可拖出游玩区
        const ax = (store.limitToPlayfield ? Math.max(0, Math.min(PW, orig.x + dx)) : orig.x + dx) - orig.x;
        const ay = (store.limitToPlayfield ? Math.max(0, Math.min(PH, orig.y + dy)) : orig.y + dy) - orig.y;
        const changed = o.x !== orig.x + ax || o.y !== orig.y + ay;
        o.x = orig.x + ax;
        o.y = orig.y + ay;
        if (o.type === 'slider') {
          o.curvePoints?.forEach((pt, i) => {
            const c = orig.curve?.[i];
            if (c) { pt.x = c.x + ax; pt.y = c.y + ay; }
          });
          if (changed || ax || ay) invalidatePath(o.id);
        }
      }
    }
    // v145: 拖动中原地改坐标不经任何 emit, React 面板不刷新 — 通知选区订阅者 (间距面板实时更新)
    if (d.moved) store.emitSelection();
  };

  const onMouseUp = () => {
    // 注意: canvasDragging 不在这里清 — 拖出画布 (如经过时间轴) 时按钮尚未松开,
    // 标志必须保持到 window mouseup (见上方 useEffect), 否则时间轴会在拖拽经过时误触 seek
    // (v74: 手绘/候选进行中 onMouseLeave 不再调本函数, 由 window mouseup 统一收尾)
    // v66: 手绘结束 — Finish (末段 100 次迭代完整优化) 后建滑条
    if (freehandRef.current) {
      const builder = freehandRef.current.builder;
      freehandRef.current = null;
      drawCandRef.current = null;
      store.canvasDragging = false;
      builder.finish();
      finishFreehandSlider(builder);
      return;
    }
    // v66: 未超阈值的手绘候选 = 单击 (落 mousedown 时的吸附点); 点在头部附近则按 lazer 语义切红
    if (drawCandRef.current) {
      const c = drawCandRef.current;
      drawCandRef.current = null;
      // v74: 头部候选 = 头已在 mousedown 落好, 松开不加点不切红
      if (!c.isHead) {
        const head = store.pendingSlider[0];
        if (head && Math.hypot(c.x - head.x, c.y - head.y) < 8) head.redAnchor = !head.redAnchor;
        else {
          store.pendingSlider.push({ x: Math.round(c.sp.x), y: Math.round(c.sp.y), redAnchor: c.redAnchor });
        }
        store.emit();
      }
      return;
    }
    if (rotateDragRef.current) {
      // lazer Commit: 一次拖拽一次 undo; 未产生旋转则弹出 beginDrag 的空快照
      if (rotateDragRef.current.moved) store.commitDrag(); else store.undo();
      rotateDragRef.current = null;
      updateHandleHover(null);
      return;
    }
    // v117: 节点层手柄拖拽收尾 (与物件层同款语义)
    if (nodeRotateDragRef.current) {
      if (nodeRotateDragRef.current.moved) store.commitDrag(); else store.undo();
      nodeRotateDragRef.current = null;
      updateHandleHover(null);
      return;
    }
    if (nodeScaleDragRef.current) {
      if (nodeScaleDragRef.current.moved) store.commitDrag(); else store.undo();
      nodeScaleDragRef.current = null;
      updateHandleHover(null);
      return;
    }
    // v117: 节点整体拖动收尾 — 未拖动即 Alt 纯点选, 弹出 beginDrag 空快照
    if (nodesMoveDragRef.current) {
      if (nodesMoveDragRef.current.moved) store.commitDrag(); else store.undo();
      nodesMoveDragRef.current = null;
      return;
    }
    // v117: 节点框选收尾 (选区已在 mousemove 实时更新, 仅清 ref)
    if (nodeMarqueeRef.current) {
      nodeMarqueeRef.current = null;
      return;
    }
    if (scaleDragRef.current) {
      // lazer Commit: 一次拖拽一次 undo; 未产生缩放则弹出 beginDrag 的空快照
      if (scaleDragRef.current.moved) store.commitDrag(); else store.undo();
      scaleDragRef.current = null;
      updateHandleHover(null);
      return;
    }
    if (marqueeRef.current) {
      const mq = marqueeRef.current;
      marqueeRef.current = null;
      // 位移极小视为点击空白: 无 Shift 时清空选区 (mousedown 已清, 这里兜底无 mousemove 的情况)
      if (Math.hypot(mq.x1 - mq.x0, mq.y1 - mq.y0) <= 3 && !mq.base.length) store.clearSelection();
      return;
    }
    if (nodeDragRef.current) {
      const nd = nodeDragRef.current;
      nodeDragRef.current = null;
      if (nd.moved) { store.commitDrag(); return; }
      // 点击手柄 (未拖拽): 仅白点切红 (mousedown 的 beginDrag 快照即本次 undo)
      // v29: 红点点击不再有任何操作 — 红->白改用右键 (避免误触拆对)
      // v118: stable 行为 — 只有按下时带 Ctrl (nd.toggleRed) 才切红; 直接点击无操作, 弹出空快照
      const bm = store.beatmap;
      const o = bm?.hitObjects.find(x => x.id === nd.objId);
      const ctrl = o?.type === 'slider' ? [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])] : null;
      const next = ctrl && nd.toggleRed && !isRedPairPoint(ctrl, nd.pointIndex) ? toggleSliderPointRed(ctrl, nd.pointIndex) : null;
      if (o && next) {
        applySliderPoints(o, next);
        // lazer AddTypeToSelection: 仅当新几何比原长度短才重新 SnapTo, 否则保留原长度
        const geo = sliderGeometryLength(o.curveType ?? 'L', [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])]);
        if (bm && geo < (o.length ?? 0)) o.length = snapSliderLength(bm.timingPoints, o.time, bm.difficulty.sliderMultiplier, geo, store.beatSnap);
        invalidatePath(o.id);
        store.commitDrag();
      } else {
        store.undo(); // 头部等不可切换: 弹出 mousedown 压入的空快照
      }
      return;
    }
    if (dragRef.current) {
      if (!dragRef.current.moved) store.undo(); // 没拖动则撤销 beginDrag 的快照
      else store.commitDrag();
      dragRef.current = null;
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const bm = store.beatmap;
    if (!bm) return;
    if (store.tool === 'select') {
      if (store.lockNotes) return; // v115: 锁定物件 — 右键控制点操作与删除全禁
      // 右键点击控制点手柄: 红锚点 -> 合并为一个白点 (v29); 白点 -> 删除 (头部不可删)
      const selObjs = bm.hitObjects.filter(o => store.selected.has(o.id));
      if (selObjs.length === 1 && selObjs[0].type === 'slider') {
        const so = selObjs[0];
        const p = toOsu(e);
        const soff = getStackOffsets(bm).get(so.id);
        const odx = soff?.dx ?? 0, ody = soff?.dy ?? 0;
        const ctrl = [{ x: so.x, y: so.y }, ...(so.curvePoints ?? [])];
        const i = nearestCtrlPoint(ctrl, odx, ody, p); // v35: 与左键拖拽同一命中优先级
        if (i >= 0) {
          if (i === 0) return; // 头部手柄: 不可删不可转白, 也不落到通用删除 (右键头 ≠ 删滑条)
          if (isRedPairPoint(ctrl, i)) {
            // 红->白: 重复对合并成一个点 (几何不变, 长度保留; lazer 条件分支: 变短才重吸附)
            const next = toggleSliderPointRed(ctrl, i)!;
            store.pushUndo();
            applySliderPoints(so, next);
            const geo = sliderGeometryLength(so.curveType ?? 'L', [{ x: so.x, y: so.y }, ...(so.curvePoints ?? [])]);
            if (geo < (so.length ?? 0)) so.length = snapSliderLength(bm.timingPoints, so.time, bm.difficulty.sliderMultiplier, geo, store.beatSnap);
            invalidatePath(so.id);
            store.emit();
          } else {
            const next = deleteSliderPoint(ctrl, i);
            if (next) {
              store.pushUndo(); // 一次操作一次 undo; emit bump dataVersion (tick 事件重建)
              applySliderPoints(so, next);
              resnapSliderLength(bm, so, store.beatSnap); // lazer: 删除控制点后 SnapTo
              invalidatePath(so.id);
              store.emit();
            }
          }
          return;
        }
      }
      // 选中滑条时右键滑条非控制点部位 -> 落到下方通用删除 (删整个滑条)
    } else if (store.tool === 'slider' && store.pendingSlider.length) {
      finishSlider();
      return;
    } else if (store.tool === 'spinner' && store.pendingSpinner !== null) {
      // v180: 右键完成转盘放置 (lazer SpinnerPlacementBlueprint: isPlacingEnd 时右键 EndPlacement(true))
      // 终点 = max(起点+一拍, 当前时间吸附细分网格), 与放置预览同源
      const start = store.pendingSpinner;
      const endTime = Math.round(spinnerPlacementEnd(bm.timingPoints, start, store.currentTime, store.beatSnap));
      store.pendingSpinner = null;
      store.addObject({
        id: genId(), type: 'spinner', x: 256, y: 192,
        time: start, endTime, newCombo: true, comboSkip: 0, hitSound: 0,
      });
      return;
    }
    // v30: 四种模式通用 — 右键命中物件 -> 删除该物件
    const p = toOsu(e);
    const hit = hitTest(p.x, p.y);
    if (!hit || store.lockNotes) return; // v115: 锁定物件 — 右键删除禁用
    // v114: 右键已选中物件 -> 删除整个选区 (物件+绿线, 一次 undo); 未选中 -> 只删该物件
    if (store.selected.has(hit.id)) { store.deleteSelected(); return; }
    store.pushUndo(); // 一次操作一次 undo; emit bump dataVersion (tick 事件重建)
    bm.hitObjects = bm.hitObjects.filter(o => o.id !== hit.id);
    store.selected.delete(hit.id);
    invalidatePath(hit.id);
    store.emit();
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-crosshair select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        cursorRef.current.inside = false;
        store.setPlacementPreview(null); // v145: 光标出游玩区, 清放置预览
        if (canvasRef.current) canvasRef.current.style.cursor = '';
        // v50: 缩放/旋转拖拽不因离开画布而终止 (window mousemove/mouseup 接管)
        // v74: 手绘/候选同样不因离开画布终止 (window mousemove 继续采样, window mouseup 收尾;
        // 否则拖过时间轴时手绘被提前 finish 且 canvasDragging 被清 => 时间轴误 seek)
        if (!scaleDragRef.current && !rotateDragRef.current && !freehandRef.current && !drawCandRef.current) onMouseUp();
      }}
      onDoubleClick={() => {
        if (store.tool !== 'slider') return;
        if (dblRedSkipRef.current) { dblRedSkipRef.current = false; return; } // v208: 双击末点置红已在 mousedown 处理, 吞掉本次 finish
        finishSlider();
      }}
      onContextMenu={onContextMenu}
      onWheel={(e) => {
        // v193: 滚轮走 store.wheelSeek (lazer 对齐: 刻度累积; 播放中不吸附大步长 + 轻量重定位, 暂停吸附 1/beatSnap)
        store.wheelSeek(e.deltaY, e.deltaMode);
      }}
    />
  );
}
