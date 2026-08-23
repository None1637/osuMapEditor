// 选区几何变换 (纯函数, 可单测): 旋转 / 水平垂直镜像 / 缩放, 围绕选区包围盒中心
// 规则 (对齐 lazer Compose 变换行为):
//  - 单点变换自身坐标; 滑条变换全部控制点 (curvePoints 为绝对坐标, 必须整体变换否则变形);
//  - 转盘位置固定 (256,192), 不参与任何位置变换, 也不计入包围盒;
//  - 缩放时滑条 pixelLength 同步乘系数 (几何路径与 length 保持一致, 否则滑条身被截断);
//  - 坐标写回取整; 不做游玩区钳制 (.osu 允许出界坐标, stable/lazer 变换也不钳制)。
import type { HitObject } from './parser';

export interface Pt { x: number; y: number }

/** 参与变换的点: 单点 = 自身; 滑条 = 头 + 全部控制点; 转盘 = 无 */
function objectPoints(o: HitObject): Pt[] {
  if (o.type === 'slider') return [{ x: o.x, y: o.y }, ...(o.curvePoints ?? [])];
  if (o.type === 'circle') return [{ x: o.x, y: o.y }];
  return [];
}

/** 选区包围盒中心 (含滑条控制点); 选区无有效点时返回 null (如只选了转盘) */
export function selectionCenter(objs: HitObject[]): Pt | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  for (const o of objs) for (const p of objectPoints(o)) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    n++;
  }
  return n ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null;
}

/** 对物件逐个应用点变换 (原地写回, 坐标取整); 返回被改动的滑条 (调用方负责 invalidatePath) */
function transformObjects(objs: HitObject[], fn: (p: Pt) => Pt): HitObject[] {
  const sliders: HitObject[] = [];
  for (const o of objs) {
    if (o.type === 'spinner') continue;
    const h = fn(o);
    o.x = Math.round(h.x);
    o.y = Math.round(h.y);
    if (o.type === 'slider') {
      for (const p of o.curvePoints ?? []) {
        const q = fn(p);
        p.x = Math.round(q.x);
        p.y = Math.round(q.y);
      }
      sliders.push(o);
    }
  }
  return sliders;
}

/** 旋转 (角度制, 顺时针为正 —— 屏幕坐标 y 向下) */
export function rotateObjects(objs: HitObject[], c: Pt, deg: number): HitObject[] {
  const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  return transformObjects(objs, p => ({
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos,
  }));
}

/** 镜像: 'h' = 水平翻转 (左右, x 对换), 'v' = 垂直翻转 (上下, y 对换) */
export function flipObjects(objs: HitObject[], c: Pt, axis: 'h' | 'v'): HitObject[] {
  return axis === 'h'
    ? transformObjects(objs, p => ({ x: 2 * c.x - p.x, y: p.y }))
    : transformObjects(objs, p => ({ x: p.x, y: 2 * c.y - p.y }));
}

/** 等比缩放 (滑条 pixelLength 同步乘 s) */
export function scaleObjects(objs: HitObject[], c: Pt, s: number): HitObject[] {
  const sliders = transformObjects(objs, p => ({ x: c.x + (p.x - c.x) * s, y: c.y + (p.y - c.y) * s }));
  for (const o of sliders) o.length = Math.max(1, Math.round((o.length ?? 0) * s));
  return sliders;
}

/** v210: 关于直线的对称镜像 (编辑菜单「对称...」): p1/p2 = 对称轴上两点; 两点重合时不动作 (返回空) */
export function reflectObjectsAcrossLine(objs: HitObject[], p1: Pt, p2: Pt): HitObject[] {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return [];
  // 点 p 关于直线的镜像: 垂足 q = p1 + d·((p−p1)·d/|d|²), 像 = 2q − p
  return transformObjects(objs, p => {
    const t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / len2;
    const qx = p1.x + t * dx, qy = p1.y + t * dy;
    return { x: 2 * qx - p.x, y: 2 * qy - p.y };
  });
}

export interface Rect { minX: number; minY: number; maxX: number; maxY: number }

/** 框选: 位置落在矩形内的物件 id (滑条取头部; 转盘固定在游玩区中心); offsets = 堆叠后显示偏移 (传入则按显示位置命中) */
export function objectsInRect(objs: HitObject[], r: Rect, offsets?: Map<number, { dx: number; dy: number }>): number[] {
  const out: number[] = [];
  for (const o of objs) {
    const p = o.type === 'spinner' ? { x: 256, y: 192 } : o;
    const off = offsets?.get(o.id);
    const x = p.x + (off?.dx ?? 0), y = p.y + (off?.dy ?? 0);
    if (x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY) out.push(o.id);
  }
  return out;
}
