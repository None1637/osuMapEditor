// v132: 显示设置 (顶栏「显示设置」面板) — 纯数据层, 无 React, 供 renderer/lifecycle/Timelines 直接读取
// 默认值保持旧行为: 谱面自带颜色 / 无轨迹线 / 缩圈开 / 滑条渐出开 / 点击特效开
export interface DisplaySettings {
  /** 使用皮肤 skin.ini [Colours] 的物件/滑条颜色替代谱面自带颜色 (皮肤未定义时回退谱面颜色) */
  skinColors: boolean;
  /** 滑条身正中画一条细实线, 方便确认轨迹 */
  sliderPathLine: boolean;
  /** 物件出现时的缩圈动画 */
  approachCircle: boolean;
  /** 滑条结束后淡出 (关 = 结束立即消失) */
  sliderFadeOut: boolean;
  /** 单点命中后暂留放大淡出 (关 = 命中立即消失) */
  hitExplosion: boolean;
  /** v147: 单点命中后的放大动画 (开 = 240ms 放大 1.4x 淡出, lazer 同款;
      关 = 不放大, 命中后原大小残留 800ms 渐隐, osu!stable 编辑器同款; 需「点击特效」开启才有残留) */
  hitAnimation: boolean;
  /** v168: 背景图亮度 0-100 (渲染时的 globalAlpha 百分比; 默认 35 = 旧固定 alpha 0.35, 与之前表现一致) */
  bgBrightness: number;
}

/** 布尔开关键 (DisplayPanel 开关行用; bgBrightness 是数值, 走 setDisplayNumber) */
export type BoolDisplayKey = { [K in keyof DisplaySettings]: DisplaySettings[K] extends boolean ? K : never }[keyof DisplaySettings];

const LS_KEY = 'osu-editor:display-settings';

function loadDisplaySettings(): DisplaySettings {
  const def: DisplaySettings = {
    skinColors: false,
    sliderPathLine: false,
    approachCircle: true,
    sliderFadeOut: true,
    hitExplosion: true,
    hitAnimation: true,
    bgBrightness: 35, // v168: 旧固定 alpha 0.35
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<DisplaySettings>;
    return {
      skinColors: !!p.skinColors,
      sliderPathLine: !!p.sliderPathLine,
      approachCircle: p.approachCircle !== false,
      sliderFadeOut: p.sliderFadeOut !== false,
      hitExplosion: p.hitExplosion !== false,
      hitAnimation: p.hitAnimation !== false,
      bgBrightness: typeof p.bgBrightness === 'number' && isFinite(p.bgBrightness)
        ? Math.max(0, Math.min(100, Math.round(p.bgBrightness))) : def.bgBrightness, // v168: 钳制 0-100
    };
  } catch { return def; }
}

/** 可变单例: 渲染循环每帧直接读, 翻转开关即时生效 (rAF 驱动无需额外触发) */
export const displaySettings: DisplaySettings = loadDisplaySettings();

/** 翻转开关并持久化 (UI 经 store.setDisplayFlag 调用以 emitSelection 触发重绘) */
export function setDisplayFlag(k: BoolDisplayKey, v: boolean) {
  displaySettings[k] = v;
  try { localStorage.setItem(LS_KEY, JSON.stringify(displaySettings)); } catch { /* 隐私模式等忽略 */ }
}

/** v168: 数值项 (bgBrightness 0-100) 调整并持久化 */
export function setDisplayNumber(k: 'bgBrightness', v: number) {
  displaySettings[k] = Math.max(0, Math.min(100, Math.round(v)));
  try { localStorage.setItem(LS_KEY, JSON.stringify(displaySettings)); } catch { /* 隐私模式等忽略 */ }
}
