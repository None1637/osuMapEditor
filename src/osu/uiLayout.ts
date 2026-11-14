// v524: 自定义控件布局核心 — 永久 ID + 稀疏覆盖, 配置校验/持久化/导入导出
import { z } from 'zod';
import { useSyncExternalStore } from 'react';

export const UI_LAYOUT_STORAGE_KEY = 'osu-editor:ui-layout:v1';
const BACKUP_KEY = 'osu-editor:ui-layout:backup:v1';
const MAX_IMPORT_CHARS = 5_000_000;

export type UiLayoutMode = 'flow' | 'absolute';
export type UiIconState = 'default' | 'active' | 'disabled' | 'hover';
export type UiTextLocale = 'en' | 'zh-CN' | 'zh-TW';

export interface UiLayoutOverride {
  layout?: {
    mode?: UiLayoutMode;
    x?: number; y?: number;
    offsetX?: number; offsetY?: number;
    width?: number; height?: number;
    anchor?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  icons?: Partial<Record<UiIconState, string>>;
  text?: Partial<Record<UiTextLocale, string>>;
  visible?: boolean;
  enabled?: boolean;
}

export interface UiControlDefinition {
  id: string;
  kind: 'button' | 'tab' | 'panel' | 'input' | 'menu' | 'canvas';
  defaultTextKey?: string;
  defaultIcon?: string;
  defaultLayout?: NonNullable<UiLayoutOverride['layout']>;
}

// 首批接线控件; 后续阶段扩表而不改变既有 ID
export const UI_CONTROLS: UiControlDefinition[] = [
  { id: 'chrome.tab.compose', kind: 'tab', defaultTextKey: 'app.tab_compose' },
  { id: 'chrome.tab.timing', kind: 'tab', defaultTextKey: 'app.tab_timing' },
  { id: 'chrome.tab.setup', kind: 'tab', defaultTextKey: 'app.tab_setup' },
  { id: 'timeline.bottom.play', kind: 'button', defaultIcon: 'lucide:Play' },
  { id: 'timeline.top.add-red', kind: 'button', defaultTextKey: 'timeline.add_red' },
  { id: 'timeline.top.add-green', kind: 'button', defaultTextKey: 'timeline.add_green' },
  { id: 'sidebar.left.tool.select', kind: 'button', defaultTextKey: 'app.tool_select', defaultIcon: 'lucide:MousePointer2' },
  { id: 'sidebar.left.tool.circle', kind: 'button', defaultTextKey: 'app.tool_circle', defaultIcon: 'lucide:Circle' },
  { id: 'sidebar.left.tool.slider', kind: 'button', defaultTextKey: 'app.tool_slider', defaultIcon: 'lucide:Spline' },
  { id: 'sidebar.left.tool.spinner', kind: 'button', defaultTextKey: 'app.tool_spinner', defaultIcon: 'lucide:Disc' },
  // v525: 独立窗口永久 ID (DraggableDialog.testid 原值永久保留)
  ...(['display-panel', 'pattern-panel', 'hotkey-panel', 'geo-snap', 'symSlider', 'stream', 'split',
    'batch-red', 'batch-green', 'polygon', 'duplicate', 'anchorStamp', 'tpdlg', 'rotate-dlg', 'scale-dlg',
    'symmetry-dlg', 'volume-panel', 'bpm-detect-dialog', 'ui-layout-editor'] as const).map(id => ({
    id: `dialog.${id}`, kind: 'panel' as const,
  })),
  // v527: Canvas/自绘区域 (显示和命中共用实际 rect)
  { id: 'timeline.top.canvas', kind: 'canvas', defaultLayout: { height: 92 } },
  { id: 'timeline.bottom.panel', kind: 'panel', defaultLayout: { height: 80 } },
  { id: 'playfield.canvas', kind: 'canvas' },
  // v529: 顶栏/底栏其余常用控件
  { id: 'chrome.volume', kind: 'button', defaultTextKey: 'app.volume', defaultIcon: 'lucide:Volume2' },
  { id: 'chrome.hotkeys', kind: 'button', defaultTextKey: 'app.hotkeys', defaultIcon: 'lucide:Keyboard' },
  { id: 'chrome.display', kind: 'button', defaultTextKey: 'app.display_settings', defaultIcon: 'lucide:Eye' },
  { id: 'chrome.layout-editor', kind: 'button', defaultTextKey: 'uiLayout.open', defaultIcon: 'lucide:LayoutDashboard' },
  { id: 'chrome.reload', kind: 'button', defaultTextKey: 'app.reload_map', defaultIcon: 'lucide:RefreshCw' },
  { id: 'chrome.language', kind: 'input', defaultIcon: 'lucide:Globe' },
  { id: 'timeline.bottom.jump-time', kind: 'button' },
  { id: 'timeline.bottom.test-play', kind: 'button', defaultTextKey: 'app.test_play' },
  ...([25, 50, 75, 100] as const).map(rate => ({ id: `timeline.bottom.speed.${rate}`, kind: 'button' as const })),
  // v530: 左右侧栏与 Inspector; 条件显示的控件也永久注册, 便于从列表预先配置
  { id: 'sidebar.left.panel', kind: 'panel' },
  { id: 'sidebar.right.panel', kind: 'panel' },
  ...([
    ['library', 'app.song_library'], ['skin', 'app.skin'], ['distance-toggle', 'app.distance_snap'],
    ['lock-notes', 'app.lock_notes'], ['slider-tail-snap', 'app.slider_tail_snap'], ['pan-toggle', 'app.playfield_pan'],
    ['grid-toggle', 'app.grid_snap'], ['grid-origin-toggle', 'app.grid_origin'], ['object-snap', 'app.object_snap'],
    ['limit-playfield', 'app.limit_playfield'], ['geo-toggle', 'app.geo_lines'], ['geo-config', 'app.geo_config'],
    ['pattern', 'app.pattern_library'], ['waveform', 'app.waveform'], ['undo', 'app.undo'], ['redo', 'app.redo'],
  ] as const).map(([id, defaultTextKey]) => ({ id: `sidebar.left.${id}`, kind: 'button' as const, defaultTextKey })),
  ...(['beat-snap', 'distance-range', 'distance-value', 'pan-zoom', 'pan-rotation', 'pan-x', 'pan-y',
    'grid-type', 'grid-spacing', 'grid-rotation', 'grid-origin-x', 'grid-origin-y'] as const)
    .map(id => ({ id: `sidebar.left.${id}`, kind: 'input' as const })),
  { id: 'sidebar.right.b4-convert', kind: 'button', defaultTextKey: 'app.b4_convert_all' },
  ...([
    ['rotate-ccw', 'inspector.rotate_ccw'], ['rotate-cw', 'inspector.rotate_cw'], ['scale-apply', 'inspector.apply_scale'],
    ['flip-h', 'inspector.flip_h'], ['flip-v', 'inspector.flip_v'], ['stream', 'inspector.sliders_to_stream'],
    ['arc-bezier', 'inspector.arc_to_bezier'], ['bspline-bezier', 'inspector.bspline_to_bezier'],
    ['bezier-bspline', 'inspector.bezier_to_bspline'], ['merge', 'inspector.merge_to_slider'],
    ['split-anchors', 'inspector.split_at_anchors'], ['polygon', 'inspector.polygon_generate'],
    ['duplicate', 'inspector.duplicate'], ['split', 'inspector.split_slider'], ['symmetric', 'inspector.symmetric_slider'],
    ['anchor-stamp', 'inspector.anchor_stamp'], ['delete', 'inspector.delete'],
  ] as const).map(([id, defaultTextKey]) => ({ id: `inspector.${id}`, kind: 'button' as const, defaultTextKey })),
  ...(['origin-selection', 'origin-playfield', 'origin-custom', 'origin-x', 'origin-y', 'rotate-angle',
    'scale-x', 'scale-y', 'time', 'x', 'y', 'curve-type', 'length', 'repeats', 'end-time', 'new-combo',
    'hitsound-whistle', 'hitsound-finish', 'hitsound-clap', 'normal-set', 'addition-set', 'sample-index', 'volume'] as const)
    .map(id => ({ id: `inspector.${id}`, kind: 'input' as const })),
  // v531: Setup 字段; Timing 动态行只注册一份模板, 覆盖应用到全部同类行
  ...(['general', 'editor', 'metadata', 'difficulty'] as const).map(id => ({ id: `setup.section.${id}`, kind: 'panel' as const })),
  ...(['audio-filename', 'audio-lead-in', 'preview-time', 'countdown', 'sample-set', 'stack-leniency', 'mode',
    'letterbox-breaks', 'widescreen-storyboard', 'distance-spacing', 'distance-lock', 'beat-divisor', 'grid-size',
    'timeline-zoom', 'title', 'title-unicode', 'artist', 'artist-unicode', 'creator', 'version', 'source', 'tags',
    'beatmap-id', 'beatmap-set-id', 'hp', 'cs', 'od', 'ar', 'slider-multiplier', 'slider-tick-rate'] as const)
    .map(id => ({ id: `setup.${id}`, kind: 'input' as const })),
  ...(['sv-comp-apply', 'sv-comp-skip'] as const).map(id => ({ id: `setup.${id}`, kind: 'button' as const })),
  { id: 'timing.panel', kind: 'panel' },
  ...(['cs', 'ar', 'od', 'hp'] as const).map(id => ({ id: `timing.difficulty.${id}`, kind: 'input' as const })),
  ...([
    ['add-red', 'timing.add_red'], ['detect-bpm', 'timing.detect_bpm'], ['add-green', 'timing.add_green'],
    ['tab-all', 'timing.tab_all'], ['tab-red', 'timing.red_line'], ['tab-green', 'timing.green_line'],
    ['batch-green', 'timing.batch_edit'], ['batch-green-delete', 'timing.delete_selected'],
    ['batch-red', 'timing.batch_edit'], ['batch-red-delete', 'timing.delete_selected'],
  ] as const).map(([id, defaultTextKey]) => ({ id: `timing.${id}`, kind: 'button' as const, defaultTextKey })),
  ...(['row-select', 'row-time', 'row-time-format', 'row-bpm', 'row-sv', 'row-meter', 'row-sample-set',
    'row-sample-index', 'row-volume', 'row-kiai', 'row-omit-bar'] as const)
    .map(id => ({ id: `timing.${id}`, kind: 'input' as const })),
  { id: 'timing.row-seek', kind: 'button', defaultIcon: 'lucide:ArrowRight' }, { id: 'timing.row-delete', kind: 'button', defaultIcon: 'lucide:X' },
  // v536: 非 DraggableDialog 的提示框/向导/覆盖层
  ...(['unsaved.panel', 'update.badge', 'update.toast', 'update.dialog', 'first-run.panel', 'lang-first-run.panel',
    'testplay.canvas', 'testplay.hint', 'fps', 'saved-flash'] as const).map(id => ({ id, kind: id.endsWith('canvas') ? 'canvas' as const : 'panel' as const })),
  ...([
    ['unsaved.cancel', 'unsaved.cancel'], ['unsaved.discard', 'unsaved.discard'], ['unsaved.save', 'unsaved.save_continue'],
    ['update.open', 'update.badge'], ['update.accept', 'update.accept'], ['update.skip', 'update.skip'], ['update.later', 'update.later'],
    ['first-run.pick-dir', 'wizard.pick_dir'], ['first-run.finish', 'wizard.finish'],
    ['testplay.exit', 'testplay.exit'], ['testplay.skip', 'testplay.skip'],
  ] as const).map(([id, defaultTextKey]) => ({ id, kind: 'button' as const, defaultTextKey })),
  { id: 'update.dismiss', kind: 'button', defaultIcon: 'lucide:X' },
  { id: 'unsaved.title', kind: 'panel', defaultTextKey: 'unsaved.title', defaultIcon: 'lucide:TriangleAlert' },
  { id: 'first-run.title', kind: 'panel', defaultTextKey: 'wizard.title', defaultIcon: 'lucide:Music' },
  ...(['skin', 'no-skin'] as const).map(id => ({ id: `first-run.${id}`, kind: 'input' as const })),
  ...(['EZ', 'HR', 'HT', 'DT', 'RX', 'AP', 'AT'] as const).map(id => ({ id: `testplay.mod.${id}`, kind: 'button' as const })),
  ...(['zh-CN', 'zh-TW', 'en'] as const).map(id => ({ id: `lang-first-run.${id}`, kind: 'button' as const })),
  // v537: 曲库/皮肤/时间轴与零散弹窗
  ...(['library.panel', 'library.title', 'library.list', 'library.entry', 'library.details',
    'skin-picker.panel', 'skin-picker.title', 'skin-list.panel', 'skin-list.title', 'shift-all.panel',
    'timeline.selection-info', 'timeline.bottom.speed'] as const)
    .map(id => ({ id, kind: 'panel' as const })),
  ...(['library.search', 'library.sort', 'library.grant', 'skin-picker.grant', 'shift-all.input'] as const)
    .map(id => ({ id, kind: 'input' as const })),
  ...([
    ['library.choose-dir', 'library.change_dir'], ['library.rescan', 'library.rescan'],
    ['library.choose-initial', 'library.choose_songs_dir'], ['library.retry', 'library.retry'], ['library.open', 'library.open'],
    ['skin-picker.choose', 'skin.choose_folder'], ['skin-picker.reset', 'skin.reset_default'],
    ['shift-all.cancel', 'app.cancel'], ['shift-all.apply', 'app.apply'],
  ] as const).map(([id, defaultTextKey]) => ({ id, kind: 'button' as const, defaultTextKey })),
  { id: 'library.close', kind: 'button', defaultIcon: 'lucide:X' },
  { id: 'skin-picker.close', kind: 'button', defaultIcon: 'lucide:X' },
  { id: 'skin-list.close', kind: 'button', defaultIcon: 'lucide:X' },
  { id: 'skin-list.row', kind: 'button', defaultIcon: 'lucide:Check' },
  { id: 'timeline.top.wave-mode', kind: 'button', defaultIcon: 'lucide:AudioWaveform' },
  { id: 'timeline.top.wave-layer', kind: 'button', defaultIcon: 'lucide:Layers' },
  { id: 'timeline.top.wave-close', kind: 'button', defaultIcon: 'lucide:X' },
  { id: 'timeline.top.zoom-in', kind: 'button', defaultIcon: 'lucide:ZoomIn' },
  { id: 'timeline.top.zoom-out', kind: 'button', defaultIcon: 'lucide:ZoomOut' },
  { id: 'timeline.bottom.jump-input', kind: 'input' },
  { id: 'timeline.bottom.canvas', kind: 'canvas' },
] as const;

const CONTROL_IDS = new Set(UI_CONTROLS.map(c => c.id));

const layoutSchema = z.strictObject({
  mode: z.enum(['flow', 'absolute']).optional(),
  x: z.number().finite().min(-10000).max(10000).optional(),
  y: z.number().finite().min(-10000).max(10000).optional(),
  offsetX: z.number().finite().min(-10000).max(10000).optional(),
  offsetY: z.number().finite().min(-10000).max(10000).optional(),
  width: z.number().finite().min(1).max(10000).optional(),
  height: z.number().finite().min(1).max(10000).optional(),
  anchor: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
}).optional();
const overrideSchema = z.strictObject({
  layout: layoutSchema,
  // Zod record(enum) 会要求所有键存在; 布局是稀疏覆盖, 故显式 partial 字段
  icons: z.strictObject({
    default: z.string().min(1).max(1_000_000).optional(), active: z.string().min(1).max(1_000_000).optional(),
    disabled: z.string().min(1).max(1_000_000).optional(), hover: z.string().min(1).max(1_000_000).optional(),
  }).optional(),
  text: z.strictObject({
    en: z.string().max(500).optional(), 'zh-CN': z.string().max(500).optional(), 'zh-TW': z.string().max(500).optional(),
  }).optional(),
  visible: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
const layoutFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  application: z.literal('osu-map-editor'),
  applicationVersion: z.string().max(40).optional(),
  controls: z.record(z.string(), overrideSchema),
  assets: z.record(z.string(), z.string().regex(/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=\r\n]+$/)).optional(),
});

