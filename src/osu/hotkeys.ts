// v286: 快捷键注册表 + 自定义改键 (快捷键设置面板数据层, 无 React)
//  - HOTKEY_ACTIONS: 全部可改键动作 (App.tsx keydown 派发 + 原生菜单 accelerator 同步);
//  - 组合键规范格式: "Ctrl+Shift+S" / "Q" / "Delete" / "ArrowLeft" / "Space" / "," (修饰序 Ctrl→Alt→Shift);
//  - 匹配规则: 带修饰的绑定精确相等; 无修饰的绑定忽略 Shift (保持旧行为: Shift+Q 与 Q 等效);
//  - 覆盖语义: 用户改键替换该动作全部默认键 (如 delete 改键后 Backspace 不再删除);
//  - 持久化 localStorage 'osu-editor:hotkeys' (Record<actionId, combo>);
//  - Electron: menuId 非空的动作同步原生菜单 accelerator (经 preload setAcceleratorOverrides →
//    main.cjs buildMenu acc()), 注册的 (save/timing 4 项) 真改键, 其余仅菜单显示文字同步。
import { getElectronAPI } from './electronBridge';
import { tNow } from '@/i18n';

export interface HotkeyAction {
  id: string;
  label: string;
  en: string;           // v346: i18n 英文默认文案 (展示: t('hotkey.action.'+snake(id), en))
  category: string;
  defaults: string[];   // 规范组合键, 首个为主键 (改键后替换全部)
  menuId?: string;      // 同步原生菜单 accelerator 的键 (main.cjs acc() 用同一 id)
  conflictOk?: string[]; // v330: 与本列表中的动作允许同键 (语境互斥, 如平移开/关的两个滚轮动作)
}

/** v346: 动作 id → i18n 键后缀 (snake_case) */
export function hotkeyActionKey(id: string): string {
  return id.replaceAll('-', '_');
}

// v346: 分类 i18n — key 为稳定 snake id, en 为英文默认 (展示: t('hotkey.cat.'+key, en))
export const HOTKEY_CATEGORY_I18N: Record<string, { key: string; en: string }> = {
  '播放/文件': { key: 'playback_file', en: 'Playback / File' },
  '编辑': { key: 'edit', en: 'Edit' },
  '工具': { key: 'tools', en: 'Tools' },
  '变换': { key: 'transforms', en: 'Transforms' },
  'Hitsound': { key: 'hitsound', en: 'Hitsound' },
  '导航': { key: 'navigation', en: 'Navigation' },
  '测试游玩': { key: 'test_play', en: 'Test Play' },
  'Timing': { key: 'timing', en: 'Timing' },
  '游玩区': { key: 'playfield', en: 'Playfield' },
};

