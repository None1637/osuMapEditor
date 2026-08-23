// 选中框缩放 (黄色选择框 + 边/角拖拽手柄): 对齐 lazer
//   osu.Game/Screens/Edit/Compose/Components/SelectionBox.cs           (框/手柄布局, 手柄可用性)
//   osu.Game/Screens/Edit/Compose/Components/SelectionBoxScaleHandle.cs (拖拽 -> 倍率换算, Shift 锁比 / Alt 默认原点)
//   osu.Game.Rulesets.Osu/Edit/OsuSelectionScaleHandler.cs             (Begin/Update/Commit, 单滑条特殊分支, 游玩区钳制)
//   osu.Game/Utils/GeometryUtils.cs                                    (GetSurroundingQuad / GetScaledPosition / ClampScaleToPlayfieldBounds)
// 规则:
//  - 缩放参考包围盒 = 选中可移动物件 (排除转盘) 的位置包围盒, 滑条含全部控制点 (lazer enumeratePositions);
//  - 手柄可用性: 宽>0 才有左右边手柄, 高>0 才有上下边手柄, 都有才有四角 (单圆圈 0x0 -> 无手柄);
//  - 拖拽倍率 = 1 + 鼠标位移/包围盒对应边长; 边手柄另一轴清零; 上/左边手柄方向取反;
//    角手柄按住 Shift 锁长宽比 (取 X/Y 均值); 缩放原点 = 手柄对角锚点, 按住 Alt 改用默认原点 (凸包最小包围圆圆心);
//  - 多物件: 只缩放物件位置 (滑条整体移动不缩路径), 倍率先钳制使选区不出游玩区, 再整体移回界内;
//  - 单个滑条: 控制点绕滑条头缩放 + 长度吸附节拍, 头/尾出界或路径非法则整体回滚 (不允许镜像)。
import type { Beatmap, HitObject } from './parser';
import { SliderPath, getSliderPath, sliderGeometryLength, resnapSliderLength } from './sliderPath';

export interface Pt { x: number; y: number }
export interface Quad { x: number; y: number; w: number; h: number }

// 手柄锚点: tl/tc/tr/cl/cr/bl/bc/br (lazer Anchor 的 8 个缩放位)
export type ScaleAnchor = 'tl' | 'tc' | 'tr' | 'cl' | 'cr' | 'bl' | 'bc' | 'br';
type Axis = 'x' | 'y' | 'both';

const PW = 512, PH = 384; // OsuPlayfield.BASE_SIZE

/** 选中物件参与缩放/包围盒的点: 单点 = 自身; 滑条 = 头 + 全部控制点; 转盘 = 无 (lazer selectedMovableObjects) */
export function movablePoints(objs: HitObject[]): Pt[] {
  const pts: Pt[] = [];
  for (const o of objs) {
    if (o.type === 'spinner') continue;
    pts.push({ x: o.x, y: o.y }, ...(o.curvePoints ?? []));
  }
  return pts;
}

/** 缩放参考包围盒 (lazer GeometryUtils.GetSurroundingQuad); 无可缩放点返回 null */
export function selectionScaleQuad(objs: HitObject[]): Quad | null {
  const pts = movablePoints(objs);
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 显示用包围盒: 位置包围盒按圆圈半径外扩 (lazer SelectionBox 取 blueprint SelectionQuad, 含物件视觉尺寸) */
export function displayQuad(q: Quad, radius: number): Quad {
  return { x: q.x - radius, y: q.y - radius, w: q.w + radius * 2, h: q.h + radius * 2 };
}

/**
 * lazer moveSelectionInBounds 的 GetSurroundingQuad(keys, startAndEndOnly: true):
 * 只含物件头 + 滑条路径末端 (enumerateStartAndEndPositions), 不含中间控制点。
 * 中间控制点允许超出游玩区 (节点编辑 v35 起不钳制), 若计入包围盒, 缩放更新会把整个选区
 * 误判越界并整体平移 — 拖下边时上边瞬移 (v51 修复)。路径末端用当前几何新建 SliderPath
 * 计算 (不用 getSliderPath 缓存 — 本函数在拖拽更新中、invalidate 之前调用, 缓存是上一帧几何)。
 */
export function selectionStartEndQuad(objs: HitObject[]): Quad | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  const add = (p: Pt) => {
    n++;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const o of objs) {
    if (o.type === 'spinner') continue;
    add({ x: o.x, y: o.y });
    if (o.type === 'slider') {
      const path = new SliderPath(o.curveType ?? 'L', [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])], o.length ?? 100);
      add(path.positionAt(o.length ?? path.totalLength)); // lazer: h.Position + path.PositionAt(1)
    }
  }
  return n ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

