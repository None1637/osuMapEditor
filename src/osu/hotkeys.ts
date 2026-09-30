// v286: 快捷键注册表 + 自定义改键 (快捷键设置面板数据层, 无 React)
//  - HOTKEY_ACTIONS: 全部可改键动作 (App.tsx keydown 派发 + 原生菜单 accelerator 同步);
//  - 组合键规范格式: "Ctrl+Shift+S" / "Q" / "Delete" / "ArrowLeft" / "Space" / "," (修饰序 Ctrl→Alt→Shift);
//  - 匹配规则: 带修饰的绑定精确相等; 无修饰的绑定忽略 Shift (保持旧行为: Shift+Q 与 Q 等效);
//  - 覆盖语义: 用户改键替换该动作全部默认键 (如 delete 改键后 Backspace 不再删除);
//  - 持久化 localStorage 'osu-editor:hotkeys' (Record<actionId, combo>);
//  - Electron: menuId 非空的动作同步原生菜单 accelerator (经 preload setAcceleratorOverrides →
//    main.cjs buildMenu acc()), 注册的 (save/timing 4 项) 真改键, 其余仅菜单显示文字同步。
import { getElectronAPI } from './electronBridge';

export interface HotkeyAction {
  id: string;
  label: string;
  category: string;
  defaults: string[];   // 规范组合键, 首个为主键 (改键后替换全部)
  menuId?: string;      // 同步原生菜单 accelerator 的键 (main.cjs acc() 用同一 id)
}

