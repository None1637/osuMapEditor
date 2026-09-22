// v280: 应用内菜单栏 — hideTitleBar (titleBarStyle:'hidden'/WCO) 下 Windows 不渲染原生菜单栏
// (v279 实测 autoHideMenuBar/setMenuBarVisibility 均无效), 改为渲染端自绘菜单条 (VS Code 同款方案);
// 菜单定义来自主进程 buildMenu 模板序列化 (getMenuDefinition 初始拉取 + onMenuDefinition 推送更新),
// 点击叶子项 menuItemClick(id) 回传主进程查表执行 (click 闭包 / role 等价实现);
// 原生菜单仍 setApplicationMenu (accelerator 全局快捷键不受影响)。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getElectronAPI, type ElectronMenuNode } from '@/osu/electronBridge';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

// v281: overlay = hideTitleBar 模式 (WCO 窗口按钮覆盖本行右侧, 需拖拽区 + 留白 140);
// 非隐藏模式 (原生标题栏仍在窗口上方) 下不需拖拽区/留白
export function MenuBar({ overlay }: { overlay: boolean }) {
  const [def, setDef] = useState<ElectronMenuNode[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    let alive = true;
    api.getMenuDefinition().then(d => { if (alive && d) setDef(d); }); // 首次 buildMenu 早于页面加载, 主动拉取
    return api.onMenuDefinition(d => setDef(d)); // 此后每次 buildMenu (菜单状态变化) 推送
  }, []);
  // 点击外部 / Esc 关闭下拉
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!def) return null;
  const api = getElectronAPI()!;
  const fmtAccel = (a?: string) => (a ? a.replace(/CmdOrCtrl/g, 'Ctrl') : '');

  const renderItems = (items: ElectronMenuNode[]) => (
    <div className="min-w-52 py-1">
      {items.map((it, i) => {
        if (it.type === 'separator') return <div key={i} className="my-1 border-t border-white/10" />;
        const dis = it.enabled === false;
        if (it.submenu) {
          return (
            <div key={i} className="relative group">
              <div className={`flex items-center px-3 py-1 text-[13px] whitespace-nowrap ${dis ? 'text-white/30' : 'text-white/85 group-hover:bg-white/10'}`}>
                <span className="flex-1">{it.label}</span>
                <span className="ml-4 text-white/40">▸</span>
              </div>
              {!dis && (
                <div className="hidden group-hover:block absolute left-full top-0 bg-[#1b1b24] border border-white/15 rounded shadow-xl z-50">
                  {renderItems(it.submenu)}
                </div>
              )}
            </div>
          );
        }
        return (
          <button key={i} disabled={dis} data-menu-item={it.id}
            onClick={() => { if (it.id) { api.menuItemClick(it.id); setOpen(null); } }}
            className={`w-full flex items-center px-3 py-1 text-[13px] text-left whitespace-nowrap ${dis ? 'text-white/30' : 'text-white/85 hover:bg-white/10'}`}>
            <span className="w-4 shrink-0 flex items-center justify-center">
              {/* 勾选态用 CSS 图形 (v181: src 内不用符号字符); radio=实心圆点 / checkbox=对勾色块 */}
              {it.checked && <span className={`inline-block w-2 h-2 ${it.type === 'radio' ? 'rounded-full' : 'rounded-sm'} bg-cyan-300`} />}
            </span>
            <span className="flex-1">{it.label}</span>
            <span className="ml-6 text-white/40 text-[11px]">{fmtAccel(it.accelerator)}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={rootRef} data-menu-bar
      className="relative flex items-stretch h-7 shrink-0 select-none text-[13px] text-white/85"
      style={overlay
        ? { ...DRAG, paddingRight: 140, background: 'rgba(16,16,22,0.85)' } // 窗口顶行: overlay 窗口按钮覆盖本行右侧, 留白 140 避开 (页签栏在 overlay 区域外, 不需留白)
        : { background: 'rgba(16,16,22,0.85)' }}>{/* v281: 非隐藏模式有原生标题栏, 本行纯菜单条 */}
      {def.map((top, i) => (
        <div key={i} className="relative flex items-stretch">
          <button data-menu-top={top.label}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => { if (open !== null && open !== i) setOpen(i); }} // 已打开时 hover 切换 (原生菜单行为)
            className={`px-2.5 ${open === i ? 'bg-white/15' : 'hover:bg-white/10'}`}
            style={NO_DRAG}>
            {top.label}
          </button>
          {open === i && top.submenu && (
            <div className="absolute left-0 top-full bg-[#1b1b24] border border-white/15 rounded shadow-xl z-50" style={NO_DRAG}>
              {renderItems(top.submenu)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
