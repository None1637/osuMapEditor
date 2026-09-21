// ---- v217: 全局等比缩放 (App 根容器 CSS zoom) 共享参数 + canvas 适配工具 ----
// 基准 2560×1440, zoom = clamp(min(w/2560, h/1440), 0.6, 1); 单一系数 X/Y 等比不变形,
// 不等比余量由 flex-1 中间区吸收 (不留白)。
//
// canvas 适配要点: CSS zoom 下 getBoundingClientRect/clientX 返回"视觉 px"(已缩放),
// 而 canvas 内固定 px 绘制 (物件大圆/药丸/面板预留高度) 必须在"布局 px"(未缩放) 空间进行,
// 否则元素缩了内容不缩 (物件圆溢出) 或预留比例错 (游玩区与上下时间轴间距比例变化)。
// 统一约定: 绘制与命中都用 zoomRect (布局空间) + zoomClientX/Y (事件坐标转布局空间),
// 光栅 dpr 用 zoomDpr (= devicePixelRatio × zoom, backing store 精确等于屏幕物理像素, 不糊)。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

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

// v264: zoomRect 缓存 — getBoundingClientRect 强制样式/布局计算, 节点拖动期间每 mousemove + 每帧
// 多次调用是实测热点 (~0.5s/3.4s)。画布为 v129 浮层布局, rect 只在窗口 resize/scroll 时变化,
// 故按元素缓存 + resize/scroll 事件失效 + 2s TTL 兜底。
const rectCache = new WeakMap<Element, { r: LayoutRect; epoch: number; t: number }>();
let rectEpoch = 0;
if (typeof window !== 'undefined') {
  const bump = () => { rectEpoch++; };
  window.addEventListener('resize', bump);
  window.addEventListener('scroll', bump, true);
}

export function zoomRect(el: Element): LayoutRect {
  const now = performance.now();
  const hit = rectCache.get(el);
  if (hit && hit.epoch === rectEpoch && now - hit.t < 2000) return hit.r;
  const r = el.getBoundingClientRect();
  const z = uiZoom();
  const out = { width: r.width / z, height: r.height / z, left: r.left / z, top: r.top / z };
  rectCache.set(el, { r: out, epoch: rectEpoch, t: now });
  return out;
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

// ---- v249: 独立窗口抗全局缩放 ----
// v217 的 CSS zoom 把 DraggableDialog 等独立窗口一并缩小, 分辨率降低后窗口文字/控件难用。
// 独立窗口改为反缩放 (自身 zoom c = fit/z): 分辨率缩小时保持自然大小; 仅当视口比窗口自然尺寸
// 还小 (fit<1) 时才等比缩小到能放下。
// 坐标系注意 (Chromium 150 实测, verifier/v249/el-zoom-probe.mjs): fixed/absolute 元素的 left/top
// 与宽高一样被 祖先 zoom × 自身 zoom 连乘 → 定位/位移补偿都要除以 z*c (= fit)。

/** 视口容纳系数 (纯函数): 自然视觉尺寸 natW×natH 能放下 (留 8px 边距) 则 1, 否则等比缩小 */
export function dialogFit(natW: number, natH: number, vw: number, vh: number): number {
  return Math.min(1, (vw - 8) / natW, (vh - 8) / natH);
}

/** 模态框 (flex 居中遮罩内 box) 反缩放 hook: ref 元素保持自然视觉大小, 视口放不下时等比缩小。
 *  用法: const { ref, style } = useCounterZoom(); <div ref={ref} style={style}>
 *  style 含 zoom=c、flex 居中偏移补偿 (反缩放后缩放中心在元素左上, 实测中心差换算布局 px 经
 *  transform 补回视口中心, 1-2 次迭代收敛) 与 --fs-comp:1 (反缩放已恢复自然字号, 覆盖 v225 文本补偿) */
export function useCounterZoom<T extends HTMLElement = HTMLDivElement>() {
  const z = useUiZoom();
  const ref = useRef<T | null>(null);
  const [st, setSt] = useState({ fit: 1, tx: 0, ty: 0 });
  const c = st.fit / z;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const k = z * c; // 视觉 = 布局 × k (当前 fit)
    const f = dialogFit(r.width / k, r.height / k, window.innerWidth, window.innerHeight);
    const tx = st.tx + (window.innerWidth / 2 - (r.left + r.width / 2)) / k;
    const ty = st.ty + (window.innerHeight / 2 - (r.top + r.height / 2)) / k;
    if (Math.abs(f - st.fit) > 0.001 || Math.abs(tx - st.tx) > 0.5 || Math.abs(ty - st.ty) > 0.5)
      setSt({ fit: f, tx, ty });
  });
  return {
    ref,
    style: { zoom: c, transform: `translate(${st.tx}px, ${st.ty}px)`, '--fs-comp': 1 } as CSSProperties,
  };
}
