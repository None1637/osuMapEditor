// v524: 可视化控件布局编辑器 — 选择/拖动/缩放/图标/文本/隐藏/禁用/导入导出
import { useEffect, useRef, useState } from 'react';
import { Download, Redo2, RotateCcw, Undo2, Upload } from 'lucide-react';
import { DraggableDialog, DraftNum } from '../DraggableDialog';
import { UI_CONTROLS, getUiOverride, importUiLayout, resetUiControl, resetUiLayout, restoreUiLayoutBackup,
  beginUiLayoutGesture, endUiLayoutGesture, canRedoUiLayout, canUndoUiLayout, redoUiLayout, undoUiLayout,
  setUiOverride, setUiOverrides, exportUiLayout, useUiLayout, addUiIconAsset } from '@/osu/uiLayout';
import { closeUiLayoutEditor, selectUiControl, useUiLayoutEditor } from '@/osu/uiLayoutEdit';
import { UI_ICON_COMPONENTS } from '@/osu/uiIcons';
import { uiZoom } from '@/osu/uiZoom';
import { downloadText } from '@/osu/saveMap';
import { useT } from '@/i18n';
import { UiAutoControl, UiAutoIcon, UiAutoText } from './UiControl'; // v537
import { UiControlTree } from './UiControlTree'; // v539

interface DragState { id: string; x: number; y: number; dx: number; dy: number }
interface ResizeState { id: string; x: number; y: number; width: number; height: number }

