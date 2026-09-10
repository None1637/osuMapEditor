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

// ---- v225: 文本补偿缩放 — 控件尺寸仍按 uiZoom 线性缩, 文本按更缓的 sqrt 曲线缩 ----
// 小窗口下线性缩放把 12px 文本压到 7.2px 不可读; textZoom = clamp(√uiZoom, 0.8, 1):
// zoom=0.6 时文本仍保留 80% 字号 (视觉 9.6px 起), zoom=1 时恒 1 不影响原布局。
export const TEXT_ZOOM_MIN = 0.8;

export function textZoom(): number {
  return Math.max(TEXT_ZOOM_MIN, Math.min(1, Math.sqrt(uiZoom())));
}

/** 布局空间字号补偿系数 = textZoom/uiZoom (CSS 侧乘在原字号上, 视觉即 textZoom) */
export function textZoomComp(): number {
  return textZoom() / uiZoom();
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

// ---- v246: canvas backing 尺寸取整适配 ----
// r.width×dpr 常为分数 (zoom/dpr 分数), 旧代码 `c.width !== r.width * dpr` 拿整数 backing 与分数比,
// 几乎恒真 → 每帧重设 canvas 宽高 (位图重建 + 上下文状态重置 + GPU 纹理重传), 普通谱面也跑不满帧率。
// 统一 round 到整数像素, 并返回实际变换系数 sx/sy (= backing/布局, 替代 dpr, 保证映射精确无 1px 偏差)。
export function fitCanvas(c: HTMLCanvasElement, r: LayoutRect): { sx: number; sy: number } {
  const dpr = zoomDpr();
  const bw = Math.max(1, Math.round(r.width * dpr));
  const bh = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
  return { sx: bw / r.width, sy: bh / r.height };
}
