// v381: 通用编辑器偏好 — 纯数据层, 无 React, 同 displaySettings 模式
// v386: UI 从快捷键设置面板「通用」区挪到菜单栏「设置」菜单 (checkbox 菜单项, electronMenu/main.cjs)
// 默认值保持旧行为: 数值框拖动调值开 / 物件移动死区 2px
export interface EditorPrefs {
  /** 数值输入框按住左右拖动调值 (DraftNum, v258/v269; 关 = 拖动不改值, 滚轮/键盘输入保留) */
  dragAdjustNumbers: boolean;
  /** 物件/note 起始移动死区 = 2px (开 = 2px, 现状; 关 = 1px;
      包围框缩放/旋转手柄与滑条锚点拖拽本就不走此死区, 不受影响) */
  moveDeadzone2px: boolean;
  /** v406: 滑条尾吸附节拍细分 (开 = 现状, 长度按当前细分 1/2 对齐; 关 = 放置拖尾与节点编辑后
      长度都直通几何全长, 不吸附) */
  sliderTailSnap: boolean;
  /** v443: 长度吸附细分 ×2 (开 = v218 行为, 按当前细分的 1/2 对齐; 关 = 默认, 按当前细分整格吸附)。
      从属于 sliderTailSnap 总开关 — 总开关关 = 长度直通几何全长不走吸附网格, 本开关无效果 */
  sliderHalfSnap: boolean;
}

export type EditorPrefKey = keyof EditorPrefs;

const LS_KEY = 'osu-editor:editor-prefs';

function loadEditorPrefs(): EditorPrefs {
  const def: EditorPrefs = {
    dragAdjustNumbers: true,  // v258/v269 起的行为
    moveDeadzone2px: true,    // v233 起的行为 (2px 起始死区)
    sliderTailSnap: true,     // v406: 吸附为现状默认
    sliderHalfSnap: false,    // v443: ×2 精度默认关 (用户要求; 开 = 恢复 v218 行为)
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<EditorPrefs>;
    return {
      dragAdjustNumbers: p.dragAdjustNumbers !== false,
      moveDeadzone2px: p.moveDeadzone2px !== false,
      sliderTailSnap: p.sliderTailSnap !== false,
      sliderHalfSnap: p.sliderHalfSnap === true, // v443: 默认关 — 遗留持久化无此键时取 false
    };
  } catch { return def; }
}

/** 可变单例: 交互代码直接读, 翻转开关即时生效 */
export const editorPrefs: EditorPrefs = loadEditorPrefs();

/** 翻转开关并持久化 (UI 经 store.setEditorPref 调用以 emitSelection 触发重渲染) */
export function setEditorPref(k: EditorPrefKey, v: boolean) {
  editorPrefs[k] = v;
  try { localStorage.setItem(LS_KEY, JSON.stringify(editorPrefs)); } catch { /* 隐私模式等忽略 */ }
}