export function UiLayoutEditor() {
  useUiLayout();
  const { open, selected, selectedIds } = useUiLayoutEditor();
  const t = useT();
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const fileRef = useRef<HTMLInputElement>(null);
  const iconFileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !(e.target instanceof Element) || e.target.closest('[data-ui-editor]')) return;
      const el = e.target.closest('[data-ui-id]') as HTMLElement | null;
      if (!el) return;
      e.preventDefault(); e.stopPropagation();
      const id = el.dataset.uiId!;
      const toggle = e.ctrlKey || e.metaKey;
      selectUiControl(id, toggle);
      if (toggle) { dragRef.current = null; return; } // 多选切换不拖动物件
      beginUiLayoutGesture();
      const l = getUiOverride(id).layout;
      dragRef.current = { id, x: e.clientX, y: e.clientY, dx: l?.offsetX ?? 0, dy: l?.offsetY ?? 0 };
    };
    const click = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-ui-id]') && !e.target.closest('[data-ui-editor]')) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    const move = (e: MouseEvent) => {
      const rs = resizeRef.current;
      if (rs) {
        setUiOverride(rs.id, { layout: {
          width: Math.max(1, rs.width + (e.clientX - rs.x) / uiZoom()),
          height: Math.max(1, rs.height + (e.clientY - rs.y) / uiZoom()),
        } });
        return;
      }
      const d = dragRef.current;
      if (d) setUiOverride(d.id, { layout: {
        offsetX: d.dx + (e.clientX - d.x) / uiZoom(), offsetY: d.dy + (e.clientY - d.y) / uiZoom(),
      } });
    };
    const up = () => { dragRef.current = null; resizeRef.current = null; endUiLayoutGesture(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('click', click, true);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('click', click, true);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      endUiLayoutGesture();
    };
  }, [open]);

  if (!open) return null;
  const selectedDef = UI_CONTROLS.find(c => c.id === selected);
  const selectedOverride = selected ? getUiOverride(selected) : {};
  const selectedEl = selected ? document.querySelector<HTMLElement>(`[data-ui-id="${selected}"]`) : null;
  const selectedRect = selectedEl?.getBoundingClientRect();
  // v537: 列表项自身的派生 ID 不再作为新列表项展开, 否则 item.<id> 会递归注册并无限增长
  const list = UI_CONTROLS.filter(c => !c.id.startsWith('dialog.ui-layout-editor.item.') && c.id.toLowerCase().includes(search.toLowerCase()));
  const inputClass = 'w-full bg-black/40 border border-white/15 rounded px-2 py-1 text-white';

  const startResize = (e: React.MouseEvent) => {
    if (!selected || !selectedRect) return;
    e.preventDefault(); e.stopPropagation();
    dragRef.current = null;
    beginUiLayoutGesture();
    resizeRef.current = {
      id: selected, x: e.clientX, y: e.clientY,
      width: selectedRect.width / uiZoom(), height: selectedRect.height / uiZoom(),
    };
  };

  return (
    <>
      <DraggableDialog title={t('uiLayout.title', 'Customize UI Layout')} testid="ui-layout-editor" width={390} onClose={closeUiLayoutEditor}>
        <div data-ui-editor className="space-y-2">
          <UiAutoControl localId="search"><input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('uiLayout.search', 'Search controls')}
            className={inputClass} data-ui-layout="search" /></UiAutoControl>
          <div className="max-h-36 overflow-auto border border-white/10 rounded" data-ui-control-tree>
            <UiControlTree controls={list} selectedIds={selectedIds} onSelect={selectUiControl} />
          </div>
          {selected && selectedDef && (
            <div className="space-y-2 border-t border-white/10 pt-2">
              <div className="font-bold text-cyan-200 break-all">{selected}</div>
              {selectedIds.length > 1 && <div className="text-cyan-300/80" data-ui-multi-selection>
                {t('uiLayout.multi_selected', '{n} controls selected — width/height apply to all (Ctrl/Cmd+click to toggle)', { n: selectedIds.length })}
              </div>}
              <label className="flex items-center gap-2">{t('uiLayout.mode', 'Layout mode')}
                <UiAutoControl localId="mode"><select value={selectedOverride.layout?.mode ?? 'flow'} data-ui-layout="mode"
                  onChange={e => setUiOverrides(selectedIds, { layout: { mode: e.target.value as 'flow' | 'absolute' } })} className={inputClass}>
                  <option value="flow">{t('uiLayout.flow', 'Flow (original layout)')}</option>
                  <option value="absolute">{t('uiLayout.absolute', 'Absolute')}</option>
                </select></UiAutoControl>
              </label>
              {selectedOverride.layout?.mode === 'absolute' && <div className="grid grid-cols-2 gap-2">
                <label>{t('uiLayout.position_x', 'Absolute X')}<DraftNum value={selectedOverride.layout.x ?? 0} min={-10000} max={10000} step={1}
                  set={v => setUiOverrides(selectedIds, { layout: { x: v } })} testid="ui-position-x" w="w-full" /></label>
                <label>{t('uiLayout.position_y', 'Absolute Y')}<DraftNum value={selectedOverride.layout.y ?? 0} min={-10000} max={10000} step={1}
                  set={v => setUiOverrides(selectedIds, { layout: { y: v } })} testid="ui-position-y" w="w-full" /></label>
              </div>}
              <div className="grid grid-cols-2 gap-2">
                <label>{t('uiLayout.offset_x', 'Offset X')}<DraftNum value={selectedOverride.layout?.offsetX ?? 0} min={-10000} max={10000} step={1}
                  set={v => setUiOverride(selected, { layout: { offsetX: v } })} testid="ui-offset-x" w="w-full" /></label>
                <label>{t('uiLayout.offset_y', 'Offset Y')}<DraftNum value={selectedOverride.layout?.offsetY ?? 0} min={-10000} max={10000} step={1}
                  set={v => setUiOverride(selected, { layout: { offsetY: v } })} testid="ui-offset-y" w="w-full" /></label>
                <label>{t('uiLayout.width', 'Width')}<DraftNum value={selectedOverride.layout?.width ?? (selectedRect ? selectedRect.width / uiZoom() : 1)} min={1} max={10000} step={1}
                  set={v => setUiOverrides(selectedIds, { layout: { width: v } })} testid="ui-width" w="w-full" /></label>
                <label>{t('uiLayout.height', 'Height')}<DraftNum value={selectedOverride.layout?.height ?? (selectedRect ? selectedRect.height / uiZoom() : 1)} min={1} max={10000} step={1}
                  set={v => setUiOverrides(selectedIds, { layout: { height: v } })} testid="ui-height" w="w-full" /></label>
              </div>
              <div className="flex gap-3">
                <label className="flex items-center gap-1"><UiAutoControl localId="visible"><input type="checkbox" checked={selectedOverride.visible !== false}
                  onChange={e => setUiOverride(selected, { visible: e.target.checked })} /></UiAutoControl><UiAutoText localId="visible" textKey="uiLayout.visible">Visible</UiAutoText></label>
                <label className="flex items-center gap-1"><UiAutoControl localId="enabled"><input type="checkbox" checked={selectedOverride.enabled !== false}
                  onChange={e => setUiOverride(selected, { enabled: e.target.checked })} /></UiAutoControl><UiAutoText localId="enabled" textKey="uiLayout.enabled">Enabled</UiAutoText></label>
              </div>
              <label className="block">{t('uiLayout.icon', 'Icon')}
                <UiAutoControl localId="icon"><select value={selectedOverride.icons?.default ?? selectedDef.defaultIcon ?? ''} data-ui-layout="icon"
                  onChange={e => setUiOverride(selected, { icons: { default: e.target.value } })} className={inputClass}>
                  <option value="">{t('uiLayout.default_icon', 'Default icon')}</option>
                  {Object.keys(UI_ICON_COMPONENTS).map(name => <option key={name} value={`lucide:${name}`}>{name}</option>)}
                </select></UiAutoControl>
              </label>
              <div className="flex items-center gap-2">
                <UiAutoControl localId="upload-icon" kind="button" defaultTextKey="uiLayout.upload_icon" defaultIcon="lucide:Upload"><button onClick={() => iconFileRef.current?.click()} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
                  <UiAutoIcon localId="upload-icon"><Upload className="inline-block w-4 h-4 mr-1" /></UiAutoIcon><UiAutoText localId="upload-icon" textKey="uiLayout.upload_icon">Upload icon</UiAutoText></button></UiAutoControl>
                <UiAutoControl localId="icon-file"><input ref={iconFileRef} type="file" accept="image/png,image/webp" data-ui-layout="icon-upload" className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0]; if (!file) return;
                    beginUiLayoutGesture();
                    try {
                      const data = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject;
                        reader.readAsDataURL(file);
                      });
                      setUiOverride(selected, { icons: { default: addUiIconAsset(data) } });
                      setMessage(t('uiLayout.icon_uploaded', 'Custom icon applied'));
                    } catch (err) { setMessage(t('uiLayout.import_failed', 'Import failed: {error}', { error: err instanceof Error ? err.message : String(err) })); }
                    finally { endUiLayoutGesture(); }
                    e.target.value = '';
                  }} /></UiAutoControl>
              </div>
              {(['zh-CN', 'zh-TW', 'en'] as const).map(lang => (
                <label key={lang} className="block">{t('uiLayout.text', 'Text')} ({lang})
                  <UiAutoControl localId={`text.${lang}`}><input value={selectedOverride.text?.[lang] ?? ''} onChange={e => setUiOverride(selected, { text: { [lang]: e.target.value } })}
                    placeholder={selectedDef.defaultTextKey} className={inputClass} data-ui-layout={`text-${lang}`} /></UiAutoControl>
                </label>
              ))}
              <UiAutoControl localId="reset-control" kind="button" defaultTextKey="uiLayout.reset_control" defaultIcon="lucide:RotateCcw"><button onClick={() => resetUiControl(selected)} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
                <UiAutoIcon localId="reset-control"><RotateCcw className="inline-block w-4 h-4 mr-1" /></UiAutoIcon><UiAutoText localId="reset-control" textKey="uiLayout.reset_control">Reset control</UiAutoText></button></UiAutoControl>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
            <UiAutoControl localId="undo" kind="button" defaultTextKey="app.undo" defaultIcon="lucide:Undo2"><button disabled={!canUndoUiLayout()} onClick={() => undoUiLayout()} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30">
              <UiAutoIcon localId="undo"><Undo2 className="inline-block w-4 h-4 mr-1" /></UiAutoIcon><UiAutoText localId="undo" textKey="app.undo">Undo</UiAutoText></button></UiAutoControl>
            <UiAutoControl localId="redo" kind="button" defaultTextKey="app.redo" defaultIcon="lucide:Redo2"><button disabled={!canRedoUiLayout()} onClick={() => redoUiLayout()} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30">
              <UiAutoIcon localId="redo"><Redo2 className="inline-block w-4 h-4 mr-1" /></UiAutoIcon><UiAutoText localId="redo" textKey="app.redo">Redo</UiAutoText></button></UiAutoControl>
            <UiAutoControl localId="import" kind="button" defaultTextKey="uiLayout.import" defaultIcon="lucide:Upload"><button onClick={() => fileRef.current?.click()} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
              <UiAutoIcon localId="import"><Upload className="inline-block w-4 h-4 mr-1" /></UiAutoIcon><UiAutoText localId="import" textKey="uiLayout.import">Import</UiAutoText></button></UiAutoControl>
            <UiAutoControl localId="export" kind="button" defaultTextKey="uiLayout.export" defaultIcon="lucide:Download"><button onClick={() => downloadText('osu-ui-layout.json', exportUiLayout())} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
              <UiAutoIcon localId="export"><Download className="inline-block w-4 h-4 mr-1" /></UiAutoIcon><UiAutoText localId="export" textKey="uiLayout.export">Export</UiAutoText></button></UiAutoControl>
            <UiAutoControl localId="import-mode"><select value={importMode} onChange={e => setImportMode(e.target.value as 'merge' | 'replace')} className="bg-black/40 border border-white/15 rounded px-1 py-1">
              <option value="merge">{t('uiLayout.merge', 'Merge')}</option><option value="replace">{t('uiLayout.replace', 'Replace')}</option>
            </select></UiAutoControl>
            <UiAutoControl localId="restore-backup" kind="button" defaultTextKey="uiLayout.restore_backup"><button onClick={() => { restoreUiLayoutBackup(); setMessage(t('uiLayout.restored', 'Backup restored')); }} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">
              <UiAutoText localId="restore-backup" textKey="uiLayout.restore_backup">Restore backup</UiAutoText></button></UiAutoControl>
            <UiAutoControl localId="reset-all" kind="button" defaultTextKey="uiLayout.reset_all"><button onClick={resetUiLayout} className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/40"><UiAutoText localId="reset-all" textKey="uiLayout.reset_all">Reset all</UiAutoText></button></UiAutoControl>
          </div>
          <UiAutoControl localId="layout-file"><input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={async e => {
            const file = e.target.files?.[0]; if (!file) return;
            try {
              const r = importUiLayout(await file.text(), importMode);
              setMessage(t('uiLayout.import_result', 'Imported {n} controls; {unknown} unknown', { n: r.applied, unknown: r.unknown.length }));
            } catch (err) { setMessage(t('uiLayout.import_failed', 'Import failed: {error}', { error: err instanceof Error ? err.message : String(err) })); }
            e.target.value = '';
          }} /></UiAutoControl>
          {message && <div className="text-white/60 break-words">{message}</div>}
        </div>
      </DraggableDialog>
      {selected && selectedRect && selectedRect.width > 0 && selectedRect.height > 0 && (
        <div data-ui-editor className="fixed pointer-events-none border border-cyan-300 z-[70]"
          style={{ left: selectedRect.left, top: selectedRect.top, width: selectedRect.width, height: selectedRect.height }}>
          <div data-ui-editor onMouseDown={startResize} className="absolute -right-1 top-0 bottom-0 w-2 cursor-ew-resize pointer-events-auto" />
          <div data-ui-editor onMouseDown={startResize} className="absolute -bottom-1 left-0 right-0 h-2 cursor-ns-resize pointer-events-auto" />
          <div data-ui-editor onMouseDown={startResize} className="absolute -right-1 -bottom-1 w-3 h-3 bg-cyan-300 cursor-nwse-resize pointer-events-auto" />
        </div>
      )}
    </>
  );
}
