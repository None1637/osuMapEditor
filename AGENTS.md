# AGENTS.md

## 界面图标规范 (v181)

- 界面图标一律使用 `lucide-react` 组件，**禁止使用 emoji / Unicode 符号图标**（如 🔊 📁 🎨 ★ ✕ ⏮ ◎ ⊞ ↩ 等）。
- 键盘按键提示文本（如 "Ctrl+Z"、"↑/↓"）不受此限。
- 按钮内图标与文字并排惯例：
  - 有文字：`<Icon className="inline-block w-4 h-4 mr-1 -mt-0.5" />文本`
  - 纯图标按钮：`<Icon className="w-4 h-4" fill="currentColor" />`（播放控制类实心图标用 `fill="currentColor"`）
- 常用映射：音量 Volume2、显示 Eye、曲库 FolderOpen、皮肤 Palette、锁定间距 Ruler、锁定物件 Lock/LockOpen、网格中心 Crosshair、限制游玩区 Box、辅助线 Magnet、配置 Settings2、pattern Package、波形 AudioWaveform、星数/收藏 Star、撤销/重做 Undo2/Redo2、关闭 X、确认 Check、音乐 Music、警告 TriangleAlert、播放控制 Rewind/Play/Pause/Square/FastForward、网格吸附 Grid3x3、旋转 RotateCcw/RotateCw、镜像 FlipHorizontal2/FlipVertical2。

## 版本号与验证

- 每个需求对应一个版本号 vNNN，代码注释带 `// vNNN:` 前缀。
- 每个版本在 `verifier/vNNN/check.mjs` 写源码断言；全量回归跑 `verifier/v*/check.mjs`（跳过 v60）。