export interface UiLayoutFile {
  schemaVersion: 1;
  application: 'osu-map-editor';
  applicationVersion?: string;
  controls: Record<string, UiLayoutOverride>;
  assets?: Record<string, string>;
}

export interface UiLayoutImportResult {
  applied: number;
  unknown: string[];
}

const emptyLayout = (): UiLayoutFile => ({ schemaVersion: 1, application: 'osu-map-editor', controls: {} });

function readStored(key: string): UiLayoutFile | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    return raw ? layoutFileSchema.parse(JSON.parse(raw)) as UiLayoutFile : null;
  } catch { return null; }
}

function writeStored(v: UiLayoutFile): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(UI_LAYOUT_STORAGE_KEY, JSON.stringify(v)); } catch { /* 配额满保留当前内存态 */ }
}

let current = readStored(UI_LAYOUT_STORAGE_KEY) ?? emptyLayout();
const listeners = new Set<() => void>();
let version = 0;
let registrationQueued = false;
const emit = () => { version++; listeners.forEach(fn => fn()); };
const emitRegistration = () => {
  // v537: 同一批 React effect 可能注册数百个列表项; 合并通知, 避免逐项全页重渲
  if (registrationQueued) return;
  registrationQueued = true;
  setTimeout(() => { registrationQueued = false; emit(); }, 0);
};

