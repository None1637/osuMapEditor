// 位置网格吸附 (v56): 对齐 lazer
//   osu.Game/Screens/Edit/Compose/Components/PositionSnapGrid.cs            (基类, GetSnappedPosition)
//   osu.Game/Screens/Edit/Compose/Components/RectangularPositionSnapGrid.cs (正方形: 旋转 + 逐轴取整)
//   osu.Game/Screens/Edit/Compose/Components/TriangularPositionSnapGrid.cs  (三角形: pixelToHex/hexToPixel)
//   osu.Game/Screens/Edit/Compose/Components/CircularPositionSnapGrid.cs    (圆形: 半径取整)
//   osu.Game.Rulesets.Osu/Edit/OsuGridToolboxGroup.cs                       (参数范围/旋转归一/GridSize 读写)
//   osu.Game/Utils/GeometryUtils.cs:43 RotateVector                         (旋转公式逐行移植)
// 规则:
//  - 原点默认游玩区中心 (256,192); 间距 = [Editor] GridSize (lazer 读初始值并写回), 范围 4..256;
//  - 旋转仅正方形/三角形 (圆形禁用): 切换类型时按周期归一 (正方形 90° -> ±45, 三角形 60° -> ±30);
//  - 吸附优先级: 物件吸附 > 距离吸附 > 位置网格 (网格最后应用并覆盖结果, lazer TryMoveBlueprints);
//  - 网格结果钳制回游玩区 (lazer TrySnapToPositionGrid: 网格不完美贴合游玩区时结果可能出界)。
export interface Pt { x: number; y: number }

export type GridType = 'square' | 'triangle' | 'circle' | 'none'; // v119: none = 无网格 (显示/吸附全关, 贴近游玩表现)

export const GRID_ORIGIN: Pt = { x: 256, y: 192 }; // lazer 默认 StartPosition = OsuPlayfield.BASE_SIZE / 2
export const GRID_SPACING_MIN = 4;   // lazer GridLineSpacing.MinValue
export const GRID_SPACING_MAX = 256; // lazer GridLineSpacing.MaxValue

const PW = 512, PH = 384;

/** lazer GeometryUtils.RotateVector (角度制) */
export function rotateVector(v: Pt, angleDeg: number): Pt {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { x: v.x * cos + v.y * sin, y: -v.x * sin + v.y * cos };
}

/** lazer OsuGridToolboxGroup.normalizeRotation: 归一到 [-period/2, period/2) */
export function normalizeRotation(rotation: number, period: number): number {
  return ((rotation + 360 + period * 0.5) % period) - period * 0.5;
}

/** 类型切换时的旋转周期 (lazer: 正方形 90 / 三角形 60; 圆形无旋转) */
export function rotationPeriod(type: GridType): number | null {
  if (type === 'square') return 90;
  if (type === 'triangle') return 60;
  return null;
}

/** 正方形 (lazer RectangularPositionSnapGrid.GetSnappedPosition): 旋转后逐轴按间距取整再转回 */
export function snapSquare(p: Pt, start: Pt, spacing: number, rotationDeg: number): Pt {
  const rel = rotateVector({ x: p.x - start.x, y: p.y - start.y }, rotationDeg);
  const rounded = { x: Math.round(rel.x / spacing) * spacing, y: Math.round(rel.y / spacing) * spacing };
  const back = rotateVector(rounded, -rotationDeg);
  return { x: start.x + back.x, y: start.y + back.y };
}

// ---- 三角形 (lazer TriangularPositionSnapGrid: 六边形网格) ----
const SQRT3 = Math.sqrt(3);

/** lazer pixelToHex (Charles Chambers / Chris Cox 算法) */
export function pixelToHex(pixel: Pt, spacing: number): { q: number; r: number } {
  const x = pixel.x / spacing, y = pixel.y / spacing;
  const t = SQRT3 * y + 1;
  const temp1 = Math.floor(t + x);
  const temp2 = t - x;
  const temp3 = 2 * x + 1;
  return { q: Math.floor((temp1 + temp3) / 3), r: Math.floor((temp1 + temp2) / 3) };
}

/** lazer hexToPixel (redblobgames hexagons, 按 lazer 的 size 定义调整) */
export function hexToPixel(q: number, r: number, spacing: number): Pt {
  return { x: spacing * (q - r / 2), y: spacing * (1 / SQRT3) * 1.5 * r };
}

/** 三角形 (lazer GetSnappedPosition): 旋转 -> pixelToHex -> hexToPixel -> 转回 */
export function snapTriangle(p: Pt, start: Pt, spacing: number, rotationDeg: number): Pt {
  const rel = rotateVector({ x: p.x - start.x, y: p.y - start.y }, rotationDeg);
  const hex = pixelToHex(rel, spacing);
  const pix = hexToPixel(hex.q, hex.r, spacing);
  const back = rotateVector(pix, -rotationDeg);
  return { x: start.x + back.x, y: start.y + back.y };
}

/** 圆形 (lazer CircularPositionSnapGrid.GetSnappedPosition): 到原点距离按间距取整, 方向不变 */
export function snapCircle(p: Pt, start: Pt, spacing: number): Pt {
  const rx = p.x - start.x, ry = p.y - start.y;
  const lenSq = rx * rx + ry * ry;
  if (lenSq < 1e-6) return { ...start }; // lazer Precision.FLOAT_EPSILON
  const len = Math.sqrt(lenSq);
  const wanted = Math.round(len / spacing) * spacing;
  const k = wanted / len;
  return { x: start.x + rx * k, y: start.y + ry * k };
}

/** 按类型吸附 + 钳制回游玩区 (lazer TrySnapToPositionGrid 的 Clamp); v119: 'none' 直接返回 (不吸附) */
export function snapToGrid(p: Pt, type: GridType, start: Pt, spacing: number, rotationDeg: number, clampToPlayfield = true): Pt {
  if (!(spacing > 0) || type === 'none') return p;
  let r: Pt;
  if (type === 'square') r = snapSquare(p, start, spacing, rotationDeg);
  else if (type === 'triangle') r = snapTriangle(p, start, spacing, rotationDeg);
  else r = snapCircle(p, start, spacing);
  // v163: clampToPlayfield=false (关闭"限制物件在游玩区域内") 时不钳制, 允许出游玩区
  return clampToPlayfield ? { x: Math.max(0, Math.min(PW, r.x)), y: Math.max(0, Math.min(PH, r.y)) } : r;
}

// ---- 渲染辅助 (lazer CreateContent 的线族/圆族参数) ----

/** 正方形线族法向 (lazer: (0,±spacing) 与 (±spacing,0) 两组旋转); 线间距 = spacing */
export function squareNormals(rotationDeg: number): Pt[] {
  return [rotateVector({ x: 0, y: 1 }, rotationDeg), rotateVector({ x: 1, y: 0 }, rotationDeg)];
}

/** 三角形线族法向 (lazer: stepSpacing = spacing*sqrt3/2, 方向 -30/-90/-150 - rotation); 线间距 = stepSpacing */
export function triangleGrid(spacing: number, rotationDeg: number): { normals: Pt[]; lineSpacing: number } {
  const step = spacing * SQRT3 / 2;
  const normals = [-30, -90, -150].map(a => {
    const v = rotateVector({ x: 1, y: 0 }, -rotationDeg + a);
    return v;
  });
  return { normals, lineSpacing: step };
}
