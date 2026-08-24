// ---- v217: 全局等比缩放 (App 根容器 CSS zoom) 共享参数 + canvas 适配工具 ----
// 基准 2560×1440, zoom = clamp(min(w/2560, h/1440), 0.6, 1); 单一系数 X/Y 等比不变形,
// 不等比余量由 flex-1 中间区吸收 (不留白)。
//
// canvas 适配要点: CSS zoom 下 getBoundingClientRect/clientX 返回"视觉 px"(已缩放),
// 而 canvas 内固定 px 绘制 (物件大圆/药丸/面板预留高度) 必须在"布局 px"(未缩放) 空间进行,
// 否则元素缩了内容不缩 (物件圆溢出) 或预留比例错 (游玩区与上下时间轴间距比例变化)。
// 统一约定: 绘制与命中都用 zoomRect (布局空间) + zoomClientX/Y (事件坐标转布局空间),
// 光栅 dpr 用 zoomDpr (= devicePixelRatio × zoom, backing store 精确等于屏幕物理像素, 不糊)。
import { useEffect, useState } from 'react';

export const DESIGN_W = 2560, DESIGN_H = 1440, UI_ZOOM_MIN = 0.6;

export function uiZoom(): number {
  return Math.max(UI_ZOOM_MIN, Math.min(1, Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H)));
}

export function useUiZoom(): number {
  const [z, setZ] = useState(uiZoom);
  useEffect(() => {
    const on = () => setZ(uiZoom());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return z;
}

/** 布局空间 rect (宽/高/left/top 均除以 zoom); 与 zoomClientX/Y 同坐标系 */
export interface LayoutRect { width: number; height: number; left: number; top: number }

export function zoomRect(el: Element): LayoutRect {
  const r = el.getBoundingClientRect();
  const z = uiZoom();
  return { width: r.width / z, height: r.height / z, left: r.left / z, top: r.top / z };
}

/** 鼠标事件 client 坐标 → 布局空间 */
export function zoomClientX(clientX: number): number { return clientX / uiZoom(); }
export function zoomClientY(clientY: number): number { return clientY / uiZoom(); }

/** canvas 光栅 dpr = devicePixelRatio × zoom (backing = 布局宽 × zoomDpr = 屏幕物理像素) */
export function zoomDpr(): number { return (window.devicePixelRatio || 1) * uiZoom(); }