/**
 * 显示用选中框 (v52): lazer SelectionHandler.Update — 各选中 blueprint SelectionQuad 的 union 再 Inflate(5)。
 * SliderSelectionBlueprint.SelectionQuad = SliderBodyPiece (整条路径实体, 含路径半径) ∪ 头/尾圆 ∪ 控制点手柄,
 * 因此三点圆弧 (P) 的弧身鼓出部分也必须包住 — 不能只包控制点 (v52 修复)。
 * 实现: 滑条取 getSliderPath 采样折线 (等距 0.5px, 即渲染同一条中心线) 的包围盒;
 * 全部物件统一外扩圆圈半径 (滑条身粗 = 圆圈粗) + lazer INFLATE_SIZE=5。
 * 注意: 这只是"显示/手柄"盒; 缩放数学参考盒仍是控制点盒 (OriginalSurroundingQuad, selectionScaleQuad)。
 */
export const SELECTION_BOX_INFLATE = 5; // lazer SelectionHandler.INFLATE_SIZE
export function selectionDisplayQuad(bm: Beatmap, objs: HitObject[], radius: number): Quad | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  const add = (p: Pt) => {
    n++;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const o of objs) {
    if (o.type === 'spinner') continue; // 与缩放参考盒口径一致 (v50: 转盘不参与选中框)
    if (o.type === 'slider') {
      const path = getSliderPath(bm, o);
      for (const p of path.points) add(p);
    } else add({ x: o.x, y: o.y });
  }
  if (!n) return null;
  const r = radius + SELECTION_BOX_INFLATE;
  return { x: minX - r, y: minY - r, w: maxX - minX + r * 2, h: maxY - minY + r * 2 };
}

/** 可用的手柄锚点 (lazer updateState: CanScaleX = 宽>0, CanScaleY = 高>0, 角 = 两者兼有) */
export function scaleHandleAnchors(q: Quad): ScaleAnchor[] {
  const canX = q.w > 0, canY = q.h > 0;
  const out: ScaleAnchor[] = [];
  if (canY) out.push('tc', 'bc');
  if (canX && canY) out.push('tl', 'tr', 'bl', 'br');
  if (canX) out.push('cl', 'cr');
  return out;
}

/** 锚点在包围盒上的位置 */
export function anchorPoint(q: Quad, a: ScaleAnchor): Pt {
  const x = a.includes('l') ? q.x : a.includes('r') ? q.x + q.w : q.x + q.w / 2;
  const y = a[0] === 't' ? q.y : a[0] === 'b' ? q.y + q.h : q.y + q.h / 2;
  return { x, y };
}

/** 手柄命中 (就近优先, tol 为 osu px) */
export function hitScaleHandle(gateQ: Quad, dispQ: Quad, p: Pt, tol: number): ScaleAnchor | null {
  let best: ScaleAnchor | null = null, bestD = tol;
  for (const a of scaleHandleAnchors(gateQ)) {
    const hp = anchorPoint(dispQ, a);
    const d = Math.hypot(hp.x - p.x, hp.y - p.y);
    if (d <= bestD) { best = a; bestD = d; }
  }
  return best;
}

const isCorner = (a: ScaleAnchor) => a.length === 2 && a[1] !== 'c';

/** 手柄对应的缩放轴 (lazer getAdjustAxis): 上下边 -> Y, 左右边 -> X, 角 -> Both */
export function anchorAxis(a: ScaleAnchor): Axis {
  if (a === 'tc' || a === 'bc') return 'y';
  if (a === 'cl' || a === 'cr') return 'x';
  return 'both';
}