export const getUiLayout = (): UiLayoutFile => current;
export const getUiLayoutVersion = () => version;
export const subscribeUiLayout = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const useUiLayout = () => useSyncExternalStore(subscribeUiLayout, getUiLayoutVersion);
export const getUiOverride = (id: string): UiLayoutOverride => current.controls[id] ?? {};
export const isKnownUiControl = (id: string) => CONTROL_IDS.has(id);

/** v526: 菜单等动态区域挂载时注册永久 ID, 重复注册不触发重渲 */
export function registerUiControls(defs: UiControlDefinition[]): void {
  let changed = false;
  for (const def of defs) {
    if (CONTROL_IDS.has(def.id)) continue;
    CONTROL_IDS.add(def.id); UI_CONTROLS.push(def); changed = true;
  }
  if (changed) emitRegistration();
}

function mergeUiOverride(prev: UiLayoutOverride, patch: UiLayoutOverride): UiLayoutOverride {
  return {
    ...prev, ...patch,
    ...(prev.layout || patch.layout ? { layout: { ...prev.layout, ...patch.layout } } : {}),
    ...(prev.icons || patch.icons ? { icons: { ...prev.icons, ...patch.icons } } : {}),
    ...(prev.text || patch.text ? { text: { ...prev.text, ...patch.text } } : {}),
  };
}

