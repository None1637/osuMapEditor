// 可拖动的参数窗口 (F1-F4 转换功能共用): 标题栏拖拽移动, 右上角关闭
// v85: 打开时显示在视口正中央 (挂载后按实测宽高居中一次, 之后拖拽不再复位)
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { X } from 'lucide-react'; // v181: 关闭按钮 emoji ✕ → lucide

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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el && pos === null) {
      const r = el.getBoundingClientRect();
      setPos(dialogCenterPos(window.innerWidth, window.innerHeight, r.width, r.height));
    }
  }, [pos]);

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
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, width }} data-dialog={testid}>
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
export function DraftNum({ value, set, testid, min, max, step = 1 }: {
  value: number; set: (v: number) => void; testid: string; min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  return (
    <input type="number" value={draft ?? value} min={min} max={max} step={step} data-conv={testid}
      onFocus={() => setDraft(String(value))}
      onChange={e => {
        setDraft(e.target.value);
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) set(clamp(v));
      }}
      onBlur={() => setDraft(null)}
      className="w-20 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-white" />
  );
}