// v181: 不用符号字符 — 展示名用 ASCII/中文
export const HOTKEY_ACTIONS: HotkeyAction[] = [
  // 播放/文件
  { id: 'play-pause', label: '播放/暂停', category: '播放/文件', defaults: ['Space'] },
  { id: 'test-play', label: '测试游玩', category: '播放/文件', defaults: ['F5'] }, // v287
  { id: 'save', label: '保存谱面', category: '播放/文件', defaults: ['Ctrl+S'], menuId: 'save' },
  // 编辑
  { id: 'undo', label: '撤销', category: '编辑', defaults: ['Ctrl+Z'], menuId: 'edit-undo' },
  { id: 'redo', label: '重做', category: '编辑', defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'], menuId: 'edit-redo' },
  { id: 'cut', label: '剪切', category: '编辑', defaults: ['Ctrl+X'], menuId: 'edit-cut' },
  { id: 'copy', label: '复制', category: '编辑', defaults: ['Ctrl+C'], menuId: 'edit-copy' },
  { id: 'paste', label: '粘贴', category: '编辑', defaults: ['Ctrl+V'], menuId: 'edit-paste' },
  { id: 'delete', label: '删除所选', category: '编辑', defaults: ['Delete', 'Backspace'], menuId: 'edit-delete' },
  { id: 'select-all', label: '全选物件', category: '编辑', defaults: ['Ctrl+A'], menuId: 'edit-select-all' },
  { id: 'cancel', label: '取消/清除选择', category: '编辑', defaults: ['Escape'] },
  { id: 'duplicate', label: '批量复制窗口', category: '编辑', defaults: ['Ctrl+D'], menuId: 'edit-duplicate' },
  // 工具
  { id: 'tool-select', label: '工具: 选择', category: '工具', defaults: ['1'] },
  { id: 'tool-circle', label: '工具: 单点', category: '工具', defaults: ['2'] },
  { id: 'tool-slider', label: '工具: 滑条', category: '工具', defaults: ['3'] },
  { id: 'tool-spinner', label: '工具: 转盘', category: '工具', defaults: ['4'] },
  // 变换
  { id: 'reverse', label: '反转选区', category: '变换', defaults: ['Ctrl+G'], menuId: 'edit-reverse' },
  { id: 'flip-h', label: '水平镜像 (游玩区中心)', category: '变换', defaults: ['Ctrl+H'], menuId: 'edit-flip-h' },
  { id: 'flip-v', label: '垂直镜像 (游玩区中心)', category: '变换', defaults: ['Ctrl+J'], menuId: 'edit-flip-v' },
  { id: 'rot-ccw', label: '逆时针旋转90° (游玩区中心)', category: '变换', defaults: ['Ctrl+,'], menuId: 'edit-rot-ccw' },
  { id: 'rot-cw', label: '顺时针旋转90° (游玩区中心)', category: '变换', defaults: ['Ctrl+.'], menuId: 'edit-rot-cw' },
  { id: 'open-rotate', label: '旋转窗口', category: '变换', defaults: ['Ctrl+Shift+R'], menuId: 'edit-open-rotate' },
  { id: 'open-scale', label: '缩放窗口', category: '变换', defaults: ['Ctrl+Shift+S'], menuId: 'edit-open-scale' },
  { id: 'polygon', label: '多边形生成', category: '变换', defaults: ['Ctrl+Shift+D'], menuId: 'compose-polygon' },
  // Hitsound (放置态 = 预设下次放置; select 工具 = 切换选中)
  { id: 'hs-newcombo', label: '新Combo (放置预设/选中切换)', category: 'Hitsound', defaults: ['Q'] },
  { id: 'hs-whistle', label: 'Whistle (放置预设/选中切换)', category: 'Hitsound', defaults: ['W'] },
  { id: 'hs-finish', label: 'Finish (放置预设/选中切换)', category: 'Hitsound', defaults: ['E'] },
  { id: 'hs-clap', label: 'Clap (放置预设/选中切换)', category: 'Hitsound', defaults: ['R'] },
  // 导航
  { id: 'nudge-time-prev', label: '选中物件前移一个吸附', category: '导航', defaults: ['J'], menuId: 'edit-nudge-prev' },
  { id: 'nudge-time-next', label: '选中物件后移一个吸附', category: '导航', defaults: ['K'], menuId: 'edit-nudge-next' },
  { id: 'jump-last', label: '跳到最后一个物件', category: '导航', defaults: ['V'] },
  { id: 'seek-left', label: '按节拍后退 (Shift=4拍)', category: '导航', defaults: ['ArrowLeft'] },
  { id: 'seek-right', label: '按节拍前进 (Shift=4拍)', category: '导航', defaults: ['ArrowRight'] },
  { id: 'ctrl-left', label: '左移选中1px (无选区: 跳到上个物件)', category: '导航', defaults: ['Ctrl+ArrowLeft'] },
  { id: 'ctrl-right', label: '右移选中1px (无选区: 跳到下个物件)', category: '导航', defaults: ['Ctrl+ArrowRight'] },
  { id: 'ctrl-up', label: '上移选中1px (无选区: 跳到前一条书签)', category: '导航', defaults: ['Ctrl+ArrowUp'] },
  { id: 'ctrl-down', label: '下移选中1px (无选区: 跳到后一条书签)', category: '导航', defaults: ['Ctrl+ArrowDown'] },
  { id: 'bookmark-add', label: '当前位置添加书签', category: '导航', defaults: ['Ctrl+B'] },
  { id: 'bookmark-remove', label: '删除最近的书签', category: '导航', defaults: ['Ctrl+Shift+B'] },
  { id: 'bookmark-prev', label: '跳到前一条书签', category: '导航', defaults: ['ArrowUp'] },
  { id: 'bookmark-next', label: '跳到后一条书签', category: '导航', defaults: ['ArrowDown'] },
  // 测试游玩 (v288: 击打键可改; v289: 鼠标按键可绑 — 默认左键同 Z 一起是击打键 1)
  { id: 'test-hit-1', label: '游玩击打键 1', category: '测试游玩', defaults: ['Z', 'MouseLeft'] },
  { id: 'test-hit-2', label: '游玩击打键 2', category: '测试游玩', defaults: ['X'] },
  { id: 'test-exit', label: '退出测试游玩', category: '测试游玩', defaults: ['Escape'] }, // v289
  // Timing (Electron 原生菜单注册 accelerator; 浏览器走 keydown)
  { id: 'timing-add-red', label: '添加红线 (Timing区间)', category: 'Timing', defaults: ['Ctrl+P'], menuId: 'timing-add-red' },
  { id: 'timing-add-green', label: '添加绿线 (继承区间)', category: 'Timing', defaults: ['Ctrl+Shift+P'], menuId: 'timing-add-green' },
  { id: 'timing-delete-current', label: '删除当前Timing区间', category: 'Timing', defaults: ['Ctrl+I'], menuId: 'timing-delete-current' },
  { id: 'timing-open-settings', label: 'Timing设置', category: 'Timing', defaults: ['F6'], menuId: 'timing-open-settings' },
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
    if (isMouseCombo(b)) continue; // v289: 鼠标按键不是合法 Electron accelerator, 跳过 (保留默认显示)
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

/** 冲突检测: combo 已被其他动作占用 (含无修饰 Shift 松弛) 则返回该动作 id */
export function findConflict(combo: string, excludeId: string): string | null {
  for (const a of HOTKEY_ACTIONS) {
    if (a.id === excludeId) continue;
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

/** 展示用键名 (v181: 不用符号字符, 方向键用英文; v289: 鼠标按键中文名) */
export function formatCombo(combo: string): string {
  const key = combo.split('+').pop()!;
  const pretty: Record<string, string> = {
    Space: '空格', Escape: 'Esc', Delete: 'Del', Backspace: '退格',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
    MouseLeft: '鼠标左键', MouseMiddle: '鼠标中键', MouseRight: '鼠标右键', Mouse4: '鼠标侧键4', Mouse5: '鼠标侧键5',
  };
  const k = pretty[key] ?? key;
  return combo.slice(0, combo.length - key.length) + k;
}

// ---- 捕获模式 (快捷键面板改键时, App.tsx 全局 keydown 不派发) ----
let capturing = false;
export function hotkeyCaptureActive(): boolean { return capturing; }
export function setHotkeyCapture(b: boolean) { capturing = b; }

// 模块加载即同步一次 (主进程首次 buildMenu 早于页面加载, 覆盖在页面侧)
pushMenuAccels();