// v181: 不用符号字符 — 展示名用 ASCII/中文
export const HOTKEY_ACTIONS: HotkeyAction[] = [
  // 播放/文件
  { id: 'play-pause', label: '播放/暂停', en: 'Play / Pause', category: '播放/文件', defaults: ['Space'] },
  { id: 'test-play', label: '测试游玩', en: 'Test Play', category: '播放/文件', defaults: ['F5'] }, // v287
  { id: 'save', label: '保存谱面', en: 'Save Beatmap', category: '播放/文件', defaults: ['Ctrl+S'], menuId: 'save' },
  // 编辑
  { id: 'undo', label: '撤销', en: 'Undo', category: '编辑', defaults: ['Ctrl+Z'], menuId: 'edit-undo' },
  { id: 'redo', label: '重做', en: 'Redo', category: '编辑', defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'], menuId: 'edit-redo' },
  { id: 'cut', label: '剪切', en: 'Cut', category: '编辑', defaults: ['Ctrl+X'], menuId: 'edit-cut' },
  { id: 'copy', label: '复制', en: 'Copy', category: '编辑', defaults: ['Ctrl+C'], menuId: 'edit-copy' },
  { id: 'paste', label: '粘贴', en: 'Paste', category: '编辑', defaults: ['Ctrl+V'], menuId: 'edit-paste' },
  { id: 'delete', label: '删除所选', en: 'Delete Selected', category: '编辑', defaults: ['Delete', 'Backspace'], menuId: 'edit-delete' },
  { id: 'select-all', label: '全选物件', en: 'Select All Objects', category: '编辑', defaults: ['Ctrl+A'], menuId: 'edit-select-all' },
  { id: 'cancel', label: '取消/清除选择', en: 'Cancel / Clear Selection', category: '编辑', defaults: ['Escape'] },
  { id: 'duplicate', label: '批量复制窗口', en: 'Batch Duplicate Window', category: '编辑', defaults: ['Ctrl+D'], menuId: 'edit-duplicate' },
  // 工具
  { id: 'tool-select', label: '工具: 选择', en: 'Tool: Select', category: '工具', defaults: ['1'] },
  { id: 'tool-circle', label: '工具: 单点', en: 'Tool: Hit Circle', category: '工具', defaults: ['2'] },
  { id: 'tool-slider', label: '工具: 滑条', en: 'Tool: Slider', category: '工具', defaults: ['3'] },
  { id: 'tool-spinner', label: '工具: 转盘', en: 'Tool: Spinner', category: '工具', defaults: ['4'] },
  // 变换
  { id: 'reverse', label: '反转选区', en: 'Reverse Selection', category: '变换', defaults: ['Ctrl+G'], menuId: 'edit-reverse' },
  { id: 'flip-h', label: '水平镜像 (游玩区中心)', en: 'Flip Horizontally (Playfield Center)', category: '变换', defaults: ['Ctrl+H'], menuId: 'edit-flip-h' },
  { id: 'flip-v', label: '垂直镜像 (游玩区中心)', en: 'Flip Vertically (Playfield Center)', category: '变换', defaults: ['Ctrl+J'], menuId: 'edit-flip-v' },
  { id: 'rot-ccw', label: '逆时针旋转90° (游玩区中心)', en: 'Rotate 90° CCW (Playfield Center)', category: '变换', defaults: ['Ctrl+,'], menuId: 'edit-rot-ccw' },
  { id: 'rot-cw', label: '顺时针旋转90° (游玩区中心)', en: 'Rotate 90° CW (Playfield Center)', category: '变换', defaults: ['Ctrl+.'], menuId: 'edit-rot-cw' },
  { id: 'open-rotate', label: '旋转窗口', en: 'Rotate Window', category: '变换', defaults: ['Ctrl+Shift+R'], menuId: 'edit-open-rotate' },
  { id: 'open-scale', label: '缩放窗口', en: 'Scale Window', category: '变换', defaults: ['Ctrl+Shift+S'], menuId: 'edit-open-scale' },
  { id: 'polygon', label: '多边形生成', en: 'Polygon Generator', category: '变换', defaults: ['Ctrl+Shift+D'], menuId: 'compose-polygon' },
  // Hitsound (放置态 = 预设下次放置; select 工具 = 切换选中)
  { id: 'hs-newcombo', label: '新Combo (放置预设/选中切换)', en: 'New Combo (Placement Preset / Toggle Selected)', category: 'Hitsound', defaults: ['Q'] },
  { id: 'hs-whistle', label: 'Whistle (放置预设/选中切换)', en: 'Whistle (Placement Preset / Toggle Selected)', category: 'Hitsound', defaults: ['W'] },
  { id: 'hs-finish', label: 'Finish (放置预设/选中切换)', en: 'Finish (Placement Preset / Toggle Selected)', category: 'Hitsound', defaults: ['E'] },
  { id: 'hs-clap', label: 'Clap (放置预设/选中切换)', en: 'Clap (Placement Preset / Toggle Selected)', category: 'Hitsound', defaults: ['R'] },
  // 导航
  { id: 'nudge-time-prev', label: '选中物件前移一个吸附', en: 'Nudge Selected Back One Snap', category: '导航', defaults: ['J'], menuId: 'edit-nudge-prev' },
  // v352: 页签切换 F1/F2/F3 (stable 同款)
  { id: 'tab-compose', label: '页签: compose', en: 'Tab: Compose', category: '导航', defaults: ['F1'] },
  { id: 'tab-timing', label: '页签: timing', en: 'Tab: Timing', category: '导航', defaults: ['F2'] },
  { id: 'tab-setup', label: '页签: song setup', en: 'Tab: Song Setup', category: '导航', defaults: ['F3'] },
  { id: 'nudge-time-next', label: '选中物件后移一个吸附', en: 'Nudge Selected Forward One Snap', category: '导航', defaults: ['K'], menuId: 'edit-nudge-next' },
  { id: 'jump-last', label: '跳到最后一个物件', en: 'Jump to Last Object', category: '导航', defaults: ['V'] },
  { id: 'seek-left', label: '按节拍后退 (Shift=4拍)', en: 'Seek Back One Beat (Shift = 4 Beats)', category: '导航', defaults: ['ArrowLeft'] },
  { id: 'seek-right', label: '按节拍前进 (Shift=4拍)', en: 'Seek Forward One Beat (Shift = 4 Beats)', category: '导航', defaults: ['ArrowRight'] },
  { id: 'ctrl-left', label: '左移选中1px (无选区: 跳到上个物件)', en: 'Move Selected 1px Left (No Selection: Jump to Previous Object)', category: '导航', defaults: ['Ctrl+ArrowLeft'] },
  { id: 'ctrl-right', label: '右移选中1px (无选区: 跳到下个物件)', en: 'Move Selected 1px Right (No Selection: Jump to Next Object)', category: '导航', defaults: ['Ctrl+ArrowRight'] },
  { id: 'ctrl-up', label: '上移选中1px (无选区: 跳到前一条书签)', en: 'Move Selected 1px Up (No Selection: Jump to Previous Bookmark)', category: '导航', defaults: ['Ctrl+ArrowUp'] },
  { id: 'ctrl-down', label: '下移选中1px (无选区: 跳到后一条书签)', en: 'Move Selected 1px Down (No Selection: Jump to Next Bookmark)', category: '导航', defaults: ['Ctrl+ArrowDown'] },
  { id: 'bookmark-add', label: '当前位置添加书签', en: 'Add Bookmark at Current Position', category: '导航', defaults: ['Ctrl+B'] },
  { id: 'bookmark-remove', label: '删除最近的书签', en: 'Remove Nearest Bookmark', category: '导航', defaults: ['Ctrl+Shift+B'] },
  { id: 'bookmark-prev', label: '跳到前一条书签', en: 'Jump to Previous Bookmark', category: '导航', defaults: ['ArrowUp'] },
  { id: 'bookmark-next', label: '跳到后一条书签', en: 'Jump to Next Bookmark', category: '导航', defaults: ['ArrowDown'] },
  // 测试游玩 (v288: 击打键可改; v289: 鼠标按键可绑 — 默认左键同 Z 一起是击打键 1)
  { id: 'test-hit-1', label: '游玩击打键 1', en: 'Hit Key 1 (Test Play)', category: '测试游玩', defaults: ['Z', 'MouseLeft'] },
  { id: 'test-hit-2', label: '游玩击打键 2', en: 'Hit Key 2 (Test Play)', category: '测试游玩', defaults: ['X'] },
  { id: 'test-exit', label: '退出测试游玩', en: 'Exit Test Play', category: '测试游玩', defaults: ['Escape'] }, // v289
  // Timing (Electron 原生菜单注册 accelerator; 浏览器走 keydown)
  { id: 'timing-add-red', label: '添加红线 (Timing区间)', en: 'Add Timing Point (Red Line)', category: 'Timing', defaults: ['Ctrl+P'], menuId: 'timing-add-red' },
  { id: 'timing-add-green', label: '添加绿线 (继承区间)', en: 'Add Inherited Timing Point (Green Line)', category: 'Timing', defaults: ['Ctrl+Shift+P'], menuId: 'timing-add-green' },
  { id: 'timing-delete-current', label: '删除当前Timing区间', en: 'Delete Current Timing Section', category: 'Timing', defaults: ['Ctrl+I'], menuId: 'timing-delete-current' },
  { id: 'timing-open-settings', label: 'Timing设置', en: 'Timing Settings', category: 'Timing', defaults: ['F6'], menuId: 'timing-open-settings' },
  // 游玩区 (v330: 原固定键位改可改键; 滚轮组合方向不入键, 增减由动作内部按 deltaY 决定。
  // 两个 Alt+Wheel 动作语境互斥 — 缩放仅平移开启时生效, 锁定间距仅未开平移 (游玩区) / 时间轴生效, 故允许同键)
  { id: 'playfield-pan-drag', label: '平移游玩区 (按住拖动, 需开启平移)', en: 'Pan Playfield (Hold & Drag, Pan Mode Required)', category: '游玩区', defaults: ['MouseMiddle'] },
  { id: 'playfield-zoom-wheel', label: '缩放游玩区 (滚轮, 需开启平移)', en: 'Zoom Playfield (Wheel, Pan Mode Required)', category: '游玩区', defaults: ['Alt+Wheel'], conflictOk: ['distance-lock-wheel'] },
  { id: 'distance-lock-wheel', label: '锁定间距调整 (滚轮, 未开平移/时间轴)', en: 'Adjust Distance Snap (Wheel, Pan Off / Timeline)', category: '游玩区', defaults: ['Alt+Wheel'], conflictOk: ['playfield-zoom-wheel'] },
];

const LS_KEY = 'osu-editor:hotkeys';

/** 键名规范化: 单字母大写, 空格→Space, 修饰键本身返回 null (单独按修饰不构成组合) */
function normKey(key: string): string | null {
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toUpperCase();
  return key;
}

/** KeyboardEvent → 规范组合键 (修饰序 Ctrl→Alt→Shift); 纯修饰键返回 null */
export function comboFromEvent(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  const key = normKey(e.key);
  if (!key) return null;
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + key;
}

// ---- v289: 鼠标按键组合 ----
/** MouseEvent.button → 组合键 token (0 左/1 中/2 右/3/4 侧键) */
const MOUSE_BUTTON_TOKENS: Record<number, string> = { 0: 'MouseLeft', 1: 'MouseMiddle', 2: 'MouseRight', 3: 'Mouse4', 4: 'Mouse5' };

/** MouseEvent → 规范组合键 (如 "MouseLeft" / "Ctrl+MouseRight"); 不认识的按键返回 null */
export function comboFromMouseEvent(e: Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  const token = MOUSE_BUTTON_TOKENS[e.button];
  if (!token) return null;
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + token;
}

/** 组合键是否为鼠标按键 (Electron accelerator 不支持, 菜单同步需跳过) */
export function isMouseCombo(combo: string): boolean {
  return /(^|\+)Mouse(Left|Middle|Right|4|5)$/.test(combo);
}

// ---- v330: 滚轮组合 ----
/** WheelEvent → 规范组合键 (如 "Alt+Wheel"; 方向不入键, 增减由动作内部按 deltaY 决定) */
export function comboFromWheelEvent(e: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + 'Wheel';
}

/** 组合键是否为滚轮 (Electron accelerator 不支持, 菜单同步需跳过) */
export function isWheelCombo(combo: string): boolean {
  return /(^|\+)Wheel$/.test(combo);
}

const hasModifier = (combo: string) => /^(Ctrl|Alt|Shift)\+/.test(combo);

// ---- 覆盖持久化 ----
function loadOverrides(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    const out: Record<string, string> = {};
    for (const a of HOTKEY_ACTIONS) if (typeof p[a.id] === 'string' && p[a.id]) out[a.id] = p[a.id];
    return out;
  } catch { return {}; }
}

