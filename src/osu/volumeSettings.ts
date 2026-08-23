// v144: 音量设置 (顶栏「音量」面板) — 纯数据层, 无 React, 供 store 音频总线直接读取
// 三级音量 (0-100): 主音量 * 歌曲音量 -> 音乐总线; 主音量 * 音效音量 -> hitsound 总线
// 对齐 osu! 主界面音论语义 (Master / Music / Effect), 持久化 localStorage
export interface VolumeSettings {
  /** 主音量 (对歌曲与音效同时生效) */
  master: number;
  /** 歌曲音量 */
  music: number;
  /** 音效音量 (hitsound/滑条循环) */
  effects: number;
}

const LS_KEY = 'osu-editor:volume-settings';

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

function loadVolumeSettings(): VolumeSettings {
  const def: VolumeSettings = { master: 100, music: 100, effects: 100 };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<VolumeSettings>;
    return {
      master: clamp(p.master ?? 100),
      music: clamp(p.music ?? 100),
      effects: clamp(p.effects ?? 100),
    };
  } catch { return def; }
}

/** 可变单例: 音频总线在 play/排程时直接读, 调整即时生效 */
export const volumeSettings: VolumeSettings = loadVolumeSettings();

/** 音乐总线增益 (主 * 歌曲, 0..1) */
export function musicGain(): number { return (volumeSettings.master / 100) * (volumeSettings.music / 100); }
/** 音效总线增益 (主 * 音效, 0..1) */
export function effectsGain(): number { return (volumeSettings.master / 100) * (volumeSettings.effects / 100); }

/** 调整音量并持久化 (UI 经 store.setVolume 调用以同步总线增益并触发重绘) */
export function setVolume(k: keyof VolumeSettings, v: number) {
  volumeSettings[k] = clamp(v);
  try { localStorage.setItem(LS_KEY, JSON.stringify(volumeSettings)); } catch { /* 隐私模式等忽略 */ }
}
