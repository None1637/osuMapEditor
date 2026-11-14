// v524: 布局编辑模式/当前选中控件 (与谱面 store 隔离, 不进谱面 undo)
import { useSyncExternalStore } from 'react';

let open = false;
let selected: string | null = null;
let selectedIds: readonly string[] = [];
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach(fn => fn()); };

export const isUiLayoutEditorOpen = () => open;
export const getSelectedUiControl = () => selected;
export const getSelectedUiControls = () => selectedIds;
export const getUiLayoutEditorVersion = () => version;
export const subscribeUiLayoutEditor = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useUiLayoutEditor = () => {
  useSyncExternalStore(subscribeUiLayoutEditor, getUiLayoutEditorVersion);
  return { open, selected, selectedIds };
};

export function openUiLayoutEditor(): void { open = true; emit(); }
export function closeUiLayoutEditor(): void { open = false; selected = null; selectedIds = []; emit(); }
export function selectUiControl(id: string | null, toggle = false): void {
  if (!id) { if (selected !== null) { selected = null; selectedIds = []; emit(); } return; }
  if (toggle) {
    const next = selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
    if (!next.length) { selected = null; selectedIds = []; emit(); return; }
    selectedIds = next; selected = next[next.length - 1]; emit(); return;
  }
  if (selected === id && selectedIds.length === 1) return;
  selected = id; selectedIds = [id]; emit();
}
