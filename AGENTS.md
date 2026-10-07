# AGENTS.md

## 界面图标规范 (v181)

- 界面图标一律使用 `lucide-react` 组件，**禁止使用 emoji / Unicode 符号图标**（如 🔊 📁 🎨 ★ ✕ ⏮ ◎ ⊞ ↩ 等）。
- 键盘按键提示文本（如 "Ctrl+Z"、"↑/↓"）不受此限。
- 按钮内图标与文字并排惯例：
  - 有文字：`<Icon className="inline-block w-4 h-4 mr-1 -mt-0.5" />文本`
  - 纯图标按钮：`<Icon className="w-4 h-4" fill="currentColor" />`（播放控制类实心图标用 `fill="currentColor"`）
- 常用映射：音量 Volume2、显示 Eye、曲库 FolderOpen、皮肤 Palette、锁定间距 Ruler、锁定物件 Lock/LockOpen、网格中心 Crosshair、限制游玩区 Box、辅助线 Magnet、配置 Settings2、pattern Package、波形 AudioWaveform、星数/收藏 Star、撤销/重做 Undo2/Redo2、关闭 X、确认 Check、音乐 Music、警告 TriangleAlert、播放控制 Rewind/Play/Pause/Square/FastForward、网格吸附 Grid3x3、旋转 RotateCcw/RotateCw、镜像 FlipHorizontal2/FlipVertical2。

## 参考 osu! 源码

- 本地已检出 lazer 源码：`D:\Projects\osuMapEditor\osu`（osu.Game / osu.Game.Rulesets.Osu 等）。查 lazer 实现一律直接读本地文件，**不要用 WebSearch/FetchURL 去 GitHub 抓源码**（网络代理对 github 域名不稳定，且本地版本才是基准）。

## 版本号与验证

- 每个需求对应一个版本号 vNNN，代码注释带 `// vNNN:` 前缀。
- 每个版本在 `verifier/vNNN/check.mjs` 写源码断言；全量回归跑 `verifier/v*/check.mjs`（跳过 v60）。

## 快捷键注册规则 (v289)

- **项目所有按键/鼠标按键快捷键必须注册进 `src/osu/hotkeys.ts` 的 `HOTKEY_ACTIONS`**，经快捷键设置面板可见、可改键；禁止在组件里硬编码按键判定（`e.key === ...` 形式的全局快捷键）。
- 组合键格式：`Ctrl+Shift+S`（修饰序 Ctrl→Alt→Shift）/ 单键 `Q` / 鼠标 `MouseLeft` `MouseMiddle` `MouseRight` `Mouse4` `Mouse5`（可与修饰组合，如 `Ctrl+MouseLeft`）。
- 派发用 `findHotkeyAction(e)`（键盘）/ `matchesHotkey(e, id)`（指定动作）/ `matchesHotkeyMouse(e, id)`（鼠标）。
- 豁免（不算全局快捷键，可保留组件内处理）：输入框/弹窗局部的 Enter/Escape、拖拽中的 Shift/Alt 修饰状态跟踪、快捷键面板自身的改键捕获。