let overrides: Record<string, string> = loadOverrides();

function persist() {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(overrides)); } catch { /* 忽略 */ }
}

/** 规范组合键 → Electron accelerator (Ctrl→CmdOrCtrl; 单键/F键原样) */
export function toElectronAccel(combo: string): string {
  return combo.replace(/^Ctrl\+/, 'CmdOrCtrl+');
}

/** 推送 accelerator 覆盖到主进程 (menuId 动作; 主进程重建菜单, 注册项真改键/显示项同步文字) */
function pushMenuAccels() {
  const map: Record<string, string> = {};
  for (const a of HOTKEY_ACTIONS) {
    if (!a.menuId) continue;
    const b = effectiveBindings(a.id)[0];
    if (isMouseCombo(b) || isWheelCombo(b)) continue; // v289/v330: 鼠标/滚轮不是合法 Electron accelerator, 跳过 (保留默认显示)
    map[a.menuId] = toElectronAccel(b);
  }
  try { getElectronAPI()?.setAcceleratorOverrides(map); } catch { /* 非 Electron */ }
}

/** 生效绑定: 有覆盖 = 仅覆盖键; 否则全部默认键 */
export function effectiveBindings(id: string): string[] {
  const a = HOTKEY_ACTIONS.find(x => x.id === id);
  if (!a) return [];
  const o = overrides[id];
  return o ? [o] : a.defaults;
}

