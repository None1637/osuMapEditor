// v346: panels 模块 (VolumePanel / UnsavedDialog / TestPlayOverlay / DraggableDialog) 的 zh-CN 词典分片
export const zhCN: Record<string, string> = {
  // VolumePanel
  'volume.title': '音量设置',
  'volume.master': '主音量 (Master)',
  'volume.master_desc': '对歌曲与音效同时生效',
  'volume.music': '歌曲音量 (Music)',
  'volume.music_desc': '只影响歌曲播放',
  'volume.effects': '音效音量 (Effects)',
  'volume.effects_desc': '只影响 hitsound 与滑条循环音',
  'volume.note': '调整即时生效并自动记忆; 最终音量 = 主音量 × 歌曲/音效音量。',
  // UnsavedDialog
  'unsaved.title': '未保存的改动',
  'unsaved.message': '当前谱面{map}有未保存的改动, 继续将丢失这些改动。',
  'unsaved.cancel': '取消',
  'unsaved.discard': '废弃改动',
  'unsaved.saving': '保存中…',
  'unsaved.save_continue': '保存并继续',
  // TestPlayOverlay (mod 按钮 title / 顶部提示 / 退出按钮)
  'testplay.mod_ez': 'Easy: 难度全项减半',
  'testplay.mod_hr': 'HardRock: ×1.4 (CS×1.3) + 垂直翻转',
  'testplay.mod_ht': 'HalfTime: 0.75x',
  'testplay.mod_dt': 'DoubleTime: 1.5x',
  'testplay.mod_rx': 'Relax: 免按键',
  'testplay.mod_ap': 'Autopilot: 免瞄准',
  'testplay.mod_at': 'Autoplay: 全自动',
  'testplay.hint': '测试游玩 · {hit1}/{hit2} 击打 (含鼠标绑定) · {exit} 返回编辑器',
  'testplay.exit': '退出 (Esc)',
  // DraggableDialog
  'dialog.close_no_apply': '关闭 (不应用)',
};