// v538: 布局历史与谱面 undo 完全隔离; 快照含自定义图标资源
const HISTORY_LIMIT = 100;
const undoStack: UiLayoutFile[] = [], redoStack: UiLayoutFile[] = [];
let gestureActive = false, gestureChanged = false;
const cloneLayout = (v: UiLayoutFile): UiLayoutFile => structuredClone(v);
const sameLayout = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function recordUiLayoutChange(before: UiLayoutFile): void {
  if (sameLayout(before, current)) return;
  if (gestureActive && gestureChanged) return; // 同一次拖动/缩放手势只记第一次变更前快照
  if (gestureActive) gestureChanged = true;
  undoStack.push(cloneLayout(before));
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}
export function beginUiLayoutGesture(): void { gestureActive = true; gestureChanged = false; }
export function endUiLayoutGesture(): void { gestureActive = false; gestureChanged = false; }
export const canUndoUiLayout = () => undoStack.length > 0;
export const canRedoUiLayout = () => redoStack.length > 0;
export function undoUiLayout(): boolean {
  if (!undoStack.length) return false;
  redoStack.push(cloneLayout(current));
  current = undoStack.pop()!;
  writeStored(current); emit(); return true;
}
export function redoUiLayout(): boolean {
  if (!redoStack.length) return false;
  undoStack.push(cloneLayout(current));
  current = redoStack.pop()!;
  writeStored(current); emit(); return true;
}