export function getOverride(id: string): string | null { return overrides[id] ?? null; }

/** 该动作是否被用户改过键 (面板显示重置按钮用) */
export function isHotkeyOverridden(id: string): boolean { return overrides[id] != null; }

/** 事件 → 动作 id (带修饰精确匹配; 无修饰绑定忽略 Shift — 保持旧 Shift+Q=Q 行为) */
export function findHotkeyAction(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  const combo = comboFromEvent(e);
  if (!combo) return null;
  const shiftCombo = e.shiftKey ? combo.replace(/^Shift\+/, '') : null; // 去掉 Shift 后的组合 (无修饰绑定用)
  for (const a of HOTKEY_ACTIONS) {
    for (const b of effectiveBindings(a.id)) {
      if (b === combo) return a.id;
      if (shiftCombo && !hasModifier(b) && b === shiftCombo) return a.id;
    }
  }
  return null;
}

/** v288: 事件是否命中指定动作 (与 findHotkeyAction 同一匹配规则; TestPlayOverlay 击打键判定用) */
export function matchesHotkey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, id: string): boolean {
  const combo = comboFromEvent(e);
  if (!combo) return false;
  const shiftCombo = e.shiftKey ? combo.replace(/^Shift\+/, '') : null;
  for (const b of effectiveBindings(id)) {
    if (b === combo) return true;
    if (shiftCombo && !hasModifier(b) && b === shiftCombo) return true;
  }
  return false;
}

