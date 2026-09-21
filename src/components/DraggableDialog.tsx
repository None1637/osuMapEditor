// 可拖动的参数窗口 (F1-F4 转换功能共用): 标题栏拖拽移动, 右上角关闭
// v85: 打开时显示在视口正中央 (挂载后按实测宽高居中一次, 之后拖拽不再复位)
// v249: 抗全局缩放 — 分辨率缩小 (v217 zoom<1) 时窗口保持自然大小, 仅视口比窗口自然尺寸
//   还小才等比缩小容纳 (dialogFit)。自身 zoom c = fit/z; 定位 pos 用视觉 px,
//   left = pos/fit (Chromium 中 left/top 与宽高一样被 祖先zoom×自身zoom 连乘)。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent } from 'react';
import { X } from 'lucide-react'; // v181: 关闭按钮 emoji ✕ → lucide
import { dialogFit, useUiZoom } from '../osu/uiZoom';

/** 居中落点 (纯函数): 视口 (vw,vh) 内放 (w,h) 窗口的左上角, 负值钳 0 */
export function dialogCenterPos(vw: number, vh: number, w: number, h: number) {
  return { x: Math.max(0, Math.round((vw - w) / 2)), y: Math.max(0, Math.round((vh - h) / 2)) };
}

export function DraggableDialog({ title, onClose, children, width = 300, testid }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  testid?: string;
}) {
  const z = useUiZoom();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // v249: 视觉 px
  const [fit, setFit] = useState(1); // v249: 视口容纳系数 (1 = 自然大小)
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const c = fit / z; // 自身反缩放系数; 视觉 = 布局 × z × c = 布局 × fit

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect(); // 视觉 px = 布局 × fit
    const f = dialogFit(r.width / fit, r.height / fit, window.innerWidth, window.innerHeight);
    if (Math.abs(f - fit) > 0.001) { setFit(f); return; } // fit 变化后下轮再定位 (视觉尺寸随之变)
    if (pos === null) {
      setPos(dialogCenterPos(window.innerWidth, window.innerHeight, r.width, r.height));
    } else {
      // 窗口 resize 后钳回视口内 (拖过的位置不再复位, 只保证不丢到屏外)
      const cx = Math.max(0, Math.min(pos.x, window.innerWidth - r.width));
      const cy = Math.max(0, Math.min(pos.y, window.innerHeight - r.height));
      if (Math.abs(cx - pos.x) > 0.5 || Math.abs(cy - pos.y) > 0.5) setPos({ x: cx, y: cy });
    }
  });

  const onPointerDown = (e: PointerEvent) => {
    if (!pos) return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (d) setPos({ x: Math.max(0, e.clientX - d.dx), y: Math.max(0, e.clientY - d.dy) });
  };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div ref={boxRef} className="fixed z-40 rounded-lg border border-white/20 bg-[#1b1b24] shadow-2xl text-xs text-white/85"
      style={{ left: pos ? pos.x / fit : -9999, top: pos ? pos.y / fit : -9999, width, zoom: c, '--fs-comp': 1 } as CSSProperties} data-dialog={testid}>
      <div className="flex items-center justify-between px-3 py-2 rounded-t-lg bg-[#252532] cursor-move select-none font-bold text-white/90"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <span>{title}</span>
        <button onClick={onClose} className="px-1.5 rounded hover:bg-white/15 text-white/60 hover:text-white flex items-center" title="关闭 (不应用)"><X className="w-3.5 h-3.5" /></button>
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

/** 转换参数持久化 (localStorage, 记录上次设置) */
export function loadParams<T>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem('osu-editor:conv:' + key);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* 损坏则回退默认 */ }
  return { ...defaults };
}
export function saveParams<T>(key: string, v: T) {
  try { localStorage.setItem('osu-editor:conv:' + key, JSON.stringify(v)); } catch { /* 配额满忽略 */ }
}

/** v242: 窗口关闭 (组件卸载) 时保存参数 — 应用/取消/右上角关窗统一覆盖, 不再只在点「应用」时保存;
 *  ref 跟随最新值, 卸载 cleanup 落盘 (应用按钮的即时 saveParams 保留, 双写无害) */
export function useSaveParamsOnClose<T>(key: string, v: T) {
  const ref = useRef(v);
  ref.current = v;
  useEffect(() => () => saveParams(key, ref.current), [key]);
}

/** v40: 数字输入 (草稿态) — 聚焦期间保留原始文本, 全选重打不被 clamp/格式化打断;
 *  每次击键仍实时 set (驱动预览), 失焦回显最终值 */
/** v258: Adobe 式拖动调值 — 按住输入框水平拖动改数值 (v269: 默认 5px = 1 step, 原 1px 太敏感;
 *  Shift ×10, Alt ×0.1); 超过 3px 阈值才进入拖动 (不影响点击聚焦/正常选字), 拖动期间阻止文本选择 */
/** v276: 已聚焦的输入框内按下拖动 = 原生文本框选, 不触发调值 (用户反馈「框选输入框中数字时
 *  不要触发左右拖动数值」); 调值只在未聚焦的输入框上按下拖动 (= 点击即聚焦的那次交互) */
export function DraftNum({ value, set, testid, min, max, step = 1 }: {
  value: number; set: (v: number) => void; testid: string; min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const dragRef = useRef<{ x0: number; v0: number; active: boolean } | null>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  // 按 step 的小数位取整, 避免 0.1 步进累出 0.30000000004
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const round = (v: number) => { const p = 10 ** decimals; return Math.round(v * p) / p; };
  return (
    <input type="number" value={draft ?? value} min={min} max={max} step={step} data-conv={testid}
      onFocus={() => setDraft(String(value))}
      onChange={e => {
        setDraft(e.target.value);
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) set(clamp(v));
      }}
      onBlur={() => setDraft(null)}
      onPointerDown={e => {
        if (e.button !== 0) return;
        if (document.activeElement === e.currentTarget) return; // v276: 已聚焦 → 拖动留给文本框选
        dragRef.current = { x0: e.clientX, v0: value, active: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        const d = dragRef.current;
        if (!d || !(e.buttons & 1)) return;
        const dx = e.clientX - d.x0;
        if (!d.active) {
          if (Math.abs(dx) < 3) return;
          d.active = true;
          e.currentTarget.style.cursor = 'ew-resize';
        }
        e.preventDefault(); // 拖动期间不做文本选择
        const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        const v = clamp(round(d.v0 + (dx / 5) * step * mult)); // v269: 5px = 1 step (原 1px 太敏感)
        setDraft(String(v)); // 聚焦态显示走 draft, 拖动时同步刷新
        set(v);
      }}
      onPointerUp={e => {
        const d = dragRef.current;
        dragRef.current = null;
        if (d?.active) {
          e.currentTarget.style.cursor = '';
          setDraft(null);
          e.currentTarget.blur(); // 拖动结束退出草稿态, 回显最终值
        }
      }}
      className="w-20 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white" />
  );
}
