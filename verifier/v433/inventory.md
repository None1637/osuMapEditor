# v433 固定交互盘点对照表

盘点方法: grep EditorCanvas.tsx / Timelines.tsx / App.tsx 的鼠标键盘分支
(altKey/ctrlKey/metaKey/shiftKey/button/contextmenu/dblclick/wheel/keydown),
逐条对照右栏快捷键速查面板 (App.tsx 右栏底部 cheatsheet) 现有条目。

状态: ✅已有 = 速查面板已列; 📋注册表 = 在可改键注册表 hotkeys.ts (快捷键设置面板可见可改, 不算缺失);
➕新增 = v433 补入速查面板; — = 基础/隐含操作不单列 (注明原因)。

## 游玩区 · select 工具 (EditorCanvas)

| # | 手势 | 出处 | 状态 |
|---|------|------|------|
| 1 | 右键物件 = 删除 (选中则删整个选区) | v30/v114 onContextMenu:2615 | ➕ hk_rc_delete |
| 2 | 拖物件 = 移动 | objectPress:1677 | — 基础操作, hk_node_edit 同区已隐含 |
| 3 | 选框手柄拖 = 旋转/缩放; Shift = 吸附15°/锁比例; Alt = 默认原点 | v49/v50 selectionHandlePress:1587 | ➕ hk_handles |
| 4 | 空白拖 = 框选, Shift 追加 | marquee:1832 | ✅ hk_box_select |
| 5 | Ctrl/Shift+点击物件 = 加选/减选 | v40 objectPress:1682 | ✅ hk_ctrl_click |
| 6 | 点选锚点 (无修饰) | v410 singleSliderNodePress:1526 | ➕ hk_anchor_select (并入) |
| 7 | Alt+点锚点 = 切换选中 | v371/v410 nodeAltPress:1431 | ➕ hk_anchor_select |
| 8 | Alt+空白拖 = 锚点框选 | v266/v317 nodeAltPress | ➕ hk_anchor_select |
| 9 | Shift+点锚点/框选 = 减选 | v410/v317 | ➕ hk_anchor_select |
| 10 | Ctrl+点击滑条 = 插入锚点 (命中物件则不插, v413) | v319/v326/v413 :1550 | ➕ hk_anchor_ctrl |
| 11 | Ctrl+点锚点 = 拖动, 松手转红 | v118 :1545 | ➕ hk_anchor_ctrl |
| 12 | 右键锚点 = 删白点/红转白 (含头部 v400) | v29/v400 sliderAnchorContextPress:2589 | ➕ hk_anchor_rc |
| 13 | Delete 删选中锚点 | v424 | 📋注册表 delete 标签已含 → hk_delete 文案补锚点 |
| 14 | Ctrl+C/V 锚点复制粘贴 | v408 | 📋注册表 copy/paste → hk_copy_paste 文案补锚点 |
| 15 | 节点选区整组拖 | v362 nodeGroupDragPress | — 拖拽语义含于 #6 |
| 16 | 未选滑条非头锚点直接点拖 | v378 unselectedSliderNodePress:1663 | — 穿透链细节, #6 已涵盖操作感 |
| 17 | Ctrl+滚轮 = 节拍吸附 ×2/÷2 | v334 onWheel:2667 | ➕ hk_snap_wheel |
| 18 | Shift+数字 1..8 = 直接设细分 | v321 App:309 | ➕ hk_snap_wheel |
| 19 | Alt+滚轮 = 缩放游玩区 (平移开) / 调锁定间距 (平移关) | v229/v330 | 📋注册表 playfield-zoom-wheel / distance-lock-wheel |
| 20 | 中键拖动 = 平移游玩区 | v330 :1760 | 📋注册表 playfield-pan-drag (MouseMiddle) |
| 21 | 滚轮 = 按节拍走时间 | v193 onWheel:2697 | ✅ hk_wheel |

## 游玩区 · 放置工具 (slider/spinner)