/** v289: 鼠标按键是否命中指定动作 (同一匹配规则, 组合来自 comboFromMouseEvent) */
export function matchesHotkeyMouse(e: Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, id: string): boolean {
  const combo = comboFromMouseEvent(e);
  if (!combo) return false;
  const shiftCombo = e.shiftKey ? combo.replace(/^Shift\+/, '') : null;
  for (const b of effectiveBindings(id)) {
    if (b === combo) return true;
    if (shiftCombo && !hasModifier(b) && b === shiftCombo) return true;
  }
  return false;
}

/** v330: 滚轮是否命中指定动作 (同一匹配规则, 组合来自 comboFromWheelEvent; deltaY 方向不参与匹配) */
export function matchesHotkeyWheel(e: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, id: string): boolean {
  const combo = comboFromWheelEvent(e);
  const shiftCombo = e.shiftKey ? combo.replace(/^Shift\+/, '') : null;
  for (const b of effectiveBindings(id)) {
    if (b === combo) return true;
    if (shiftCombo && !hasModifier(b) && b === shiftCombo) return true;
  }
  return false;
}

/** 冲突检测: combo 已被其他动作占用 (含无修饰 Shift 松弛) 则返回该动作 id;
    v330: conflictOk 列表中的动作语境互斥, 允许同键不算冲突 */
export function findConflict(combo: string, excludeId: string): string | null {
  for (const a of HOTKEY_ACTIONS) {
    if (a.id === excludeId) continue;
    if (a.conflictOk?.includes(excludeId)) continue;
    for (const b of effectiveBindings(a.id)) {
      if (b === combo) return a.id;
      // 无修饰绑定与 Shift+该键 等效 → 判冲突也要互相挡住
      if (!hasModifier(b) && combo === 'Shift+' + b) return a.id;
      if (!hasModifier(combo) && b === 'Shift+' + combo) return a.id;
    }
  }
  return null;
}

export function setHotkeyOverride(id: string, combo: string | null) {
  if (combo) overrides[id] = combo; else delete overrides[id];
  persist();
  pushMenuAccels();
}

export function resetAllHotkeys() {
  overrides = {};
  persist();
  pushMenuAccels();
}

/** 展示用键名 (v181: 不用符号字符, 方向键用英文; v289: 鼠标按键中文名; v346: i18n tNow) */
export function formatCombo(combo: string): string {
  const key = combo.split('+').pop()!;
  const pretty: Record<string, string> = {
    Space: tNow('hotkey.key.space', 'Space'), Escape: 'Esc', Delete: 'Del', Backspace: tNow('hotkey.key.backspace', 'Backspace'),
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
    MouseLeft: tNow('hotkey.key.mouse_left', 'Mouse Left'), MouseMiddle: tNow('hotkey.key.mouse_middle', 'Mouse Middle'),
    MouseRight: tNow('hotkey.key.mouse_right', 'Mouse Right'),
    Mouse4: tNow('hotkey.key.mouse4', 'Mouse Button 4'), Mouse5: tNow('hotkey.key.mouse5', 'Mouse Button 5'),
    Wheel: tNow('hotkey.key.wheel', 'Wheel'), // v330
  };
  const k = pretty[key] ?? key;
  return combo.slice(0, combo.length - key.length) + k;
}

/** v321 (F21): UI 提示用 — 动作当前生效主键的展示名 (改键后界面提示同步更新) */
export function hotkeyLabel(id: string): string {
  const b = effectiveBindings(id)[0];
  return b ? formatCombo(b) : '';
}

// ---- 捕获模式 (快捷键面板改键时, App.tsx 全局 keydown 不派发) ----
let capturing = false;
export function hotkeyCaptureActive(): boolean { return capturing; }
export function setHotkeyCapture(b: boolean) { capturing = b; }

// 模块加载即同步一次 (主进程首次 buildMenu 早于页面加载, 覆盖在页面侧)
pushMenuAccels();