/** lazer convertDragEventToScaleMultiplier + adjustScaleFromAnchor (+ 角手柄 Shift 锁长宽比) */
export function dragToScale(anchor: ScaleAnchor, quadW: number, quadH: number, dx: number, dy: number, shiftLock: boolean): Pt {
  let sx = dx, sy = dy;
  // 边手柄清掉不关心的轴 (x1 = 水平居中 -> tc/bc 不清 X 位移? 注意 lazer Anchor 位: x1=水平居中, y1=垂直居中)
  if (anchor === 'tc' || anchor === 'bc') sx = 0;
  if (anchor === 'cl' || anchor === 'cr') sy = 0;
  // 上/左边手柄方向取反 (向左/上拖 = 放大)
  if (anchor.includes('l')) sx = -sx;
  if (anchor[0] === 't') sy = -sy;
  sx = Math.abs(quadW) < 1e-9 ? 0 : sx / quadW;
  sy = Math.abs(quadH) < 1e-9 ? 0 : sy / quadH;
  sx += 1; sy += 1;
  if (shiftLock && isCorner(anchor)) {
    const m = (sx + sy) * 0.5;
    sx = m; sy = m;
  }
  return { x: sx, y: sy };
}

/** 缩放原点 = 手柄的对角/对边锚点 (lazer originalAnchor.Opposite().PositionOnQuad) */
export function anchorOpposite(q: Quad, a: ScaleAnchor): Pt {
  const opp: Record<ScaleAnchor, ScaleAnchor> = {
    tl: 'br', tc: 'bc', tr: 'bl', cl: 'cr', cr: 'cl', bl: 'tr', bc: 'tc', br: 'tl',
  };
  return anchorPoint(q, opp[a]);
}

/** 最小包围圆圆心 (lazer MinimumEnclosingCircle, Welzl 算法; 默认原点 = 选区点的 MEC 圆心) */
export function minimumEnclosingCircleCenter(pts: Pt[]): Pt {
  if (!pts.length) return { x: 256, y: 192 };
  let c = { x: pts[0].x, y: pts[0].y, r: 0 };
  for (let i = 1; i < pts.length; i++) {
    if (Math.hypot(pts[i].x - c.x, pts[i].y - c.y) <= c.r + 1e-9) continue;
    c = { x: pts[i].x, y: pts[i].y, r: 0 };
    for (let j = 0; j < i; j++) {
      if (Math.hypot(pts[j].x - c.x, pts[j].y - c.y) <= c.r + 1e-9) continue;
      c = { x: (pts[i].x + pts[j].x) / 2, y: (pts[i].y + pts[j].y) / 2, r: Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) / 2 };
      for (let k = 0; k < j; k++) {
        if (Math.hypot(pts[k].x - c.x, pts[k].y - c.y) <= c.r + 1e-9) continue;
        c = circumcircle(pts[i], pts[j], pts[k]);
      }
    }
  }
  return { x: c.x, y: c.y };
}

