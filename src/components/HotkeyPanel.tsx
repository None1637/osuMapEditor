import { useEffect, useState } from 'react';
import { DraggableDialog } from './DraggableDialog';
import { store, useEditor } from '@/osu/store';
import { useT } from '@/i18n';
import {
  HOTKEY_ACTIONS,
  HOTKEY_CATEGORY_I18N,
  comboFromEvent,
  comboFromMouseEvent,
  comboFromWheelEvent, // v330: 滚轮捕获
  effectiveBindings,
  findConflict,
  formatCombo,
  hotkeyActionKey,
  isHotkeyOverridden,
  resetAllHotkeys,
  setHotkeyCapture,
  setHotkeyOverride,
} from '@/osu/hotkeys';

/** v286: 快捷键设置面板 —— 列出全部可改键动作，点击绑定进入捕获态自定义改键。 */
export function HotkeyPanel() {
  useEditor(); // 订阅 store (面板开关变化时重渲染)
  const t = useT();
  // v358: capture = 捕获目标 — index 为改绑的绑定下标, null 为追加新绑定 (自定义也可多键)
  const [capture, setCapture] = useState<{ id: string; index: number | null } | null>(null);
  const [conflict, setConflict] = useState<{ id: string; otherId: string } | null>(null);
  const [, setTick] = useState(0);

  // v346: 动作/分类展示名 (i18n)
  const actionLabel = (a: (typeof HOTKEY_ACTIONS)[number]) => t('hotkey.action.' + hotkeyActionKey(a.id), a.en);
  const catLabel = (cat: string) => {
    const c = HOTKEY_CATEGORY_I18N[cat];
    return c ? t('hotkey.cat.' + c.key, c.en) : cat;
  };

  useEffect(() => {
    if (!capture) return;
    setHotkeyCapture(true);
    // v289: 键盘/鼠标按键统一结算 (冲突红字提示且不改键)
    // v358: 多键结算 — 改绑替换该下标; 追加 push; 同动作内重复键直接取消
    const settle = (combo: string | null) => {
      if (!combo) return; // 纯修饰键/未知鼠标键, 继续等待
      const other = findConflict(combo, capture.id);
      if (other) {
        setConflict({ id: capture.id, otherId: other });
        setCapture(null);
        return;
      }
      const next = [...effectiveBindings(capture.id)];
      if (capture.index == null) {
        if (next.includes(combo)) { setCapture(null); return; } // 同动作已有该键
        next.push(combo);
      } else {
        if (next.includes(combo) && next[capture.index] !== combo) { setCapture(null); return; }
        next[capture.index] = combo;
      }
      setHotkeyOverride(capture.id, next);
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
    // v330: 捕获滚轮 (修饰+Wheel; 方向不入键。passive:false 才能 preventDefault)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      settle(comboFromWheelEvent(e));
    };
    const onCtx = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('contextmenu', onCtx, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('contextmenu', onCtx, true);
      setHotkeyCapture(false);
    };
  }, [capture]);

  const cats = [...new Set(HOTKEY_ACTIONS.map((a) => a.category))];

  return (
    <DraggableDialog title={t('hotkey.panel.title', 'Hotkey Settings')} testid="hotkey-panel" width={560} onClose={() => store.setHotkeyPanelOpen(false)}> {/* v292/v293: 字体调大, 面板加宽配套 */}
      <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1" data-testid="hotkey-list">
        {cats.map((cat) => (
          <div key={cat}>
            <div className="mt-1 text-[13px] font-bold uppercase tracking-wider text-osu-textdim">{catLabel(cat)}</div> {/* v293: 12→13px */}
            {HOTKEY_ACTIONS.filter((a) => a.category === cat).map((a) => {
              const overridden = isHotkeyOverridden(a.id);
              const binds = effectiveBindings(a.id);
              return (
                <div key={a.id} className="flex items-center gap-1.5 py-1" data-testid={`hotkey-row-${a.id}`}>
                  <span className="w-48 shrink-0 text-sm text-osu-text"> {/* v293: 13px→14px */}
                    {actionLabel(a)}
                    {overridden && (
                      <button
                        className="ml-1 cursor-pointer text-osu-textdim hover:text-osu-yellow"
                        title={t('hotkey.reset_default', 'Reset to Default')}
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
                      <span className="text-[11px] text-osu-red">
                        {t('hotkey.conflict', 'Conflicts with "{name}"', {
                          name: (() => {
                            const act = HOTKEY_ACTIONS.find((x) => x.id === conflict.otherId);
                            return act ? actionLabel(act) : conflict.otherId;
                          })(),
                        })}
                      </span> // v293: 10→11px
                    )}
                    {capture?.id === a.id ? (
                      <span
                        className="rounded border border-osu-yellow bg-osu-yellow/10 px-1.5 py-0.5 text-[13px] text-osu-yellow"
                        data-testid={`hotkey-capturing-${a.id}`}
                      >
                        {t('hotkey.capture_hint', 'Press any key / mouse button / wheel… Esc to cancel')} {/* v330: 滚轮可捕获 */}
                      </span>
                    ) : (
                      <>
                        {binds.map((b, i) => (
                          <span key={`${b}-${i}`} className="flex items-center">
                            <button
                              className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[13px] ${ // v293: 12→13px
                                overridden
                                  ? 'border-osu-yellow/50 text-osu-yellow hover:bg-osu-yellow/10'
                                  : 'border-osu-border text-osu-textdim hover:bg-osu-panel2 hover:text-osu-text'
                              }`}
                              title={t('hotkey.click_to_rebind', 'Click to Rebind')}
                              data-testid={`hotkey-bind-${a.id}`}
                              onClick={() => {
                                setConflict(null);
                                setCapture({ id: a.id, index: i });
                              }}
                            >
                              {formatCombo(b)}
                            </button>
                            {overridden && (
                              <button
                                className="ml-0.5 cursor-pointer text-[11px] text-osu-textdim hover:text-osu-red"
                                title={t('hotkey.remove_binding', 'Remove this binding (removing the last one restores defaults)')}
                                data-testid={`hotkey-unbind-${a.id}`}
                                onClick={() => {
                                  // v358: 删除单个绑定; 删光 = 恢复默认
                                  const next = binds.filter((_, j) => j !== i);
                                  setHotkeyOverride(a.id, next.length ? next : null);
                                  setConflict(null);
                                  setTick((tk) => tk + 1);
                                  store.emit();
                                }}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                        {/* v358: 追加绑定 — 自定义也可像默认一样绑多个键 */}
                        <button
                          className="cursor-pointer rounded border border-dashed border-osu-border px-1.5 py-0.5 font-mono text-[13px] text-osu-textdim hover:border-osu-yellow hover:text-osu-yellow"
                          title={t('hotkey.add_binding', 'Add another binding')}
                          data-testid={`hotkey-add-${a.id}`}
                          onClick={() => {
                            setConflict(null);
                            setCapture({ id: a.id, index: null });
                          }}
                        >
                          +
                        </button>
                      </>
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
        <div className="mb-1 text-[13px] font-bold uppercase tracking-wider text-osu-textdim">{t('hotkey.fixed.title', 'Fixed Bindings (Not Customizable)')}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12px] text-osu-textdim">
          <span>{t('hotkey.fixed.alt_click_anchor', 'Alt+Click — Select/Deselect Slider Anchors')}</span>
          <span>{t('hotkey.fixed.alt_drag_anchor', 'Alt+Drag — Box Select Slider Anchors')}</span>
          <span>{t('hotkey.fixed.alt_shift_drag_anchor', 'Alt+Shift+Drag — Box Select (Subtract) Anchors')}</span>
          <span>{t('hotkey.fixed.ctrl_click_anchor', 'Ctrl+Click (Selected Slider) — Insert Anchor')}</span>
          {/* v330: 中键平移/Alt+滚轮缩放/锁定间距移入可改键列表 (游玩区分类) */}
          <span>{t('hotkey.fixed.ctrl_wheel', 'Ctrl+Wheel — Cycle Beat Snap Divisor (Playfield)')}</span>
          <span>{t('hotkey.fixed.shift_number_snap', 'Shift+1-8 — Set Beat Snap Divisor')}</span>
          <span>{t('hotkey.fixed.wheel_seek', 'Wheel — Seek Time')}</span>
          <span>{t('hotkey.fixed.right_click', 'Right Click — Finish Slider / Delete Object')}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-osu-textdim">{t('hotkey.footer_hint', 'Click a binding and press the new combo to rebind; "+" binds an additional key for the same action; kept after closing the editor')}</span> {/* v293: 10→11px */}
        <button
          className="cursor-pointer rounded border border-osu-border px-2 py-0.5 text-[13px] text-osu-textdim hover:text-osu-text"
          data-testid="hotkey-reset-all"
          onClick={() => {
            resetAllHotkeys();
            setConflict(null);
            setTick((t) => t + 1);
          }}
        >
          {t('hotkey.reset_all', 'Reset All to Defaults')}
        </button>
      </div>
    </DraggableDialog>
  );
}