export function setUiOverrides(ids: Iterable<string>, patch: UiLayoutOverride): void {
  const controls = { ...current.controls };
  let changed = false;
  for (const id of ids) {
    if (!CONTROL_IDS.has(id)) continue;
    const next = mergeUiOverride(controls[id] ?? {}, patch);
    if (!sameLayout(controls[id] ?? {}, next)) { controls[id] = next; changed = true; }
  }
  if (!changed) return;
  const before = current;
  current = { ...current, controls };
  recordUiLayoutChange(before);
  writeStored(current); emit();
}
export function setUiOverride(id: string, patch: UiLayoutOverride): void {
  setUiOverrides([id], patch);
}

export function resetUiControl(id: string): void {
  if (!(id in current.controls)) return;
  const before = current;
  const controls = { ...current.controls };
  delete controls[id];
  current = { ...current, controls };
  recordUiLayoutChange(before);
  writeStored(current); emit();
}

export function resetUiLayout(): void {
  const before = current;
  current = emptyLayout();
  recordUiLayoutChange(before);
  writeStored(current); emit();
}

export function validateUiLayoutFile(input: unknown): UiLayoutFile {
  return layoutFileSchema.parse(input) as UiLayoutFile;
}

export function exportUiLayout(): string {
  return JSON.stringify(current, null, 2) + '\n';
}