| # | 手势 | 出处 | 状态 |
|---|------|------|------|
| 22 | Ctrl+点击 = 放红锚点 | :1882/:1898 | ➕ hk_slider_place |
| 23 | 按住拖动 = 手绘 (freehand) | v66/v74 :1876 | ➕ hk_slider_place |
| 24 | 双击末点 = 置红 (stable 语义, 不结束) | v208 :1856 | ➕ hk_slider_place |
| 25 | 右键 = 落幻影点并完成 / 点头部闭环 | v318 :2591 / :1868 | ➕ hk_slider_place |
| 26 | Esc = 取消放置 | — | 📋注册表 cancel |
| 27 | 转盘: 右键 = 完成放置 | v180 :2602 | — 右键完成通用语义同 #25, 不单列 |

## 游玩区 · 弹窗标记

| # | 手势 | 出处 | 状态 |
|---|------|------|------|
| 28 | 批量复制向量/对称锚点与轴点/网格原点/自定义原点标记可拖动 | v313 (dupVector/symAnchor/gridOrigin/originDragRef) | ➕ hk_marker_drag |

## 上方时间轴 (Timelines)

| # | 手势 | 出处 | 状态 |
|---|------|------|------|
| 29 | 拖物件头/连体条 = 改时间 (吸附节拍) | v32/v142 :903-947 | ➕ hk_tl_drag |
| 30 | 拖绿线药丸 = 改时间 | v102 :949 | ➕ hk_tl_drag |
| 31 | 拖滑条尾 = 改折返数 | v35 :869 | ➕ hk_tl_tail |
| 32 | **Alt+拖滑条尾 = 改 SV (绿线)** | v407 :886 | ➕ hk_tl_tail ← 用户点名缺失 |
| 33 | 拖转盘右缘 = 改时长 endTime | v320 :874 | ➕ hk_tl_drag |
| 34 | 点折返圆 = 选中节点 (Shift/Ctrl 加选) | v213 :897 | ➕ hk_tl_tail |
| 35 | 双击 BPM/SV 药丸 = 编辑窗口 | v63 :1071 | ➕ hk_tl_pill |
| 36 | 右键物件/绿线 = 删除 | v31/v113 :1077 | ➕ hk_tl_pill |
| 37 | 空白拖 = 框选, Shift 追加 (物件+绿线) | v45/v102 :963 | ✅ hk_box_select 语义涵盖 |
| 38 | Alt/Ctrl+滚轮 = 缩放时间轴 | v358 :1114 | 📋注册表 timeline-zoom-wheel |
| 39 | 滚轮 = 走时间 | v193 :1119 | ✅ hk_wheel |

## 下方时间轴 (BottomTimeline)

| # | 手势 | 出处 | 状态 |
|---|------|------|------|
| 40 | 点击/拖动 = 跳转时间 | Timelines:1382 | ➕ hk_tl_seek |
| 41 | 滚轮 = 走时间 | v193 :1384 | ✅ hk_wheel |

## 用户候选逐条答复

- Alt+拖滑条尾改 SV (v407): **确认缺失 → 已补 (hk_tl_tail)**
- 无修饰拖滑条尾改折返 (v35): 缺失 → 已补 (同条)
- Ctrl+点击插锚点 (v319/v326/v413): 缺失 → 已补 (hk_anchor_ctrl)
- Alt+点选锚点 (v371) / 不按 Alt 点选 (v410) / Shift 加选减选 (v410/v317) / Alt+框选 (v266/v317): 缺失 → 已补 (hk_anchor_select)
- Ctrl+点击物件多选 (v40): 已有 (hk_ctrl_click)
- 右键删锚点 (v400): 缺失 → 已补 (hk_anchor_rc)
- Delete 删选中锚点 (v424): 注册表 delete 标签已含 → 速查文案补锚点
- Ctrl+C/V 锚点复制粘贴 (v408): 注册表 → hk_copy_paste 文案补锚点
- 在锚点处分割 (v409): **无快捷键** (Inspector 按钮 splitSelectedSliderNodes, 注册表无此动作) — 无手势可列
- Alt+滚轮缩放游玩区 / 中键平移: **在注册表** (playfield-zoom-wheel / playfield-pan-drag), 不补
- Q/W/E/R 放置态预设: **在注册表** (hs-newcombo/whistle/finish/clap), 右栏顶部放置态指示条亦实时显示, 不补
- 双击时间轴: 仅药丸双击编辑 (v63) → 已补 (hk_tl_pill); 空白处双击无手势
- 时间轴拖物件改时间: 缺失 → 已补 (hk_tl_drag)
- Ctrl+拖拽: **无此手势** (Ctrl 仅用于点选/插锚点)
