import { useEffect, useState } from 'react';
import { DraggableDialog } from './DraggableDialog';
import { store, useEditor } from '@/osu/store';
import {
  HOTKEY_ACTIONS,
  comboFromEvent,
  comboFromMouseEvent,
  effectiveBindings,
  findConflict,
  formatCombo,
  isHotkeyOverridden,
  resetAllHotkeys,
  setHotkeyCapture,
  setHotkeyOverride,
} from '@/osu/hotkeys';

/** v286: 快捷键设置面板 —— 列出全部可改键动作，点击绑定进入捕获态自定义改键。 */
export function HotkeyPanel() {
  useEditor(); // 订阅 store (面板开关变化时重渲染)
  const [capture, setCapture] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ id: string; name: string } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!capture) return;
    setHotkeyCapture(true);
    // v289: 键盘/鼠标按键统一结算 (冲突红字提示且不改键)
    const settle = (combo: string | null) => {
      if (!combo) return; // 纯修饰键/未知鼠标键, 继续等待
      const other = findConflict(combo, capture);
      if (other) {
        const act = HOTKEY_ACTIONS.find((a) => a.id === other);
        setConflict({ id: capture, name: act?.label ?? other });
        setCapture(null);
        return;
      }
      setHotkeyOverride(capture, combo);
      setConflict(null);
      setCapture(null);
      setTick((t) => t + 1);
      store.emit(); // v321 (F21): 改键后通知订阅组件重渲染 (界面快捷键提示同步)
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapture(null);
        return;
      }
      settle(comboFromEvent(e));
    };
    // v289: 捕获鼠标按键 (右键捕获时抑制上下文菜单)
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      settle(comboFromMouseEvent(e));
    };
    const onCtx = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('contextmenu', onCtx, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('contextmenu', onCtx, true);
      setHotkeyCapture(false);
    };
  }, [capture]);

  const cats = [...new Set(HOTKEY_ACTIONS.map((a) => a.category))];

  return (
    <DraggableDialog title="快捷键设置" testid="hotkey-panel" width={560} onClose={() => store.setHotkeyPanelOpen(false)}> {/* v292/v293: 字体调大, 面板加宽配套 */}
      <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1" data-testid="hotkey-list">
        {cats.map((cat) => (
          <div key={cat}>
            <div className="mt-1 text-[13px] font-bold uppercase tracking-wider text-osu-textdim">{cat}</div> {/* v293: 12→13px */}
            {HOTKEY_ACTIONS.filter((a) => a.category === cat).map((a) => {
              const overridden = isHotkeyOverridden(a.id);
              const binds = effectiveBindings(a.id);
              return (
                <div key={a.id} className="flex items-center gap-1.5 py-1" data-testid={`hotkey-row-${a.id}`}>
                  <span className="w-48 shrink-0 text-sm text-osu-text"> {/* v293: 13px→14px */}
                    {a.label}
                    {overridden && (
                      <button
                        className="ml-1 cursor-pointer text-osu-textdim hover:text-osu-yellow"
                        title="恢复默认"
                        data-testid={`hotkey-reset-${a.id}`}
                        onClick={() => {
                          setHotkeyOverride(a.id, null);
                          setTick((t) => t + 1);
                          store.emit(); // v321 (F21)
                        }}
                      >
                        ⟲
                      </button>
                    )}
                  </span>
                  <span className="flex flex-1 flex-wrap items-center justify-end gap-1">
                    {conflict?.id === a.id && (
                      <span className="text-[11px] text-osu-red">与「{conflict.name}」冲突</span> // v293: 10→11px
                    )}
                    {capture === a.id ? (
                      <span
                        className="rounded border border-osu-yellow bg-osu-yellow/10 px-1.5 py-0.5 text-[13px] text-osu-yellow"
                        data-testid={`hotkey-capturing-${a.id}`}
                      >
                        按任意键/鼠标键… Esc取消
                      </span>
                    ) : (
                      binds.map((b) => (
                        <button
                          key={b}
                          className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[13px] ${ // v293: 12→13px
                            overridden
                              ? 'border-osu-yellow/50 text-osu-yellow hover:bg-osu-yellow/10'
                              : 'border-osu-border text-osu-textdim hover:bg-osu-panel2 hover:text-osu-text'
                          }`}
                          title="点击修改快捷键"
                          data-testid={`hotkey-bind-${a.id}`}
                          onClick={() => {
                            setConflict(null);
                            setCapture(a.id);
                          }}
                        >
                          {formatCombo(b)}
                        </button>
                      ))
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {/* v321 (F18c): 固定键位分区 (不可改键的鼠标/系统组合, 仅展示) */}
      <div className="mt-2 border-t border-osu-border pt-2" data-testid="hotkey-fixed-section">
        <div className="mb-1 text-[13px] font-bold uppercase tracking-wider text-osu-textdim">固定键位 (不可修改)</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12px] text-osu-textdim">
          <span>Alt+点击 — 选中/取消滑条锚点</span>
          <span>Alt+拖动 — 框选滑条锚点</span>
          <span>Alt+Shift+拖动 — 锚点框选减选</span>
          <span>Ctrl+点击 (选中滑条) — 插入锚点</span>
          <span>中键拖动 — 平移游玩区</span>
          <span>Alt+滚轮 — 缩放游玩区 / 时间轴上调锁定间距</span>
          <span>Ctrl+滚轮 — 游玩区循环节拍细分 / 时间轴上缩放</span>
          <span>Shift+数字1-8 — 设节拍细分</span>
          <span>滚轮 — 移动时间</span>
          <span>右键 — 完成滑条 / 删除物件</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-osu-textdim">点击键位后按下新组合即可改键,关闭编辑器后保留</span> {/* v293: 10→11px */}
        <button
          className="cursor-pointer rounded border border-osu-border px-2 py-0.5 text-[13px] text-osu-textdim hover:text-osu-text"
          data-testid="hotkey-reset-all"
          onClick={() => {
            resetAllHotkeys();
            setConflict(null);
            setTick((t) => t + 1);
          }}
        >
          全部恢复默认
        </button>
      </div>
    </DraggableDialog>
  );
}