/** v528: 自定义 PNG/WebP 图标入库, 返回可序列化的 asset 引用; 不支持 SVG/外链 */
export function addUiIconAsset(dataUrl: string): string {
  if (!/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(dataUrl)) throw new Error('Only PNG/WebP data URLs are supported');
  if (dataUrl.length > 700_000) throw new Error('Icon asset is too large');
  let h = 2166136261;
  for (let i = 0; i < dataUrl.length; i++) { h ^= dataUrl.charCodeAt(i); h = Math.imul(h, 16777619); }
  const key = (h >>> 0).toString(16);
  if (current.assets?.[key] === dataUrl) return `asset:${key}`;
  const before = current;
  current = { ...current, assets: { ...current.assets, [key]: dataUrl } };
  recordUiLayoutChange(before);
  writeStored(current); emit();
  return `asset:${key}`;
}

/** 导入前自动备份当前配置; 校验失败/读包失败均不改变当前布局 */
export function importUiLayout(raw: string, mode: 'merge' | 'replace' = 'merge'): UiLayoutImportResult {
  if (raw.length > MAX_IMPORT_CHARS) throw new Error('UI layout file is too large');
  const parsed = validateUiLayoutFile(JSON.parse(raw));
  const known: Record<string, UiLayoutOverride> = {};
  const deferred: Record<string, UiLayoutOverride> = {};
  const unknown: string[] = [];
  for (const [id, override] of Object.entries(parsed.controls)) {
    if (CONTROL_IDS.has(id)) known[id] = override;
    else {
      unknown.push(id);
      // v532: 只保留可按作用域注册的弹窗控件; 真正废弃的旧 ID 仍丢弃
      if (id.startsWith('dialog.')) deferred[id] = override;
    }
  }
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(BACKUP_KEY, JSON.stringify(current)); } catch { /* 备份尽力而为 */ }
  const before = current;
  current = {
    ...parsed,
    controls: mode === 'replace' ? { ...known, ...deferred } : { ...current.controls, ...known, ...deferred },
    assets: { ...current.assets, ...parsed.assets },
  };
  recordUiLayoutChange(before);
  writeStored(current); emit();
  return { applied: Object.keys(known).length, unknown };
}

/** 测试/恢复入口: 从自动备份恢复, 无备份返回 false */
export function restoreUiLayoutBackup(): boolean {
  const backup = readStored(BACKUP_KEY);
  if (!backup) return false;
  const before = current;
  current = backup;
  recordUiLayoutChange(before);
  writeStored(current); emit(); return true;
}