function circumcircle(a: Pt, b: Pt, p: Pt): { x: number; y: number; r: number } {
  const d = 2 * (a.x * (b.y - p.y) + b.x * (p.y - a.y) + p.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) { // 共线: 取最远点对中点
    const pairs: [Pt, Pt][] = [[a, b], [a, p], [b, p]];
    let m: [Pt, Pt] = [a, b], md = -1;
    for (const pr of pairs) { const dd = Math.hypot(pr[0].x - pr[1].x, pr[0].y - pr[1].y); if (dd > md) { md = dd; m = pr; } }
    return { x: (m[0].x + m[1].x) / 2, y: (m[0].y + m[1].y) / 2, r: md / 2 };
  }
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, p2 = p.x * p.x + p.y * p.y;
  const x = (a2 * (b.y - p.y) + b2 * (p.y - a.y) + p2 * (a.y - b.y)) / d;
  const y = (a2 * (p.x - b.x) + b2 * (a.x - p.x) + p2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

/** lazer GeometryUtils.GetScaledPosition: origin + (p - origin) * scale */
export function scaledPosition(scale: Pt, origin: Pt, p: Pt): Pt {
  return { x: origin.x + (p.x - origin.x) * scale.x, y: origin.y + (p.y - origin.y) * scale.y };
}

// computeBounds (lazer ClampScaleToPlayfieldBounds 内嵌): p 经倍率 m 缩放后落在 [lower, upper] 的 m 区间
function computeBounds(lower: Pt, upper: Pt, p: Pt): [number, number] {
  let loX = lower.x / p.x, hiX = upper.x / p.x;
  if (p.x < 0) [loX, hiX] = [hiX, loX];
  if (Math.abs(p.x) < 1e-9) { loX = -Infinity; hiX = Infinity; }
  let loY = lower.y / p.y, hiY = upper.y / p.y;
  if (p.y < 0) [loY, hiY] = [hiY, loY];
  if (Math.abs(p.y) < 1e-9) { loY = -Infinity; hiY = Infinity; }
  return [Math.max(loX, loY), Math.min(hiX, hiY)];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** lazer ClampScaleToPlayfieldBounds (axisRotation=0): 钳制倍率使包围盒四角缩放后不出游玩区;
 *  axis=both 时保持 X/Y 比例 (按幅值钳制) */
export function clampScaleToPlayfield(scale: Pt, origin: Pt, quad: Quad, axis: Axis): Pt {
  let s = { x: scale.x, y: scale.y };
  if (axis === 'x') s.y = 1;
  else if (axis === 'y') s.x = 1;
  const lower = { x: 0 - origin.x, y: 0 - origin.y };
  const upper = { x: PW - origin.x, y: PH - origin.y };
  const corners: Pt[] = [
    { x: quad.x, y: quad.y }, { x: quad.x + quad.w, y: quad.y },
    { x: quad.x, y: quad.y + quad.h }, { x: quad.x + quad.w, y: quad.y + quad.h },
  ];
  for (const c of corners) {
    const p = { x: c.x - origin.x, y: c.y - origin.y };
    const a = { x: p.x, y: 0 }, b = { x: 0, y: p.y };
    if (axis === 'x') {
      const [lo, hi] = computeBounds({ x: lower.x - b.x, y: lower.y - b.y }, { x: upper.x - b.x, y: upper.y - b.y }, a);
      s.x = clamp(s.x, lo, hi);
    } else if (axis === 'y') {
      const [lo, hi] = computeBounds({ x: lower.x - a.x, y: lower.y - a.y }, { x: upper.x - a.x, y: upper.y - a.y }, b);
      s.y = clamp(s.y, lo, hi);
    } else {
      const q = { x: a.x * s.x + b.x * s.y, y: a.y * s.x + b.y * s.y };
      const [lo, hi] = computeBounds(lower, upper, q);
      s.x = s.x < 0 ? clamp(s.x, s.x * hi, s.x * lo) : clamp(s.x, s.x * lo, s.x * hi);
      s.y = s.y < 0 ? clamp(s.y, s.y * hi, s.y * lo) : clamp(s.y, s.y * lo, s.y * hi);
    }
  }
  return s;
}

/** 缩放拖拽开始时快照 (lazer OriginalHitObjectState: 位置 + 控制点 + 长度) */
export interface ScaleObjectState { x: number; y: number; curve: Pt[]; length: number }
export function snapshotScaleStates(objs: HitObject[]): Map<number, ScaleObjectState> {
  const m = new Map<number, ScaleObjectState>();
  for (const o of objs) {
    if (o.type === 'spinner') continue;
    m.set(o.id, { x: o.x, y: o.y, curve: (o.curvePoints ?? []).map(p => ({ ...p })), length: o.length ?? 0 });
  }
  return m;
}

/**
 * lazer OsuSelectionScaleHandler.Update: 从快照状态应用一次缩放 (每次鼠标移动都从 Begin 状态重算)。
 * originalQuad = Begin 时的位置包围盒 (lazer OriginalSurroundingQuad) — 钳制必须用它,
 * 用当前(已缩放)包围盒会把倍率压回去, 拖到一定程度"卡住" (v50 修复)。
 * 返回被改动几何的滑条 id (调用方负责 invalidatePath)。
 */
export function applyScaleDrag(
  bm: Beatmap, objs: HitObject[], states: Map<number, ScaleObjectState>,
  rawScale: Pt, origin: Pt, axis: Axis, beatSnap: number, originalQuad: Quad,
): { changed: boolean; sliders: number[] } {
  const movable = objs.filter(o => o.type !== 'spinner' && states.has(o.id));
  const sliders: number[] = [];
  // 单个滑条: 特殊分支 (lazer scaleSlider) — 控制点绕头缩放 + 节拍吸附, 出界/非法则回滚
  if (movable.length === 1 && movable[0].type === 'slider') {
    const o = movable[0];
    const st = states.get(o.id)!;
    const s = { x: Math.max(rawScale.x, 1e-6), y: Math.max(rawScale.y, 1e-6) }; // lazer: 滑条不允许镜像
    const head = scaledPosition(s, origin, { x: st.x, y: st.y });
    o.x = Math.round(head.x); o.y = Math.round(head.y);
    // 绝对坐标: 控制点 = 新头 + (原控制点 - 原头) * s (lazer: 相对控制点绕零缩放, 头绕原点缩放)
    o.curvePoints = st.curve.map(p => ({
      x: Math.round(head.x + (p.x - st.x) * s.x),
      y: Math.round(head.y + (p.y - st.y) * s.y),
    }));
    resnapSliderLength(bm, o, beatSnap); // lazer SnapTo: 长度按新几何吸附节拍
    sliders.push(o.id);
    // 头/控制点出游玩区或路径长度非法 -> 整体回滚 (lazer isQuadInBounds + HasValidLengthForPlacement)
    const pts = [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
    const inBounds = pts.every(p => p.x >= 0 && p.x <= PW && p.y >= 0 && p.y <= PH);
    const validLen = sliderGeometryLength(o.curveType ?? 'L', pts) > 0;
    if (inBounds && validLen) return { changed: true, sliders };
    o.x = st.x; o.y = st.y;
    o.curvePoints = st.curve.map(p => ({ ...p }));
    o.length = st.length;
    resnapSliderLength(bm, o, beatSnap); // 撤销上一次可能非法的吸附 (lazer 注释同款)
    return { changed: false, sliders };
  }
  // 多物件: 钳制到游玩区 -> 缩放位置 (滑条整体移动, 不缩路径) -> 越界整体移回
  const s = clampScaleToPlayfield(rawScale, origin, originalQuad, axis); // lazer: 钳制用 Begin 时的 OriginalSurroundingQuad
  let changed = false;
  for (const o of movable) {
    const st = states.get(o.id)!;
    const np = scaledPosition(s, origin, { x: st.x, y: st.y });
    const nx = Math.round(np.x), ny = Math.round(np.y);
    const dx = nx - st.x, dy = ny - st.y;
    if (o.x !== nx || o.y !== ny) changed = true;
    o.x = nx; o.y = ny;
    if (o.type === 'slider') {
      o.curvePoints = st.curve.map(p => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) }));
      sliders.push(o.id);
    }
  }
  // moveSelectionInBounds: 新包围盒越界则整体平移回界内 (lazer: startAndEndOnly — 只算头 + 滑条尾, v51)
  const nq = selectionStartEndQuad(movable);
  if (nq) {
    let dx = 0, dy = 0;
    if (nq.x < 0) dx -= nq.x;
    if (nq.y < 0) dy -= nq.y;
    if (nq.x + nq.w > PW) dx -= nq.x + nq.w - PW;
    if (nq.y + nq.h > PH) dy -= nq.y + nq.h - PH;
    if (dx || dy) {
      changed = true;
      for (const o of movable) {
        o.x += dx; o.y += dy;
        o.curvePoints?.forEach(p => { p.x += dx; p.y += dy; });
      }
    }
  }
  return { changed, sliders };
}

// ---- v50: 框可见性 / 旋转手柄 (lazer SelectionBoxRotationHandle + OsuSelectionRotationHandler) ----

/** 选中框是否显示 (v50: 仅选中一个单点或只选转盘时不显示边框;
 *  单滑条/多选显示 — 手柄可用性仍由 scaleHandleAnchors 控制) */
export function selectionBoxVisible(objs: HitObject[]): boolean {
  const movable = objs.filter(o => o.type !== 'spinner');
  if (!movable.length) return false; // 只选转盘 -> 无框
  if (movable.length === 1) return movable[0].type === 'slider'; // 单圆圈 -> 无框, 单滑条 -> 有框
  return true;
}

// 旋转手柄: lazer SelectionBoxDragHandleContainer — rotationHandles 容器 Padding -12.5 (四角外扩 12.5px),
// 手柄 15x15 (SelectionBoxRotationHandle.Size)
export const ROT_HANDLE_OUT = 12.5;
export const ROT_HANDLE_SIZE = 15;
export const ROT_SNAP_STEP = 15; // lazer snap_step (Shift 吸附 15°)

export type RotateCorner = 'tl' | 'tr' | 'bl' | 'br';

/** 四角旋转手柄位置 (显示框角点向外 12.5px/轴) */
export function rotationHandlePoints(dq: Quad): { corner: RotateCorner; x: number; y: number }[] {
  return [
    { corner: 'tl', x: dq.x - ROT_HANDLE_OUT, y: dq.y - ROT_HANDLE_OUT },
    { corner: 'tr', x: dq.x + dq.w + ROT_HANDLE_OUT, y: dq.y - ROT_HANDLE_OUT },
    { corner: 'bl', x: dq.x - ROT_HANDLE_OUT, y: dq.y + dq.h + ROT_HANDLE_OUT },
    { corner: 'br', x: dq.x + dq.w + ROT_HANDLE_OUT, y: dq.y + dq.h + ROT_HANDLE_OUT },
  ];
}

/** 旋转手柄命中 (就近优先, tol 为 osu px) */
export function hitRotationHandle(dq: Quad, p: Pt, tol: number): RotateCorner | null {
  let best: RotateCorner | null = null, bestD = tol;
  for (const h of rotationHandlePoints(dq)) {
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    if (d <= bestD) { best = h.corner; bestD = d; }
  }
  return best;
}

/** 拖拽角度增量 (lazer convertDragEventToAngleOfRotation: 绕原点两帧 atan2 之差, 角度制) */
export function angleDeltaDeg(origin: Pt, from: Pt, to: Pt): number {
  const a0 = Math.atan2(from.y - origin.y, from.x - origin.x);
  const a1 = Math.atan2(to.y - origin.y, to.x - origin.x);
  return (a1 - a0) * 180 / Math.PI;
}

/** lazer applyRotation: Shift 吸附 15° 步进, 否则取整; 归一化到 (-180, 180] */
export function snapRotation(rawDeg: number, snap: boolean): number {
  let r = snap ? Math.round(rawDeg / ROT_SNAP_STEP) * ROT_SNAP_STEP : Math.round(rawDeg);
  r = ((r + 360 + 180) % 360) - 180;
  if (Math.abs(r) === 180) r = 180;
  return r;
}

/** 旋转默认原点 (lazer OsuSelectionRotationHandler.Begin: MinimumEnclosingCircle(物件位置).圆心 — 只取头部) */
export function rotationOrigin(objs: HitObject[]): Pt {
  const pts = objs.filter(o => o.type !== 'spinner').map(o => ({ x: o.x, y: o.y }));
  return minimumEnclosingCircleCenter(pts);
}

/** lazer OsuSelectionRotationHandler.Update: 从 Begin 快照旋转 (头绕原点, 控制点绕头; 长度不变) */
export function applyRotateDrag(
  objs: HitObject[], states: Map<number, ScaleObjectState>, rotationDeg: number, origin: Pt,
): { changed: boolean; sliders: number[] } {
  const rad = rotationDeg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const rot = (p: Pt, c: Pt): Pt => ({
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos,
  });
  const sliders: number[] = [];
  let changed = rotationDeg !== 0;
  for (const o of objs) {
    if (o.type === 'spinner') continue;
    const st = states.get(o.id);
    if (!st) continue;
    const head = rot({ x: st.x, y: st.y }, origin);
    o.x = Math.round(head.x); o.y = Math.round(head.y);
    if (o.type === 'slider') {
      o.curvePoints = st.curve.map(p => ({
        x: Math.round(head.x + (p.x - st.x) * cos - (p.y - st.y) * sin),
        y: Math.round(head.y + (p.x - st.x) * sin + (p.y - st.y) * cos),
      }));
      sliders.push(o.id);
    }
  }
  return { changed, sliders };
}
