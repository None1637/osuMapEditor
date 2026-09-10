# Verifier 索引

> 开发流程、lazer 参考数值、CDP 用法与踩坑记录见 ../DEVELOPMENT.md（开发经验手册）。

## v1 (2026-07-25)
- 位置: verifier/v1/
- 运行: `cd /mnt/agents/output/app && node verifier/v1/check.mjs`
- 内容: osu解析器(物件/timing/colours)、CS/AR官方公式换算、timing查询(红/绿线/SV速度)、滑条路径(直线/三点圆弧/贝塞尔/红点分段)几何断言、serialize往返一致性。
- 首个版本。

## v2 (2026-07-25)
- 位置: verifier/v2/
- 运行: `cd /mnt/agents/output/app && node verifier/v2/check.mjs`
- 内容: 在 v1 基础上新增 — arToFadeIn 官方公式断言、绿线 kiai effects 位查询、转盘(spinner)序列化往返、kiai 标记往返保留、相同控制点重建路径一致性(节点编辑场景)。
- 与 v1 差异: 修正 AR 期望值为官方公式(AR9=600ms/AR10=450ms), 补充第二轮 UI 改动(滑条节点编辑/缩圈修复)对应的逻辑测试。

## v3 (2026-07-25)
- 位置: verifier/v3/
- 运行: `cd /mnt/agents/output/app && node verifier/v3/check.mjs`
- 内容: 保留核心回归(解析/公式/路径/往返), 新增 [Events] 背景文件名解析测试(带引号含空格、不带引号两种写法), 对应"打开.osu后加载音频与背景"改动。

## v4 (2026-07-25)
- 位置: verifier/v4/
- 运行: `cd /mnt/agents/output/app && node verifier/v4/check.mjs`
- 内容: 核心回归 + 以用户提供的真实谱面片段(Odorobo)为样例, 验证 [Editor](DistanceSpacing/BeatDivisor/GridSize/TimelineZoom)、完整 [General](Countdown/SampleSet/StackLeniency/Letterbox/WidescreenStoryboard)、[Metadata](Source/Tags/BeatmapSetID) 的解析与序列化往返保留。
- 与 v3 差异: 对应"基础数据页签"改动, 删除重复的 fadeIn/kiai 测试, 聚焦新增字段。

## v5 (2026-07-25)
- 位置: verifier/v5/
- 运行: `cd /mnt/agents/output/app && node verifier/v5/check.mjs`
- 内容: 核心回归 + 按用户提供的官方 AR 参考文档做全区间断言(AR0~11 preempt 公式、AR0=1800ms/AR10=450ms、AR5 上下 120/150ms 步进), 以及 fadeIn 严格等于 2/3×preempt。
- 与 v4 差异: 对应"缩圈速度修正 + WebAudio 采样级播放时钟 + 撤销后滑条路径缓存失效(残留修复)"改动; 播放时钟精度为运行时行为, 由浏览器冒烟测试覆盖。

## v6 (2026-07-25)
- 位置: verifier/v6/
- 运行: `cd app && node verifier/v6/check.mjs`
- 内容: M0 + M1 里程碑测试 —
  1) M0 无损往返: 以 本机Songs曲库目录 真实谱面(60 个 .osu)断言 parse→serialize→parse 两遍深度相等, [Events]/[Colours] 等未建模 section byte 级原文保留, hitSample/滑条边缘音效原始字段保留; 回归 AR/CS 官方公式、timing 查询、滑条路径。
  2) M1 AudioClock: Mock AudioContext 量子化时钟(2.9ms 量子) + 硬件漂移(0/50/500ppm) 仿真, 断言确定性锚定(start at W)+相位跟踪(EMA) 60 秒全程误差 < 1ms 且无启动瞬态(实测 max 0.55~0.67ms); heardNow 输出延迟补偿、暂停/恢复连续性、变速 0.5/0.75、ctxTimeForMapTime 排程换算。
  3) HitSoundScheduler: 事件恰好排程一次且时间正确、seek 静音、resync 不补播。
- 与 v5 差异: parser 重写为无损版(修复导出丢失 [Events] 背景行/[Colours]/可选尾字段的问题); store 集成 AudioClock + HitSoundScheduler(占位合成 hitsound), 修复"播放中 seek 丢失目标时间"bug, 新增变速播放与相位跟踪预热(tickClock)。

## v7 (2026-07-25)
- 位置: verifier/v7/
- 运行: `cd app && node verifier/v7/check.mjs`
- 内容:
  1) lifecycle 物件生命周期(修复"播放模式下滑条延迟数秒才消失"bug): slider/circle/spinner 的时长与结束时间(滑条时长 = pixelLength/速度×重复数, 含绿线 SV 变速减半)、淡入(preempt~fadeIn 线性)/滞留/结束后 240ms 线性淡出曲线全区间断言、isVisibleAt 渲染窗口边界(旧逻辑为 end+800ms 且全程 alpha=1)。
  2) library.parseQuickMetadata: TitleUnicode/ArtistUnicode 优先与回退、Mode 解析、缺省 Mode=0; 并对 本机Songs曲库目录 20 个真实谱面抽查(20/20 解析出标题; 真实谱面 Version 可能为空, 如 "+ - O.T.N")。
  3) 源码回归: renderer.ts 已接入 lifecycle 且旧 end+800ms 窗口移除。
- 与 v6 差异: 新增 src/osu/lifecycle.ts(纯函数) 并接入 renderer; 修复了测试发现的淡入区间被 guard 错误归零的真 bug (dt < -preempt+fadeIn 直接 return 0); 新增 src/osu/library.ts(File System Access 曲库) 与 SongLibrary 选歌界面。

## v8 (2026-07-25)
- 位置: verifier/v8/
- 运行: `cd app && node verifier/v8/cdp-smoke.mjs` (需 7100 dev server 已启动; 用本机无头 Edge + CDP 驱动真实 app)
- 内容: 浏览器级冒烟测试 — 注入 mock FileSystemDirectoryHandle(50 个歌曲目录), 验证曲库面板打开→选择目录→扫描渲染→点目录出难度列表全链路, 断言无 UI 错误/无未捕获异常/无页面异常; 收集 console 与 unhandledrejection。
- 背景: 用户报告内嵌预览中"选择目录后无反应无报错"; 该测试证明代码路径在真实 Chromium(Edge) 中工作正常, 问题定位为 Kimi 内嵌预览环境特有(showDirectoryPicker 选择后误报 AbortError, 已加无参数重试; 拖拽通道确认可用)。对应改动: SongLibrary 增加面板底部诊断日志(逐步可见)、Songs 文件夹拖拽导入备选通道(webkitGetAsEntry, 不依赖 showDirectoryPicker)、IDB 操作全部非阻塞+超时。
- 第二轮(2026-07-25): 新增断言 — 滚动容器高度被约束(修复 flex 子元素缺 min-h-0 导致容器撑到内容高、无法滚动且全量渲染的真 bug)、难度数徽标懒加载。对应改动: 左侧目录行难度数徽标(可视行懒加载+会话缓存)、右侧背景缩略图预览(getDirBackgroundUrl)、library 新增 countDifficulties/findFileInDir, ResizeObserver 跟踪列表高度。

## v9 (2026-07-25)
- 位置: verifier/v9/
- 运行: `cd app && node verifier/v9/check.mjs`
- 内容: hitsound 采样解析纯函数(parseHitSample "normalSet:additionSet:customIndex:volume" 段、setName/setNumFromGeneral、stemCandidates 序号候选与回退、soundsForHitSound 位标志、SAMPLE_FILE_RE 文件名正则) + fs 适配 FsDirLike 对真实曲库(本机Songs曲库目录)跑 collectSampleFiles(实测 15 个目录中 5 个含自定义采样共 64 个文件) + 合成占位音彻底移除的源码回归(store 不再引用 createHitSoundBuffers)。
- 对应改动: 应用户"默认音效太吵"要求, 删除全部合成 hitsound; 改为播放谱面目录/osz/同批拖入的真实采样(soft/normal/drum × hitnormal/whistle/finish/clap, 支持自定义序号 2+ 与回退), sample set 按 物件 hitSample → timing point → [General] SampleSet 逐级继承。后续补充: 从 ppy.osu.Game.Resources(nupkg, 解析 PE/CLI 元数据 + ManifestResource 表精确提取)拿到 osu! 经典默认 hitsound 12 个 wav 分发于 public/samples/, 回退链 = 谱面自定义(序号回退) → 默认同 set → 默认 normal 同音效; v9 回归断言 12 个文件均为有效 RIFF WAV。已知限制: 滑条边缘音效/slidertick/sliderslide/采样音量未实现。

## v10 (2026-07-25)
- 位置: verifier/v10/
- 运行: `cd app && node verifier/v10/check.mjs`
- 内容: planSliderSounds 纯函数全区间测试 — 边缘 repeat 音(无 edgeSounds 时继承物件 hitSound 位标志; edgeSoundsRaw "0|2|4"/edgeSetsRaw "0:0|2:2|3:3" 逐端点覆盖 set; hitnormal 始终伴随附加音)、hitSample 自定义序号主候选+回退(空 edge 字段占位 ",,,")、slidertick 节拍点(tickRate=2 且 span=beatLength 时每 span 内 250ms 间隔 1 个 tick)、绿线 SV 2x 下 span 减半边缘时刻同步提前、slide 循环区间; 默认滑条采样 6 个 wav(取自用户本机 osu! hitsound 目录)有效性; store 循环音接线回归(tickSlideLoops/stopSlideLoops/resyncLoops + pause 停止循环)。
- 对应改动: store 接入滑条音效全家桶 — 边缘/tick 事件进 HitSoundScheduler 采样级排程; sliderslide 以 loop AudioBufferSourceNode 按 250ms lookahead 排程并在 endMs 精确 stop, pause/seek/换谱立即停止全部活动循环; 默认采样加载清单扩展为 18 个(12 hitsound + 6 滑条)。

## v11 (2026-07-25)
- 位置: verifier/v11/
- 运行: `cd app && node verifier/v11/check.mjs`
- 内容: hitsound 与 osu! 行为对齐 (参照 lazer 源码逐项核对) —
  1) 音量: hitSample.volume > 0 覆盖 timing point volume, 否则用 timing point (绿线优先) volume; 下限 5% (lazer DrawableHitObject.MINIMUM_SAMPLE_VOLUME); 播放时经 GainNode 应用 (v11 前全程 100% 音量是"特别吵"主因)。
  2) 滑条 hitSample 只取 bank (lazer ConvertHitObjectParser banksOnly=true): 头/边缘节点音量 = 节点时刻 timing point volume, hitSample.volume 对滑条不生效 (stable 一致)。
  3) slidertick 距离制排布 (lazer SliderEventGenerator, v11 前错误地按 beatLength/tickRate 时间间隔): tickDistance = velocity×beatLength/tickRate (SM1.4/500ms/rate1 → 140px), 距端点 velocity×10ms 等效距离内不排, 反向 span 时刻镜像; SV 2x 下 tickDistance 同步翻倍。
  4) 头节点继承 edgeSounds[0]/edgeSets[0] (v11 前头部恒用物件 hitSound)。
- 对应改动: hitSounds.ts (objectVolume/clampVolume/sampleVolumeAt + planSliderSounds 增加 head/volume + sliderTickPoints 共享几何), HitSoundScheduler/store (HitSoundEvent.volume + GainNode 接线, 循环音同应用音量)。

## v12 (2026-07-25)
- 位置: verifier/v12/
- 运行: `cd app && node verifier/v12/check.mjs`
- 内容: 皮肤系统 — public/skin/ 24 个 PNG 有效性 (来源 osu!droid 客户端 assets/gfx, osu! 经典皮肤同款); skin.ts 文件加载+程序化回退+tintedSprite 乘算着色+withAlpha+getSkin 单例; renderer.ts osu! 着色规则 (hitcircle 白底乘算 combo 色 / overlay 原色, 不能反过来)、sliderstart/endcircle 专用贴图、距离制 tick 渲染 (sliderscorepoint)、reversearrow 朝右直接按切线角旋转、转盘三件套; Timelines.tsx 时间轴物件皮肤化 (combo 色贴图 + 折返箭头)。
- 对应改动: 重写 skin.ts/renderer.ts; EditorCanvas 改用 getSkin 单例; 时间轴圆点从纯色改皮肤贴图。

## v13 (2026-07-25)
- 位置: verifier/v13/
- 运行: `cd app && node verifier/v13/cdp-skin.mjs` (需 7100 dev server 已启动)
- 内容: 浏览器级皮肤渲染验证 — 无头 Edge 打开 app (自动加载演示谱面), 断言 7 个关键皮肤图全部可加载; 游玩区 canvas 像素分析含 combo 色着色像素 (24725) 与白色 overlay/数字像素 (4597); 顶部时间轴含 combo 色物件贴图; 播放 1.6s 后仍有着色物件 (滑条球/tick 期间); 全程无页面异常; 截图存档 verifier/runs/v13-paused.png / v13-playing.png 供人工复核 (人工确认: combo 色圆圈+皮肤数字、白描边滑条身+着色轨道、蓝色滑条球+金色跟随圈、折返箭头、tick 白点均正常渲染)。

## v14 (2026-07-25)
- 位置: verifier/v14/
- 运行: `cd app && node verifier/v14/cdp-audio-dump.mjs` (需 7100 dev server 已启动)
- 内容: 浏览器级 hitsound 事件表插桩 — store 新增 debugState()/debugLog 调试设施(保留), 无头 Edge 播放演示谱面 3s, 断言排程事件数与谱面内容逐一吻合(14 条/3s: hitnormal/tick/loop 比例正确)、0 MISS、全走 def:normal-* 回退、volume=80 (timing point), sliderslide loop 每条只启动一次。
- 对应改动: 修复"音效特别吵"真凶 — EditorCanvas 渲染循环每帧 store.emit() bump version, 而 rebuildEventsIfDirty 以 version 为失效键 → 每帧重建事件表 + resync → 250ms lookahead 内事件每帧重复排程(修复前 196 事件/3s, 十几层叠加 + slide 循环每帧重启 = 噪音墙)。修复: store 拆分 dataVersion (仅 emit() 递增) 与 version, 新增 emitPlayback() (播放中高频 UI 刷新不使事件表失效), rebuildEventsIfDirty 改用 dataVersion, EditorCanvas 播放帧改调 emitPlayback()。

## v15 (2026-07-25)
- 位置: verifier/v15/
- 运行: `cd app && node verifier/v15/check.mjs`
- 内容: 滑条编辑对齐 lazer + 皮肤文件夹选择与记忆 —
  1) computePendingPath 纯函数单测 (tests.ts, esbuild 打包执行): inferSegmentType 段内 1~2 点 L / 3 点 P / 4+ B (lazer updatePathType); 长度=路径几何全长 (不再强制一拍长); 红点分段控制点加倍且 raw 在红点处恰好衔接一次; 末尾红点不加倍; cursor 幻影点参与预览但不进导出 controlPoints, 贴近末点 2px 内忽略。
  2) 源码接线断言: renderer.renderPlayfield 第三参 cursor + drawPendingSlider 真实滑条身预览; EditorCanvas 点末点(<8px)切换红锚点、finishSlider 用几何全长(锁定间距时吸附最近整拍)、旧直线幽灵预览已删。
  3) 皮肤目录: library.ts 泛化 pickDir/restoreDir + KEY_SKIN_DIR/pickSkinDir/restoreSkinDir/forgetSkinDir (IndexedDB 持久化 FileSystemDirectoryHandle); skin.ts applySkinFromDir (SKIN_FILES+default-0..9 逐字段加载, @2x 优先, 缺失保留程序化回退, objectURL 统一释放) + resetSkinToDefault; store.ts applySkinSamples (皮肤 hitsound 覆盖同名默认 stem, 迟到的内置默认采样不回写) + resetSkinSamples; SkinPicker 面板 (选择/拖拽/授权/恢复默认) + App.tsx 工具栏入口与启动时静默恢复已授权皮肤。
- 对应改动: sliderPath.ts/renderer.ts/EditorCanvas.tsx (滑条放置), library.ts/skin.ts/store.ts/SkinPicker.tsx/App.tsx (皮肤系统)。

## v16 (2026-07-25)
- 位置: verifier/v16/
- 运行: `cd app && node verifier/v16/check.mjs`; `node verifier/v16/cdp-memory.mjs` (需 7100 dev server 已启动)
- 内容: 曲库目录记忆修复 — 用户报告"选完曲库目录后不关闭浏览器, 重开曲库面板仍要重选"。根因: 持久化完全依赖 IndexedDB, idbPut 失败被静默吞掉, idbGet 挂起 2s 超时按无记录处理, 会话内无任何兜底。修复: library.ts 模块级会话记忆 (memSongsDir/memSkinDir, 选择/拖拽立即写入, restore 优先命中, 同会话 handle 保持授权), IDB 写入改为有界等待(2s)且结果经 getLastPersistError 可见, 恢复失败原因经 getLastRestoreReason 可见, 新增 idbSelfTest 自检(面板无记录时自动跑并显示)。CDP 端到端: mock 50 歌曲目录 → 选择 → 关面板 → 重开 → 自动恢复并重扫 50 行不再要求选择; 持久化结果日志可见(mock handle 不可 clone 时正确显示 DataCloneError 诊断); headless Edge IDB 自检 ok。
- 对应改动: library.ts (rememberSongsDir/rememberSkinDir/getRemembered*/idbSelfTest/getLastPersistError/getLastRestoreReason, pickDir 有界持久化, restore* 记忆优先, forgetSkinDir 清记忆), SongLibrary.tsx (会话记忆兜底 + 诊断日志 + 拖拽写记忆), SkinPicker.tsx (同)。v15 断言同步修正 (pickSongsDir/pickSkinDir 改 async)。

## v17 (2026-07-25)
- 位置: verifier/v17/
- 运行: `cd app && node verifier/v17/check.mjs`; `node verifier/v17/cdp-latency.mjs` / `node verifier/v17/cdp-transform.mjs` (需 7100 dev server 已启动)
- 内容:
  1) hitsound 排程延迟修复 — 用户报告"播放中物件音效明显延迟"。根因: AudioClock.ctxTimeForMapTime 误把目标时刻再减 phaseSec; phaseSec 是 perf 时钟与 ctx 时钟的原点差 (真实浏览器 ≈ -(页面加载到 ctx 启动的秒数), 首次按播放才 resume 时可达数秒~数十秒), 导致全部 hitsound (含 sliderslide 循环) 统一推迟该时长。v6 mock 两时钟同原点 (phaseSec≈0) 从未暴露。修复: 锚点 phaseStartSec 本就是 ctx 时刻, 排程时刻直接线性外推, 与相位估计无关。CDP 复现 (修复前): 事件表全部 12 个事件统一晚 452.7ms = |phaseSec| 分毫不差; 修复后 12/12 精确匹配, max 误差 0.0ms。单测回归: 非零原点 (ctx 晚 30s 启动) + 500ppm 漂移下排程时刻严格等于 W+(t-t0)/rate。
  2) P0-1 框选 + 多选变换 — 新增 src/osu/transform.ts 纯函数 (selectionCenter/rotateObjects/flipObjects/scaleObjects/objectsInRect): 围绕选区包围盒中心旋转/镜像/缩放, 滑条全部控制点整体变换 (curvePoints 绝对坐标, 旧拖拽只动头部会拉变形, 一并修复), 缩放同步 pixelLength, 转盘位置固定不参与。EditorCanvas 空白处拖拽框选 (Shift 追加, 实时更新, 点击空白仍清空); store.rotateSelected/flipSelected/scaleSelected (一次操作一次 undo); Ctrl+G 旋转 90° (Shift 逆时针) / Ctrl+H 水平 / Ctrl+J 垂直镜像; Inspector 变换按钮 (±90°/镜像/±10%)。选择集刷新改走 emitSelection 不再 bump dataVersion (框选期间不再每 mousemove 重建 hitsound 事件表)。
  3) CDP 端到端: 真实鼠标事件框选 23 物件与 objectsInRect 逐一吻合, Shift 追加 23->24, 旋转 22/24 变化 (2 转盘不参与), 滑条控制点整体旋转, undo 完整还原, 点击空白清空。
- 对应改动: AudioClock.ts (ctxTimeForMapTime 修复), transform.ts (新), store.ts (变换方法 + emitSelection), EditorCanvas.tsx (框选 + 滑条整体拖拽), App.tsx (快捷键), Inspector.tsx (变换面板)。

## v18 (2026-07-25)
- 位置: verifier/v18/
- 运行: `cd app && node verifier/v18/check.mjs`; `node verifier/v18/cdp-visual.mjs` (需 7100 dev server 已启动)
- 内容: 三项渲染对齐 lazer (ppy/osu master 源码逐项核对) —
  1) 编辑区物件尺寸: 依据 OsuHitObject(OBJECT_RADIUS=64, Radius=64*Scale) 与 LegacyMainCirclePiece(贴图盒子=OBJECT_DIMENSIONS), hitcircle/overlay/滑条头尾/折返箭头贴图盒子统一为精确 2r (r=54.4-4.48*CS), 删除历史遗留的 1.12 补偿放大 (圆圈曾整体大 12%); 数字高 = 52px/128 盒子, 字距 = 字宽+HitCircleOverlap(-2) 即 33/35; 跟随圈 = FOLLOW_AREA(2.4)x; 命中放大 1.4x (legacy_fade_duration 240ms); EditorCanvas 幽灵预览同步。
  2) 上方时间轴: 按 TimelineHitObjectBlueprint 重写 — circle_size=32px 圆头圆角条 (ExtendableCircle, 端帽超出时间范围 16px), 时长物件水平渐变 Lighten(0.4), 圆头内 combo 序号 (字号 circle_size*0.5, ForegroundTextColourFor 对比色), 折返节点 = circle_size/4 (8px) 小圆, 选中 = 黄色边框 (OsuColour.Yellow); 弃用皮肤贴图渲染 (v12 断言同步修正)。
  3) 选中滑条控制点连接线: 按 PathControlPointConnection (SmoothPath, PathRadius=1) 用 2px 白线依次连接全部控制点, 直观呈现贝塞尔/圆弧控制多边形, 画在白色手柄点之下。
- CDP: 弦中点白色线像素命中 (53/60), 时间轴物件条高实测 36px (含边框, 旧版 16px), 截图 verifier/runs/v18-editor.png 人工复核通过; v13 皮肤渲染回归通过。

## v19 (2026-07-25)
- 位置: verifier/v19/
- 运行: `cd app && node verifier/v19/check.mjs`; `node verifier/v19/cdp-visual.mjs` (需 7100 dev server 已启动)
- 内容: 滑条身宽度/分层对齐 lazer LegacySliderBody (经典皮肤) — 用户报告"滑条明显比单点粗"。根因: 旧实现白描边宽 2.1r (大于单点直径 2r) 且轨道下有 rgba(18,18,26,0.9) 暗底层。依据本地 osu/ 克隆逐项核对: PlaySliderBody.PathRadius = OBJECT_RADIUS*Scale → 滑条身总宽 = 2r 与单点同宽; LegacySliderBody.ColourAt (position 0=最外缘→1=圆心): shadow_portion=5/64≈0.078 外缘阴影, border_portion=0.1875 白边 → 白边外径 1.844r, 轨道外径 1.625r; 轨道 = (SliderTrackOverride ?? combo色).Opacity(0.7) 径向 Darken(0.1)→Lighten(0.5) (Colour4.Lighten: amount×0.5 后 c*(1+0.5a)+a)。实现: renderer.ts 抽出 strokeSliderBody 五层 (外缘阴影 2r / 白边 1.844r / 轨道 1.625r Darken(0.1) / 1.1r 过渡 / 0.6r Lighten(0.5)), drawSlider 与 drawPendingSlider 共用, 删除暗底层。
- CDP: 页面内隔离 P 滑条 (删除其他物件避免缩圈干扰) 后垂直扫描线实测横截面 — 总宽 1.824r (期望 1.844r, 旧版 2.1r), 轨道 1.623r (期望 1.625r), 白边环 0.20r (期望 0.22r), 轨道中心 max 通道 179 (内部暗, 带 combo 色调); 截图 verifier/runs/v19-slider.png 人工复核: 滑条身与头尾圆圈同宽, 白边亮环 + 内部暗色渐变轨道与 lazer 一致。回归: v12/v15/v17/v18 check 全绿。
- 修订 (同日, 用户报告"内部太亮, lazer 内部是暗的仅边缘亮"): 初版把白边整条描边垫在 0.7 alpha 轨道下, 白色衬底把内部洗白 (中心 max 253)。改为离屏合成 (paintSliderBody + sliderBodySprite): 白边整条描边后 destination-out 镂空内部成环 → 轨道用 destination-over 窄->宽不透明渐变垫进镂空 → destination-out 0.3 把轨道区域统一降到 0.7 alpha, 内部透出深色游玩区背景; 已放置滑条按物件 id 缓存离屏结果 (invalidatePath 同步失效), 放置预览用共享 scratch canvas 不缓存。
- 修订 2 (同日, 用户报告"滑条边缘锯齿严重"): 离屏位图原按 osu 原生分辨率 (1 osu px = 1 位图像素) 绘制, 主画布变换为 dpr*scale (通常 2~4x), drawImage 放大后边缘锯齿。修复: sliderBodySprite 按 g.getTransform().a 超采样 (钳制 [1,4]) 高分绘制再 drawImage 缩回 osu 坐标矩形, 缓存 key 含超采样倍数; 放大截图复核边缘平滑无阶梯。
- 修订 3 (2026-08-09, 用户要求对齐 stable 观感试看): 轨道基色改纯黑, lazer 三级离散渐变描边与 lazerLighten 公式**整段注释备查** (renderer.ts paintSliderBody; 恢复 lazer 观感 = 取消注释 + 删 '#000' 填充行)。check/CDP 断言同步: 扫描线黑轨道 = 比背景暗的像素 (0.7 alpha 纯黑叠背景), 中心须为中性黑灰 (通道差 ≤12); v38/v39 滑条身探针改双向判据 (亮于背景=白边 或 暗于背景=黑轨道); v93 缩略图墨迹探针从粉色轨道改白边环白色墨迹。
- 对应改动: renderer.ts (paintSliderBody/sliderBodySprite/bodyCache/lazerLighten, drawSlider/drawPendingSlider 滑条身重写)。

## v20 (2026-07-25)
- 位置: verifier/v20/
- 运行: `cd app && node verifier/v20/check.mjs`; `node verifier/v20/cdp-persist.mjs` (需 7100 dev server 已启动)
- 内容: 曲库/皮肤目录跨会话记忆修复 — 用户报告"每次刷新浏览器都忘记之前选的目录, 日志提示无已保存的目录记录"。排查: verifier/v19/cdp-idb-probe.mjs 实验证明标准 Chromium 下 FileSystemDirectoryHandle 经 IndexedDB 跨整页刷新往返正常 (含 queryPermission), 排除机制本身; 推断根因为**早期版本遗留的同名 v1 库不含 settings store** — openDB 硬编码 v1 时 open 成功 (版本相同不触发 upgrade), 但 transaction('settings') 抛 NotFoundError, 写入静默失败, 每次刷新自然"无记录"。修复 (library.ts):
  1) openDB 升 DB_VERSION=2, onupgradeneeded 改 objectStoreNames.contains 守卫补建 settings — 陈旧库自动补 store, 存量正常库不会因重复 createObjectStore 抛 ConstraintError (此守卫必需, 否则反而破坏正常用户);
  2) idbPutVerified 写入后立即读回校验, pickDir 改用它 (3s 有界等待 + 迟到拒绝吞掉), 落库失败当场经 getLastPersistError 可见, 不再"以为存上了实际没存上"。
- CDP 端到端: 场景 A 预建只含 legacy store 的 v1 陈旧库 → 应用加载后 idbSelfTest=ok, 库升 v2 且 settings/legacy 并存, sentinel 数据未丢; 场景 B 写入 OPFS 目录句柄 → 整页刷新 → restoreSongsDir() 恢复出 kind=directory granted=true。v16 cdp-memory 回归通过。
- 对应改动: library.ts (DB_VERSION/openDB 守卫/idbPutVerified/pickDir)。

## v21 (2026-07-25)
- 位置: verifier/v21/
- 运行: `cd app && node verifier/v21/check.mjs`; `node verifier/v21/cdp-drop.mjs` (需 7100 dev server 已启动)
- 内容: 拖拽导入的目录也可跨会话记忆 — v20 修复后用户仍报告"刷新后无已保存的目录记录 (IndexedDB 中无记录)"。根因 (与 v20 的 schema 问题是两个独立缺陷): 用户实际走**拖拽通道**导入 (picker 异常时 UI 也主动引导拖拽), 而旧实现 dirHandleFromDrop 用 webkitGetAsEntry, 返回的 FileSystemDirectoryEntry 无法结构化克隆进 IndexedDB, 代码注释明写"拖拽句柄无法持久化", 每次刷新必然无记录。修复:
  1) library.ts 新增 dirHandleFromDropEx — 优先 DataTransferItem.getAsFileSystemHandle() (Chrome/Edge 86+), 返回的原生 FileSystemDirectoryHandle 可入 IndexedDB; 旧 API 回退 native=null 仅会话内;
  2) 抽出 persistDirHandle 共用 (选择器/拖拽同一 写入+读回校验 链), 导出 persistSongsDirHandle/persistSkinDirHandle;
  3) SongLibrary/SkinPicker 拖拽处理器改 async: 拿到原生句柄即落库 + 会话记忆带 native, 日志显示"目录已记住 (下次自动恢复)"或具体失败原因; v16 两处旧断言同步修正 (remember*Dir(d, null) -> (d.dir, null))。
- CDP 端到端: 环境能力探测 (getAsFileSystemHandle=function) → mock DataTransferItem 走 dirHandleFromDropEx 拿到 native=directory → persistSongsDirHandle=ok → 整页刷新 → restoreSongsDir 恢复 kind=directory granted=true。回归: v12/v15/v16/v17/v18/v19/v20 check 全绿, v16 cdp-memory 通过。
- 对应改动: library.ts (dirHandleFromDropEx/persistDirHandle/persist*DirHandle), SongLibrary.tsx, SkinPicker.tsx。

## v22 (2026-07-25)
- 位置: verifier/v22/
- 运行: `cd app && node verifier/v22/check.mjs`; `node verifier/v22/cdp-perm.mjs` (需 7100 dev server 已启动)
- 内容: 曲库恢复"待授权"时授权按钮不显示 — 用户报告刷新后日志"已恢复目录「Songs」, 权限=待授权"但面板无授权按钮。根因: SongLibrary JSX 三态为 `{!root ? 选择页 : permNeeded ? 授权页 : 列表页}`, 而恢复流程 granted=false 分支只 setPermNeeded(true) 从不 setRoot — root=null 永远命中选择页分支, 授权页不可达。修复: 恢复成功即无条件 setRoot (授权分支依赖 root 非空), granted 才 startScan。SkinPicker 对照检查无此问题 (授权按钮只看 permNeeded)。
- CDP 端到端: IDB 预置 OPFS 句柄 + monkeypatch FileSystemDirectoryHandle.prototype.queryPermission 强制 'prompt' → 开曲库面板 → 授权按钮可见且不再错显选择页 → 点击授权 → 进入列表视图。回归: v16/v20/v21 check + v16 cdp-memory 全绿。
- 对应改动: SongLibrary.tsx (恢复分支 setRoot)。

## v23 (2026-07-26)
- 位置: verifier/v23/
- 运行: `cd app && node verifier/v23/check.mjs`; `node verifier/v23/cdp-stack.mjs` (需 7100 dev server 已启动)
- 内容: P0 物件堆叠 (stacking) 渲染 — 时间窗内位置接近 (<3 osu px) 的物件显示时逐层向左上偏移。算法逐行移植 lazer `osu.Game.Rulesets.Osu/Beatmaps/OsuBeatmapProcessor.cs` applyStacking (BeatmapVersion>=6 新算法, 本项目谱面均 v14): STACK_DISTANCE=3; stackThreshold = floor(preempt)*stackLeniency (preempt 用 arToPreempt); 反向主循环中 HitCircle 分支向上找同位置前物件 StackHeight+1 (时间比较 `(int)objectI.StartTime - (int)endTime > threshold` 整数截断对齐 stable), 遇滑条且其几何 EndPosition 距当前物件 <3 触发负堆叠特例 (链上物件 StackHeight -= offset, 显示在滑条尾下/右); Slider 分支从该滑条起 ALWAYS 正向堆叠 (前物件 EndPosition 距滑条头 <3 则 +1); Spinner 跳过。方向确认: 反向循环 `objectN.StackHeight = objectI.StackHeight + 1`, objectN 时间更早 → 越早的物件 StackHeight 越大、往左上 (-x-y) 让, 最晚的在原地 (SH=0)。偏移 = StackHeight * r * -0.1 同施于 x/y (lazer StackOffset = StackHeight*scale*-6.4, scale=r/64), r=csToRadius(cs)。GetEndTime: circle=time, slider=time+length/velocity*slides (sliderVelocityAt), spinner=endTime; slider EndPosition = getSliderPath positionAt(length) 几何末端 (不考虑折返)。
- 实现: 新增 src/osu/stacking.ts (computeStackHeights/computeStackOffsets 纯函数); getSliderPath 带缓存从 renderer.ts 挪到 sliderPath.ts (renderer re-export 兼容旧调用, invalidatePath 仍清 bodyCache, 避免 stacking→renderer 循环 import); RenderCtx 新增 stackOffsets, drawCircle 位置加偏移, drawSlider 整体 g.translate (滑条身/头尾/折返箭头/tick/滑条球), 选中高亮虚线与控制点手柄随偏移, pending 预览不偏移; EditorCanvas 按 store.getDataVersion() (新增只读访问) 缓存重算偏移, 点击命中/控制点手柄命中/框选 (objectsInRect 新增可选 offsets 参数) 均用堆叠后位置, 拖拽/放置仍存原始坐标; Timelines 不变。
- 实测: 单测 9 组 (两/三连堆方向 2/1/0、阈值边界 Δ=600 堆/601 不堆 (leniency=1)、距离边界 2.9 堆/3.0 不堆、滑条末端负堆叠 SH=-1、折返滑条仍按几何末端堆叠、spinner 不参与、滑条头正向堆叠); CDP 注入 3 个同位置 circle (5000/5100/5200) + 远处参照圆, 对角线饱和度探针实测: 堆叠组比参照圆向左上多伸出 7.34 osu px (理论 2 层 × 0.1r = 7.296), 右下端齐平 (差 0.00), 无页面异常; 截图 verifier/runs/v23-stack.png 人工复核: 三层 circle 依次向左上错开、最早的 "1" 在最上层, 与 stable 观感一致。回归: v12/v15/v17/v18/v19/v20/v21/v22 check 全绿, `npx tsc -b` 通过。
- 对应改动: stacking.ts (新), sliderPath.ts (getSliderPath/invalidateSliderPath), renderer.ts (RenderCtx.stackOffsets + 三处绘制偏移 + re-export), store.ts (getDataVersion), transform.ts (objectsInRect offsets), EditorCanvas.tsx (偏移缓存/渲染/命中)。

## v24 (2026-07-26)
- 位置: verifier/v24/
- 运行: `cd app && node verifier/v24/check.mjs`; `node verifier/v24/cdp-hitsound.mjs` (需 7100 dev server 已启动)
- 内容: P0 hitsound 快捷键 + Inspector hitsound 编辑。快捷键对齐 lazer/stable (lazer 本地克隆 `osu.Game/Screens/Edit/Compose/Components/...` 同套键位): Q=toggle newCombo (只切 newCombo 位, ComboSkip 不动), W/E/R=toggle hitSound 的 whistle(2)/finish(4)/clap(8) 位, 作用于全部选中物件, 无选中无操作, 输入框聚焦时不触发 (复用现有 INPUT/SELECT/TEXTAREA guard), 一次按键=一次 undo 快照。Inspector 新增 Hitsound 区块 (单选/多选均显示): whistle/finish/clap 三 checkbox (normal 位是缺省不做), normalSet/additionSet 下拉 (0=Auto 继承/1=Normal/2=Soft/3=Drum), customIndex (≥0, 0=无) 与 volume (0=继承 timing point, 否则钳制 5~100) 数字输入; 多选批量应用, 值不同显示"混合"占位, 修改统一应用到全部选中物件; hitSample 编辑保留原 filename 段, 全默认 (0:0:0:0) 且无 filename 时 hitSampleRaw 置 undefined -> 序列化省略该字段 (.osu 格式允许省略, parser 原样保留既有"0:0:0:0:"行不改)。所有编辑只改数据不改几何: emit() bump dataVersion -> hitsound 事件表自动重建, 不碰滑条路径缓存; 滑条 edgeSounds/edgeSets 逐端点覆盖不在本期, 未动。
- 实现: store.ts 新增 applyToSelected (pushUndo+emit 共用骨架, 仿 applyTransform) + toggleSelectedHitSound/toggleSelectedNewCombo/setSelectedHitSoundBit/applyHitSampleToSelected; hitSounds.ts 新增纯函数 hitSampleFilename/buildHitSampleRaw; App.tsx 注册 Q/W/E/R (无修饰键分支, guard 在前) + 帮助面板条目; Inspector.tsx 新增 HitSoundPanel (data-hs 标记供 CDP 定位), 多选视图也挂载。
- 实测: check.mjs 纯函数 5 组 (位 toggle/ newCombo flags=5 与 comboSkip=2 保留/ buildHitSampleRaw 省略与 filename 保留/ serializeOsu 往返 hitSound 位与 hitSample 字段/ 多选批量语义) + 接线断言 (store 方法/快捷键注册/Inspector 区块/guard 顺序/不失效几何缓存) 全绿; CDP 端到端 19 断言: W 置 whistle 位且一次 undo 还原、E/R 叠加、Q 翻 newCombo 且 comboSkip 不动、多选按 W 三物件批量置位一次 undo 全还原、输入框聚焦按 W 不触发、Inspector 改 volume/customIndex/normalSet 得 hitSampleRaw="3:0:2:80:" 且三次 undo 逐步撤销 (末次全默认字段省略)、checkbox 置位/清位、全程无页面异常; 截图 verifier/runs/v24-inspector.png 人工复核: Hitsound 区块三 checkbox + 双下拉 + 双数字输入布局正常。回归: v12/v15/v17/v18/v19/v20/v21/v22/v23 check 全绿, `npx tsc -b` 通过。
- 坑: ① CDP 页面代码多个 Runtime.evaluate 共享全局作用域, 顶层 const 重复声明抛 SyntaxError — 页面代码一律包 IIFE 且尾表达式显式 return; ② Inspector 内联组件每次 emit 重渲染会整棵替换 DOM 子树, CDP 连续操作同一节点需每次重新 querySelector (既有 Num 输入同款, 逐键失焦为已知既有模式); ③ 测试脚本自身 bug: R 键步骤已置 clap 位, checkbox 断言需按"清位再置位"写。
- 对应改动: store.ts, clock/hitSounds.ts, App.tsx, Inspector.tsx。

## v25 (2026-07-26)
- 位置: verifier/v25/
- 运行: `cd app && node verifier/v25/check.mjs`; `node verifier/v25/cdp-nodes.mjs` (需 7100 dev server 已启动)
- 内容: P0-4 已建滑条的节点编辑 (选中单个滑条 + 选择工具时生效) —
  1) 插入节点: 点击控制点连接线 (白色多边形线段, 距线段 <6 osu px) → 按投影参数 t 在线段最近点插入白色控制点 (坐标取整, 红锚点零长线段跳过, 手柄 10px 命中优先于线段);
  2) 删除节点: 右键点击手柄 → 删除; 头部不可删, 删到少于 2 个点不可删; 红锚点 (连续相同坐标对) 成对删除 (命中对中任意一个都删整对);
  3) 白/红切换: 左键点击手柄且位移 ≤4px (未拖拽) → 切换; 头部不可切换; 白→红在该点后复制相同坐标点形成重复对, 红→白把重复对合并成一个点;
  4) curveType 解析 `resolveSliderCurveType`: 有红点 → 'B' (v15 放置规则同款); 原类型仍合法则保持 ('P' 恰好 3 点合法, 'L'/'B'/'C' ≥2 点合法), 'P' 点数不符按 inferSegmentType 降级 (2→L, 4+→B);
  5) 三个操作均一次 pushUndo + invalidatePath + emit (bump dataVersion, tick 事件重建), 改完滑条保持选中; 点击切换复用 mousedown beginDrag 的快照作为本次 undo, 不可切换时 store.undo() 弹出空快照; 节点拖拽改形 (>4px) 行为不变。
- 实现: sliderPath.ts 新增纯函数 nearestOnSegment/insertSliderPoint/deleteSliderPoint/toggleSliderPointRed/resolveSliderCurveType/isRedPairPoint/hasRedPair (点列含头部 pts[0], 红锚点 = 连续相同坐标对); EditorCanvas.tsx 接线 (nodeDragRef 加 startX/startY/moved, onMouseDown 线段命中插入, onMouseUp 未拖拽切换, onContextMenu 右键删除, applySliderPoints 写回 x/y/curvePoints/curveType)。
- 实测: 纯函数 10 组断言 (投影/插入下标/删普通点/删红点对/两点下限/头部保护/白红互切/P 降级与保持); CDP 真实鼠标事件: 线段中点点击 curvePoints 3->4 且新点在 (200,100) 正确下标, 点击切红 4->5 形成 (200,100) 重复对且 curveType=B, 右键红点对 5->3 成对删除, 右键头部不可删, 右键普通点 3->2, undo 链 2->3->5->4->3 逐步还原到原始三点, 全程无页面异常; 截图 verifier/runs/v25-nodes.png 人工复核: 红色锚点手柄显示在 (200,100), 白色连接线贯穿全部 6 个控制点, 路径在红锚点处分段成尖角, Inspector 显示"B 贝塞尔 / 控制点: 6"。回归: v12/v15/v17/v18/v19/v20/v21/v22/v23/v24 check 全绿, `npx tsc -b` 通过。
- 对应改动: sliderPath.ts (节点编辑纯函数), EditorCanvas.tsx (三种操作接线 + contextmenu 处理器)。

## v26 (2026-07-26)
- 位置: verifier/v26/
- 运行: `cd app && node verifier/v26/check.mjs`; `node verifier/v26/cdp-snap.mjs` (需 7100 dev server 已启动)
- 内容: 拖拽/插入/删除滑条节点后长度自动重算并吸附节拍 (用户反馈"不像 lazer 一样自动变化")。
  lazer 依据 (本地克隆逐行核对):
  - `PathControlPointVisualiser.DragInProgress` (osu.Game.Rulesets.Osu/Edit/Blueprints/Sliders/Components/PathControlPointVisualiser.cs:496): 拖拽每次 mousemove 都调 `hitObject.SnapTo(distanceSnapProvider)` — 吸附是**实时**的, 不是 mouseup 才吸; 插入/删除控制点后同样调 SnapTo (SliderSelectionBlueprint.cs:459,483); 切换节点类型 (AddTypeToSelection, 同文件 405-408) 是**条件分支**: `Path.Distance < originalDistance` 才 SnapTo, 否则保留原长度。
  - `SliderPathExtensions.SnapTo` (osu.Game/Rulesets/Objects/SliderPathExtensions.cs:16): `ExpectedDistance = FindSnappedDistance(Path.CalculatedDistance, ...)` — 取几何全长换算。
  - `ComposerDistanceSnapProvider.FindSnappedDistance` (osu.Game/Rulesets/Edit/ComposerDistanceSnapProvider.cs:288): 几何长 -> 时长 -> `SnapTime` 就近取整到 1/beatDivisor tick, 但 `snappedTime > actualDuration + 1ms` 则退一个 tick — **绝不超过几何全长** (1ms 容差); tick 长 = `GetBeatSnapDistance` = 100*sv*SliderMultiplier/beatDivisor px。注意 `IBeatSnapProvider.GetBeatLengthAtTime` 返回的是 **beatLength/divisor** (EditorBeatmap.cs:597), 不是整拍。
- 实现: sliderPath.ts 新增 `sliderGeometryLength` (computeRawPath 不截断全长, 与渲染同算法) / `snapSliderLength` (就近取整 + 超出退 tick + 下限 1 tick, lazer 用 HasValidLengthForPlacement 回滚整次拖拽, 本项目取钳制从简) / `resnapSliderLength` (写回 o.length); EditorCanvas.tsx 四处接线: 节点拖拽 mousemove 实时 resnap (预览即最终值), 插入/右键删除后无条件 resnap, 点击切白红按 lazer 条件分支 (新几何 < 原长度才重吸附)。
- 实测: 纯函数 17 断言 (就近取整/1ms 容差边界 174.9->175 而 158->140/下限 1 tick/beatSnap 1,2,4 联动/绿线 SV 2x tickPx 翻倍/空 timing 兜底/multiplier=0 兜底/B 红点对分段几何全长/resnap 写回) + 接线断言全绿; CDP 真实鼠标: 拖尾节点 (300,100)->(280,100) length 200->175 (几何 180 吸 5 tick, tickPx=35), undo 还原 200, 插入节点几何不变 200->175, 删除后 175, 切红几何不变保留 175 且 curveType=B, 全程无页面异常; 截图 verifier/runs/v26-snap.png 人工复核: 滑条身按 175px 截断, Inspector 长度 175。回归: v12/v15/v17-v25 check 全绿 (v22 一处断言字面匹配过时已语义化修正, 行为本身未回归), `npx tsc -b` 通过。
- 对应改动: sliderPath.ts (三个纯函数), EditorCanvas.tsx (四处接线), verifier/v22/check.mjs (过时断言语义化)。

## v27 (2026-07-26)
- 位置: verifier/v27/
- 运行: `cd app && node verifier/v27/check.mjs`; `node verifier/v27/cdp-v27.mjs` (需 7100 dev server 已启动)
- 内容: 三个用户反馈修复 —
  1) **可见即可选**: hitTest 窗口从硬编码 `preempt=1200 / endTime+600` 改为 `isVisibleAt` (与渲染同一窗口, 含 AR 联动 preempt 与 HIT_FADE 淡出期)。旧窗口两个 bug: 滑条 `o.endTime` undefined 退化为 `o.time+600`, 开始 600ms 后仍在屏却点不中; AR>5 时 preempt<1200, 不可见物件可被误选。
  2) **选中滑条描边**: 原虚线路径中线改为贴滑条身外形的高亮环 — 复用当前变换 (含 dpr*scale 与堆叠平移) 在离屏 canvas 粗描边 (2r+5) 再 `destination-out` 镂空 (2r-1.5), 贴回主画布; 控制多边形白线 + 白/红手柄保留; circle/spinner 虚线环不变。
  3) **折返箭头按 span 渐显** (用户: slides=3 时第二个箭头与滑条头全程重叠): lazer 依据 `SliderEndCircle.ApplyDefaultsToSelf` (RepeatIndex=0: TimePreempt+=跨度, 随滑条淡入; RepeatIndex>0: TimeFadeIn=0, TimePreempt=2*SpanDuration → 球经过前一个同侧端点时恰好出现) + `DrawableOsuHitObject.ApplyRepeatFadeIn` (Arrow 150ms 渐显, RepeatIndex>0 钳到 SpanDuration) + `DrawableSliderRepeat.SuppressHitAnimations` (编辑器: Time>=Repeat 时刻 Arrow.Alpha=0 立即隐藏)。新增纯函数 `lifecycle.sliderRepeatAlpha(time, sliderStart, span, preempt, s)`, renderer 箭头循环逐个求 alpha。
- 实测: 纯函数 17 断言 (s=1/2/3 出现-渐显-隐藏窗口, 短 span ramp 钳制, isVisibleAt 全程+淡出可见/淡入前不可见); CDP 19 断言: span2 中/淡出中滑条可点选, 消失后/淡入前不可选; 箭头白色尖端探针 (±0.4r, 避开圆盘边缘暗色) t=4900 尾有头无 → t=5400 都有 → t=6300 头有尾无 → t=7500 都无; 选中滑条青色像素 7522 (描边环); 截图 v27-arrows-4900/5400.png 与 v27-selected-outline.png 人工复核: 头部干净、描边环贴身。回归: v12/v13(CDP)/v15/v17-v26 全绿, `npx tsc -b` 通过。
- 坑: ① 像素探针要打在目标**独有**特征上 — 半透明 endcircle 透出的滑条身暗色外缘阴影让"暗色计数"在有无箭头时几乎一样 (2201 vs 2531), 改探箭头纯白尖端立即可靠; ② CDP 点击选中态滑条的身体会触发 v25 插入节点并 resnap 长度, 命中测试断言前必须 `select([])`。
- 对应改动: lifecycle.ts (sliderRepeatAlpha), renderer.ts (箭头循环走 alpha + drawSliderBodyOutline), EditorCanvas.tsx (hitTest 窗口)。

## v28 (2026-07-26)
- 位置: verifier/v28/
- 运行: `cd app && node verifier/v28/check.mjs`; `node verifier/v28/cdp-layout.mjs` (需 7100 dev server 已启动)
- 内容: stable 风格布局改造 (用户给 osu!stable 编辑器截图) —
  1) **页签栏 stable 化**: edit/timing/setup -> compose / timing / song setup 大页签 (active 蓝底白字)。
  2) **上方时间轴重做**: 双行 canvas 92px — 物件行 (60px) stable 大圆 RAD=24 (深灰底 #3a3a44 + 白环, newCombo 粗亮环, 选中 #ffcc22 黄环, 白色 combo 数字), 滑条/转盘连体条 (rgba 白 0.28) + 尾端 0.62R 小圆 + 折返白点; tick 行 (32px) 按 beatSnap 细分: 小节长白线 (2px 到底) / 整拍白 / 1/2 红 #ff5555 / 1/3 紫 #bb66ff / 1/4 蓝 #5588ff / 其他黄 #ffcc33; 红/绿 timing 线 = 半透明竖线贯穿 + tick 行顶三角旗 (绿旗下沉 10px 避免与同时刻红旗互遮); tick 行点击只 seek 不选物件 (hitTestMarker y>OBJ_H 返回 null)。
  3) **playfield 上下留白**: PAD_Y=40 osu px, viewTransform = min(w/512, h/(384+2*PAD_Y)) 单源化, 渲染循环与 toOsu 共用; 新增 window.__osuToClient / __osuToCanvas 供全部 CDP 脚本统一坐标换算。
- 新增纯函数 `src/osu/beatTicks.ts`: `tickLevel(offsetBeats, meter)` (优先级 measure>beat>half>third>quarter>other, 1e-4 容差, 负偏移安全) + `beatTicks(points, t0, t1, divisor)` (每段红线各自 beatLength/meter 独立生成, 跨 BPM 正确, 空 timing 默认 500ms 红线兜底)。
- 实测: 纯函数 30+ 断言 (各级别/负偏移/meter 联动/单红线 16 tick/窗口中段起始/跨 BPM 8+7/divisor 12 全级别/空 timing 兜底); CDP 19 断言: 页签文案, 时间轴像素分类计数 (物件行白 2457, 五色 tick 均 >0, 红绿旗标各 >0), 上下留白 >10px, y=0 圆顶 (y=-37) 在画布内且圆身上半可见 (亮度 559 vs 空位 56); 截图 v28-layout.png / v28-padding.png 人工复核: 与 stable 截图观感一致 (大圆+数字+五色 tick+页签)。
- 回归适配 (坐标变换改动同步全部 CDP): v17/v18/v19/v23/v25/v26/v27 cdp 坐标公式改走 __osuToClient/__osuToCanvas 单源, 重跑全绿; v12/v18 check 与 v18 cdp 中被 v28 取代的旧时间轴断言 (lazer 32px 圆角条/combo 色/h-16 选择器) 已更新为 stable 设计; v18 cdp 连接线探针阈值 220->150 (连接线为 0.8α 白 ≈206, 属测试校准非行为回归)。
- 坑: ① demo 谱面 editor.timelineZoom=2 (持久化), 窗口只有 3000ms — 测试要先归一化 zoom=1, 否则 timing 线根本不在视野内 (旗标 0 像素的根因); ② 红绿 timing point 同刻时旗标同位互遮, 后画的绿旗完全盖住红旗 — 绿旗下沉一行解决; ③ bash heredoc 写含 Windows 路径的脚本会吃反斜杠 (spawn ENOENT), 调试用脚本一律用 Write 工具落盘。
- 对应改动: beatTicks.ts (新增), Timelines.tsx (TopTimeline 重写), App.tsx (页签), EditorCanvas.tsx (PAD_Y + viewTransform + __osuToClient/__osuToCanvas), verifier/v17-v27 八个 cdp 脚本坐标适配, verifier/v12/v18 check.mjs + v18 cdp 旧断言更新。

## v29 (2026-07-26)
- 位置: verifier/v29/
- 运行: `cd app && node verifier/v29/check.mjs`; `node verifier/v29/cdp-redpair.mjs` (需 7100 dev server 已启动)
- 内容: 滑条节点编辑体验三项 (用户反馈) —
  1) **控制点可超出游玩区**: 节点拖拽去掉 `Math.max(0, Math.min(PW/PH, …))` 钳制, 坐标直接取整写回 (lazer 同样允许控制点出界); 物件整体拖拽的头部钳制不变。
  2) **红点拖拽成对移动不拆对**: mousedown 时用新纯函数 `redPairPartner(pts, i)` 记录重复对配对下标存入 nodeDragRef.pairWith, mousemove 对两个下标同步 setPt — 旧行为只动对中一个点, 等于把红点拆成两个白点。
  3) **右键红点 = 转白 (不再成对删除)**: contextmenu 命中红对成员走 `toggleSliderPointRed` 合并分支 (几何不变, 长度按 lazer 条件分支保留), 白点才走 `deleteSliderPoint`; 左键点击 (≤4px 未拖拽) 改为**仅白->红**, 红点点击无操作 (避免误触拆对)。
- 实测: 纯函数 8 断言 (配对下标双向/与头部成对/全白无配对); CDP 14 断言: 拖红点 (300,100)->(340,160) 两点同步且 curveType=B, 拖白点到 (-60,420) 不钳制, 左键点红点对不拆, 右键红点 3->2 合并转白, undo 链逐步还原 (转白/拖出界/成对拖), 全程无异常; 截图 v29-outside.png 人工复核: 控制点与滑条身可画出游玩区下缘。
- 回归适配: v25 cdp 右键红点断言从"成对删除 5->3"改为"合并转白 5->4", undo 链 [4,5,4,3]; v26 cdp (右键删白点/点击白切红) 行为不变直接通过; v12-v29 check 全绿, `npx tsc -b` 通过。
- 对应改动: sliderPath.ts (redPairPartner), EditorCanvas.tsx (pairWith 记录 + setPt 成对移动 + 去钳制 + 左键仅白切红 + 右键红转白分支), verifier/v25/cdp-nodes.mjs (旧断言更新)。

## v30 (2026-07-26)
- 位置: verifier/v30/
- 运行: `cd app && node verifier/v30/check.mjs`; `node verifier/v30/cdp-rightclick.mjs` (需 7100 dev server 已启动)
- 内容: 两项用户反馈 —
  1) **拖控制点经过时间轴不 seek**: store 新增非响应式标志 `canvasDragging`, 三处拖拽入口 (节点/物件移动/框选) mousedown 置 true; 上/下时间轴的 mousedown/mousemove 处理检查该标志直接忽略。关键: 标志**只能由 window mouseup 清除** — onMouseLeave 会调 onMouseUp (拖出画布即结束拖拽), 若在那里清标志, 拖到时间轴上按钮未松开时时间轴照样 seek。
  2) **四模式右键删物件**: onContextMenu 重构 — select 模式先走控制点分支 (白点删点/红点转白, v29), 未命中手柄则落到通用删除; slider 模式有待放置点优先 finishSlider; 其余情况 `hitTest` 命中物件即 pushUndo + filter 删除 + selected 清除 + invalidatePath + emit。选中滑条右键滑条身 (非控制点) = 删整个滑条。
- 实测: CDP 12 断言: 拖控制点到下方时间轴 mousemove 不 seek (t 保持 4800), window mouseup 后标志清除, 随后点击时间轴正常 seek (4800->1190); select/circle/slider/spinner 四模式各删一个圆; 选中滑条右键身体删整条, undo 还原; 全程无异常。
- 测试坑: ① 多次 `Runtime.evaluate` 共享全局词法环境, 顶层 `const tl` 重复声明直接 SyntaxError — 页面内脚本一律 IIFE 包裹; ② hitTest 窗口 = 渲染可见窗口 (v27), 右键删除测试的物件必须 seek 到可见时间窗内; ③ 堆叠同位物件 hitTest 只中一个, 每个被测物件要隔开摆。
- 对应改动: store.ts (canvasDragging), EditorCanvas.tsx (三处置标志 + window mouseup 兜底 + contextmenu 通用删除), Timelines.tsx (上/下时间轴守卫)。

## v31 (2026-07-26)
- 位置: verifier/v31/
- 运行: `cd app && node verifier/v31/check.mjs`; `node verifier/v31/cdp-timeline.mjs` (需 7100 dev server 已启动)
- 内容: 上方时间轴三项增强 (用户反馈) —
  1) **物件 combo 染色**: 头圆/尾圆填充 = `mixDark(combo色, 0.55)` (与深底 #2e2e38 混合, 白环白数字保持对比), 连体条 = `alphaOf(combo色, 0.35)`; 取代 v28 的固定灰 #3a3a44。
  2) **右键删除物件**: TopTimeline 加 onContextMenu — hitTestMarker 命中即 pushUndo + filter + selected 清除 + invalidatePath + emit (与游玩区四模式右键删除同一语义), 受 canvasDragging 守卫。
  3) **滑条尾端圆回归**: v28 改粗条时去掉的尾端圆加回 — 与头圆同径 (RAD) 同款 (combo 染色填充 + 环), 无数字; 连体条仍为 2*RAD 胶囊条。
- 实测: CDP 7 断言: 两 combo 两色像素分类 (红 1667 / 绿 9993, 固定灰实现为 0), 尾圆探针打在连体条胶囊末端之外 (ex+12: 254 vs 背景 41 — 胶囊到 ex 为止, 该处只可能来自尾圆), 右键删 94003 + undo 还原; 截图 v31-timeline.png 人工复核: 红圈/绿滑条 (绿条+绿尾圆)/绿圈与游玩区 combo 色一致。
- 测试坑: 滑条尾时间 = time + length/vel, vel = 100*SliderMultiplier/beatLength (px/ms) — 探针位置必须先按谱面 timing 算准, 拍脑袋写死 (5500) 就戳到背景上。
- 真 bug (v18 cdp 抓出): 解析器把 Combo 色存成 `rgb(r,g,b)` 串 (parser.ts:142), 默认色才是 hex — hexRgb 只认 hex 会把 rgb() 解析成 0x55 暗蓝, 染色形同没染; 现已两种格式兼容。
- 回归适配: v18 check "深灰底"断言改为 "comboColor 染色填充"; v18/v28/v30 cdp 重跑全绿。
- 后续修复 (2026-07-26, 用户反馈"右键变选中"): 真实右键序列是 mousedown(button 2) -> contextmenu, TopTimeline mousedown 未区分按键, 先走了选中+拖拽预备并置 canvasDragging, contextmenu 删除被自己的守卫挡掉 — mousedown 改为仅响应左键; v31 cdp 补真实右键序列回归断言 (此前只发 contextmenu 单事件, 覆盖不到)。教训: 模拟鼠标按键操作要发完整事件序列 (mousedown/mouseup/contextmenu), 单发目标事件测不到事件间状态污染。
- 对应改动: Timelines.tsx (hexRgb/mixDark/alphaOf + 染色绘制 + 尾端圆 + onContextMenu), verifier/v18/check.mjs (旧断言更新)。
- 后续修复 (2026-07-26, 用户反馈"滑条体缺几块"): 连体条从胶囊 roundRect 改为 fillRect 矩形 — 胶囊右端半圆止于 ex, 与 RAD 尾圆 (伸到 ex+RAD) 接缝处缺角; 矩形两端被头/尾圆完整覆盖。v12/v18 check 的 roundRect 断言已同步改 fillRect。

## v32 (2026-07-26)
- 位置: verifier/v32/
- 运行: `cd app && node verifier/v32/check.mjs`; `node verifier/v32/cdp-tl-drag.mjs` (需 7100 dev server 已启动)
- 内容: 时间轴物件时间编辑 (P1-7 提前落地, 用户需求) —
  1) **时间轴拖拽物件改时间**: TopTimeline mousedown 命中物件 = 选中 + 进入拖拽预备 (beginDrag 快照 + canvasDragging), mousemove 超 4px 后 anchor 物件按当前 beatSnap 吸附到 tick, 其余选中物件同 delta 跟随 (endTime 同步, 实时 emit); mouseup 未移动 = 点击 (弹空快照 + seek 到物件时间); window mouseup 兜底收尾。
  2) **J/K 快捷键**: store 新增 `nudgeSelected(ms)` (一次 undo, 选中物件 time/endTime 平移 + 重排序); App.tsx J = 前移 / K = 后移一个当前节拍吸附 (beatLength/beatSnap); 快捷键面板同步更新。
- 实测: CDP 11 断言: 拖拽 2000->2625 (125ms×5 吸附) + undo; 点击仍选中+seek 且不改时间; 多选拖拽 anchor 2125 跟随件 3125; K 2125 / J 2000 / undo 各一次; 全程无异常。
- 坑: dev server (7100) 并非永生 — 挂了之后 CDP 报的是 `__osuStore undefined` 误导人, 先 `curl localhost:7100` 确认活着再排查页面; 就绪等待用轮询 `__osuStore && beatmap` 比固定 sleep 可靠 (已用于本批)。
- 对应改动: Timelines.tsx (markerDragRef/snapMs/finishMarkerDrag + 三个事件接线), store.ts (nudgeSelected), App.tsx (J/K + 面板文案)。

## v33 (2026-07-26)
- 位置: verifier/v33/
- 运行: `cd app && node verifier/v33/check.mjs`; `node verifier/v33/cdp-transform-origin.mjs` (需 7100 dev server 已启动)
- 内容: 选区变换任意角度/倍率 + 三种原点 (用户需求, 参考 lazer `SelectionRotationHandler.Rotate(rotation, origin)` 的 origin 语义) —
  1) **store 原点三模式**: `export type TransformOrigin = 'selection' | 'playfield' | Pt`; `resolveOrigin` 解析 (playfield = {256,192}, selection = selectionCenter, 否则自定义点); `applyTransform` 带 origin 参数; `rotateSelected/flipSelected/scaleSelected` 第二参数默认 'selection' — Ctrl+G/H/J 快捷键行为不变。
  2) **Inspector 变换面板重写**: useState(angle/factor/originMode/customX/customY), 原点三 radio (`data-tf={\`origin-${m}\`}`), 自定义时出 x/y 输入 (`data-tf={testid}`); 旋转↺↻ = `rotateSelected(±|angle|, origin)`, 缩放应用 = `scaleSelected(factor, origin)`, 镜像水平/垂直带 origin。纯函数 rotateObjects/flipObjects/scaleObjects (transform.ts) 本就支持任意角度/倍率+任意中心, 未动。
- 实测: 绕 playfield 转 45° (圆 (256,100)->(321,127), 滑条头 (200,300)->(140,229), 控制点 (300,300)->(211,299)); 自定义点 (100,100) 缩放 1.5 ((334,100), length 200->300, 头 (250,400)); playfield 水平镜像 (头 x 200->312, 控制点 300->212); UI radio/输入/按钮点击实测生效; undo 全还原; 全程无异常。
- 坑: ① 手算旋转结果自己错了一次 ((268,217) vs 正确 (211,299)) — 期望值用独立代码算再人工复核, 别心算; ② check.mjs 断言别写 JSX 字面属性 `data-tf="x"` — 源码是模板 ``data-tf={`origin-${m}`}`` 或参数 `data-tf={testid}`, 按语义正则断言; v17 check 两处过时断言 (rotateSelected 字面签名/scaleSelected(1.1)) 已同步语义化。
- 回归: `npx tsc -b` 通过; v12/v15-v33 check 全绿; v17/v27/v30/v31/v32/v33 cdp 重跑全绿。
- 对应改动: store.ts (TransformOrigin/resolveOrigin/applyTransform origin + 三个 transform API 加参), Inspector.tsx (TransformPanel), verifier/v33/*, verifier/v17/check.mjs (旧断言更新)。

## v34 (2026-07-26)
- 位置: verifier/v34/
- 运行: `cd app && node verifier/v34/check.mjs`; `node verifier/v34/cdp-origin-marker.mjs` (需 7100 dev server 已启动)
- 内容: 自定义变换原点 — 画布标记渲染 + 可拖拽 (用户反馈) —
  1) **原点状态提升到 store**: `originMode`/`customOrigin` 从 Inspector 本地 useState 提升为 store UI 状态, `setOriginMode`/`setCustomOrigin` 走 `emitSelection()` (UI 状态, 不进 undo, 不 bump dataVersion); `currentOrigin()` 供变换按钮取当前生效原点。Inspector 输入与画布拖拽因此天然双向同步。
  2) **画布标记**: 自定义模式且有选区时, 在 customOrigin 处渲染 #ffaa00 十字+圆+中心点 (osu 坐标系, 可画出游玩区外)。
  3) **标记拖拽**: mousedown 命中检测 (<=12 osu px) **优先于控制点手柄与物件**, 只改原点不动物件不进 undo; 置 canvasDragging (时间轴守卫); mousemove 不钳制; 清除走 window mouseup 兜底 (与 canvasDragging 同纪律 — onMouseLeave 也调 onMouseUp, 不能在那里清)。
- 实测: CDP 16 断言: 勾选/取消自定义标记出现消失 (像素探针 [255,170,0]), 拖拽 (256,192)->(350,250) store/Inspector 输入同步且物件不动, undo 不动原点, 绕拖拽后原点顺时针 90° (256,100)->(500,156), 原点与物件重叠时拖动移原点不动物件 (优先级), Inspector 输入 128 反向同步标记位置; 全程无异常。
- 坑: 页面有多个 canvas (时间轴/游玩区), 像素探针 `document.querySelector('canvas')` 会抓到时间轴画布读出 [0,0,0] — 游玩区画布用 `canvas.cursor-crosshair` 选择器 (v29 同款)。
- 回归适配: v30 check "三处拖拽入口置标志 ===3" 计数断言因新增原点拖拽入口变 4 — 改 >=3 语义断言; v12-v34 check 全绿, v17/v29/v30/v33 cdp 重跑全绿, `npx tsc -b` 通过。
- 对应改动: store.ts (originMode/customOrigin/setOriginMode/setCustomOrigin/currentOrigin), Inspector.tsx (面板改读 store), EditorCanvas.tsx (originDragRef/originMarkerVisible + 标记渲染 + 三事件接线), verifier/v30/check.mjs (旧断言更新)。

## v35 (2026-07-26)
- 位置: verifier/v35/
- 运行: `cd app && node verifier/v35/check.mjs`; `node verifier/v35/cdp-v35.mjs` (需 7100 dev server 已启动)
- 内容: 两项用户需求 —
  1) **控制点命中优先级 + 渲染次序**: EditorCanvas 新 helper `nearestCtrlPoint` — 多个手柄在鼠标下 (<=10 osu px) 取最近者, 距离相同取序号在前 (严格 <, 升序遍历保持先入者); mousedown 拖拽与右键 (红点转白/白点删除) 共用同一命中。renderer 手柄改**倒序绘制** — 序号在前的控制点在更上层, 与命中优先级一致; 红锚点重复对跳过前成员 (被红色后成员完全遮住), 头部 (idx 0) 始终绘制。
  2) **时间轴拖滑条尾改折返次数**: TopTimeline 新 `hitTestTail` (仅滑条, 尾端 css px 阈值 8, 必须先于 hitTestMarker 判定 — 尾时间在物件时长范围内否则被物件拖拽抢走); mousedown 拖尾 -> beginDrag + canvasDragging, mousemove 按 `slides = clamp(round((ms - time)/dur), 1, 100)` 整 repeat 伸缩 (dur = length/vel 单次折返时长不变), emit 重建折返音/尾时间; 未拖动 = 单击尾端 (弹空快照 + seek 到尾时间); 悬停尾端光标 ew-resize。
- 实测: CDP 13 断言: (309,200) 处 idx2(308) 距 1 / idx1(300) 距 9 -> 拖 idx2 而 idx1 不动; 红对正上方按下抓 idx1 且成对移动不拆散; 红对 idx2 与 idx3 白点重叠处探针得 [255,85,85] (序号在前者在更上层); 时间轴拖尾 slides 1->3->1, undo 链 1->3->1 逐步还原, 物件时间不变, 单击尾端 slides 不变且 seek 到尾时间 (3714); 全程无异常。
- 坑: ① 探针/物件别放在 osu x>512 — 视口横向无留白 (PAD_Y 只管上下), 画布外探针读 [0,0,0]; ② 探针物件 time 必须落在 seek 后的渲染窗口 (preempt 随 AR 变, demo 图 dt=900 已不可见, 手柄不绘制 -> 背景色 [17,17,22]), 探针前核对 dt <= preempt; ③ 测试里算 dur 要与组件同公式 (含绿线 SV: sv=-100/green.beatLength), 拍脑袋写死会拖错 repeat 数。
- 回归适配: v29 check "pairWith: redPairPartner(ctrl, i)" 因 v35 命中下标改名 hitIdx 假失败 — 断言放宽为 (i|hitIdx); v12-v35 check 全绿, v25/v29/v30/v32 cdp 重跑全绿, `npx tsc -b` 通过。
- 对应改动: renderer.ts (倒序绘制+重复对跳前成员), EditorCanvas.tsx (nearestCtrlPoint + mousedown/contextmenu 接入), Timelines.tsx (tailResizeRef/hitTestTail + mousedown/mousemove/finish/光标), verifier/v29/check.mjs (旧断言更新)。

## v36 (2026-07-26)
- 位置: verifier/v36/
- 运行: `cd app && node verifier/v36/check.mjs`; `node verifier/v36/cdp-stream.mjs` (需 7100 dev server 已启动)
- 内容: F1 滑条转连打 + 转换基础设施 (用户需求, 参考 lazer SliderSelectionBlueprint.convertToStream SliderSelectionBlueprint.cs:566) —
  1) **基础设施 (F1-F4 共用)**: `DraggableDialog.tsx` 可拖参数窗口 (标题栏 pointer capture 拖拽) + `loadParams/saveParams` (localStorage `osu-editor:conv:<key>` 参数持久化); store 新增 `conversionDialog/conversionPreview/openConversion/closeConversion/setConversionPreview/applyConversion` (预览走 emitSelection 不重建事件表; 应用一次 undo + 重排序 + 选中结果); EditorCanvas 预览渲染 — 源物件隐藏, 结果物件二次 renderPlayfield WYSIWYG 显示。
  2) **F1 转连打** (`src/osu/convert/stream.ts`): 数量/间距两种模式; 等距 + 变距四预设 (线性/加速/减速/先加后减, 权重 w(p) 从 1 渐变到 endPercent/100, count 模式归一化分配, spacing 模式步行累积); 采样完全按 lazer — 奇数 span 路径反向, 全部复制头部 hitSound/hitSampleRaw, 首圆保留 newCombo。StreamDialog 实时预览 + 应用/取消。
- 实测: 纯函数 14 断言 (等距 count/spacing 时间列, 线性变距间距比 1.667=理论值, bell 对称中段密, 位置/时间/hitsound, slides=2 折返 x=100,200,300,200,100); CDP 21 断言: 开窗预览 6 点改参实时变 5 点, 应用后 5 单点替换滑条且未选中物件保留/选中结果/窗口关闭/undo 还原, 线性 100->50% 间距 223>194>163>134, localStorage 持久化重开恢复, 取消谱面不变; 全程无异常。
- 坑: 转换应用后选中集是新物件 id, undo 还原后选中集指向失效 id — Inspector 按钮按 sel (选中且存在于 hitObjects) 渲染, CDP 测试 undo 后必须重选再点按钮。
- 回归: v12/v17/v25/v29/v30/v32-v35 check 全绿, `npx tsc -b` 通过。
- 对应改动: store.ts (转换 API), EditorCanvas.tsx (预览渲染), DraggableDialog.tsx (新), convert/stream.ts (新), convert/StreamDialog.tsx (新), Inspector.tsx (转换按钮区), App.tsx (挂载对话框)。

## v37 (2026-07-26)
- 位置: verifier/v37/
- 运行: `cd app && node verifier/v37/check.mjs`; `node verifier/v37/cdp-split.mjs` (需 7100 dev server 已启动)
- 内容: F2 滑条等时间拆分 (用户需求, 参考 lazer BezierConverter.cs ConvertCatmullToBezierAnchors(:259)/ConvertCircleToBezierAnchors(:195)/ConvertLinearToBezierAnchors(:287); hitsound 落段思路参考 SliderSelectionBlueprint.splitControlPoints(:500)) —
  1) **共享贝塞尔工具** (`src/osu/convert/bezierPath.ts`, F3/F4 复用): 任意滑条统一转贝塞尔段序列 — C 用 lazer 精确公式 ((−v1+6v2+v3)/6, (−v4+6v3+v2)/6, 端部 v1=v2/v4 外推), L 直接转, P 三点圆弧用标准 k=4/3·tan(θ/4) ≤90° 分块三次贝塞尔近似 (lazer preset 收敛的同款目标), B 按红锚点 (重复点对) 分段保留原阶; de Casteljau 求值/剖分 (任意阶), 控制多边形自适应密度 (16~512 步) 弧长测量, extractRange 按全局弧长区间截取, segmentsToPoints 转回控制点 (跨原分段接缝写重复点 = 红锚点保持分段语义)。
  2) **F2 拆分** (`src/osu/convert/split.ts` computeSplit 纯函数): 折返视为无折返 (单程 length/vel); ℓ=(L−(n−1)·distGap)/n 校验 >0 (非法给提示不生成); 每段时长 = ℓ/sliderVelocityAt(段起点时刻), 第 i 段起点 = 上段终点+timeGap (默认全 0 严格等时间首尾相接); 输出 curveType 'B' slides=1 length=round(ℓ); hitsound — 头部采样 (hitSound/hitSampleRaw/newCombo) 只给第一段, edgeSounds/edgeSets 按端点时间 (s.time+i·单程时长) 落段 (与段起点重合给该段头部优先, 否则落 (起点,终点] 的段尾, 范围外丢弃)。SplitDialog 实时预览 + key 'split' 持久化; Inspector 单选滑条出「拆分滑条」按钮。
- 实测: 纯函数 27 断言 (catmull→bezier 端点/切线斜率 1.000, L 三等分头 100/200/300 时间 2000/2500/3000, distGap=30 头 100/210/320, timeGap=100 时间 2000/2850, 非法参数报错, slides=2 端点音 1|2|4 落段 1|0/0|2 且 5000ms 端点丢弃, 红锚点接缝 curvePoints=200:100|200:100|215:115, 拆分后几何总长 241.42≈原长); CDP 27 断言: 开窗预览 2 段改参实时变 3 段, 应用后 3 段 B 滑条替换源 (位置/时间/hitsound/edgeSound 0|2 落尾段), undo 还原, localStorage 持久化重开恢复 count=3, dist-gap=400 报错+无预览+应用禁用, 取消谱面不变, 全程无异常; 截图 v37-split.png (直线 3 段预览) / v37-split-curve.png (P 圆弧 2 段, 接缝形状连续) 已肉眼复核。
- 坑: 预览物件按时间窗渲染, 等时间拆分的各段在不同时间 — 截图复核形状需 seek 到多段同屏 (dt<=preempt), 别指望一张图看全; check.mjs testid 断言要匹配源码实际写法 (Num 组件是 testid="count" 属性, 不是 data-conv="count" 字面串)。
- 回归: v36 check+cdp / v35 check / v12 check 全绿, `npx tsc -b` 通过。
- 对应改动: convert/bezierPath.ts (新), convert/split.ts (新), convert/SplitDialog.tsx (新), Inspector.tsx (单选滑条转换区), App.tsx (挂载 SplitDialog)。

## v38 (2026-07-26)
- 位置: verifier/v38/
- 运行: `cd app && node verifier/v38/check.mjs`; `node verifier/v38/cdp-merge.mjs` (需 7100 dev server 已启动)
- 内容: F3 多个物件合并为滑条 (用户需求规格; 贝塞尔拼入复用 v37 bezierPath.ts) —
  1) **computeMerge** (`src/osu/convert/merge.ts` 纯函数): 选中物件按 time 升序连接成一条新滑条; 单点/转盘贡献位置点 (与前一段直线连接), 滑条经 sliderToBezierSegments 转贝塞尔段序列**保留完整路径形状**拼入 (圆弧/卡特姆同样转贝塞尔, 形状不变); 物件间接缝 = 红锚点 (segmentsToPoints 重复点), 相邻位置完全相同 (或滑条尾与下一物件头重合) 去重避免零长接缝; 无视堆叠偏移直接用逻辑坐标。新滑条 head/time = 第一个物件, curveType 'B' slides=1; 长度 = 几何全长经 resnapSliderLength 吸附 (与节点编辑一致, 不拉伸/压缩对齐尾部物件时间); hitsound/hitSampleRaw/newCombo 仅保留第一个物件, 其余采样 (含源滑条边缘音) 丢弃; 有效物件 <2 或路径总长 ≈0 返回 null 不动作。
  2) **Inspector**: 多选「转换」区改为 sel.length>1 即显示 (原仅含滑条时), 新增「合并为滑条」按钮 (data-conv-apply="merge") — **无参数不弹窗, 点击直接 computeMerge + applyConversion (一次 undo)**; 转连打按钮保留 (仅含滑条时显示)。
- 实测: 纯函数 21 断言 (圆+圆直线滑条/长度几何全长 200 不拉到尾部时间/圆+B滑条形状原样拼入+接缝红锚点/catmull 转贝塞尔过原点 (117,100) 控制柄/乱序传入按 time 升序/同位圆与滑条尾重合去重/<2 或全重合返回 null); CDP 22 断言: 多选点按钮无窗口直接应用 (conversionDialog 保持 null), 3 源物件删除/未选中保留/控制点 = (200,200)x2 红锚点 + 原 B 控制点 + (320,200)x2 + 末圆, 长度 350 (几何约 366 吸附, tickPx=25), 像素探针接缝1=239/贝塞尔=176/接缝2=247 vs 背景 31, undo 一步还原 4 物件, 纯圆多选按钮同样出现, 全程无异常; 截图 verifier/runs/v38-merge.png 人工复核: 滑条身依次经过三物件位置, 红锚点/白控制多边形可见, 滑条球+跟随圈正常。
- 回归: v37 check+cdp / v36 check / v12 check 全绿, `npx tsc -b` 通过。
- 对应改动: convert/merge.ts (新), Inspector.tsx (多选转换区), verifier/v38/*。

## v39 (2026-07-26)
- 位置: verifier/v39/
- 运行: `cd app && node verifier/v39/check.mjs`; `node verifier/v39/cdp-curve.mjs` (需 7100 dev server 已启动)
- 内容: F4 卡特姆(C)<->贝塞尔(B) 滑条互转 (用户需求规格; C->B 依据 lazer BezierConverter.cs ConvertCatmullToBezierAnchors(:259)) —
  1) **catmull 红锚点核查结论 (推翻任务预设)**: lazer 传统格式 (formatVersion < FIRST_LAZER_VERSION) 解码时 catmull **不**按重复点分段 — ConvertHitObjectParser.cs:403-407 注释明确 "Legacy CATMULL sliders don't support multiple segments, so adjacent CATMULL segments should be treated as a single one", 整条作为一个样条链 (重复点 = 双重结点, 渲染成 bulb)。我们 catmullPath 原实现行为一致, **不做分段修改**; 分段反而会偏离 lazer。
  2) **sliderPath.ts 两处对齐修复**: ① catmullPath 末端端点处理 — lazer (BezierConverter:266-269 与 PathApproximator 同款约定) 首端 clamp (v1=v2) 但末端**外推** (v4=2*v3-v2), 我们原实现两端都 clamp, 末段最大偏差 ~0.074*末段长 (100px 段 ~7px), 会导致 C->B 后在我们自己的渲染器里尾部变形; 已改为末端外推 (纯 C 滑条尾部形状因此向 lazer 正确值微调, 这是"形状不变"规格的必要条件)。② buildEvenSpacing 丢长修复 — 原实现按相邻细分点 d>0.5 才累加长度, 密集采样路径 (高密度 B->C 的 catmull ~0.6px/步) 大量步长被整条跳丢 (276px 路径只剩 238px, totalLength 短缺导致滑条球/截断位置错误 + 曲线上留长弦); 改为 acc 累积全部长度、点距按"距上次保留点"(since) 判定。稀疏路径 (L/P/B/普通 C) 步长本来就 >0.5px, 行为不变。
  3) **curveConvert.ts**: catmullToBezierSlider — 整条控制点链 (含双重结点) 一次过 catmullToBezier (与解码/渲染同一曲线), 每跨度一条三次贝塞尔, 相邻贝塞尔间写重复点 (红锚点), 精确变换; bezierToCatmullSlider — 每条贝塞尔段 (红锚点分隔) 按 t 均匀采样 density 点 (含两端点, t=i/(d-1), 接缝去重, 段内重合去重, 退化末段修剪尾部重复对), 采样点即 catmull 锚点, 原红锚点边界写重复点保留。两函数 { ...o, id: genId() } 展开复制 — hitSound/edgeSoundsRaw/edgeSetsRaw/hitSampleRaw/newCombo/comboSkip/time/slides/length 全部原样; **控制点保留浮点不取整** (精确性优先, 与 split/merge 的取整惯例不同是有意为之, parser fmtNum 原样序列化)。
  4) **UI**: Inspector 多选转换区 — 「卡特姆→贝塞尔」(选区含 C 时显示, data-conv-apply="c2b", 无参数直接 applyConversion, removeIds 只含 C 滑条) / 「贝塞尔→卡特姆」(选区含 B 时显示, data-conv-open="curve" 开窗); CurveDialog (DraggableDialog 模式): 采样密度 2~64 默认 8 (data-conv="density"), 实时预览/应用 (data-conv="apply")/取消, 持久化 key 'curve'; App.tsx 挂载。
- 实测: 纯函数 24 断言 (C->B 转换前后路径采样偏差 0.222px<0.5/带红锚点 0.074px<0.5/12 控制点含双重结点红锚点/字段保留/纯函数不改原物件; B->C 锚点全在原贝塞尔上 max 0.40px/density=8->8 锚点, 4->4, 钳制 64/形状偏差 density=8 1.66px vs density=32 0.059px 单调下降/两段边界红锚点保留/length slides hitsound 保留; catmull 末端外推与公式逐点误差 0/带红点 C 路径过锚点不炸); CDP 37 断言: c2b 无窗口直接应用 (conversionDialog 保持 null)/11 控制点/字段保留/选中结果/像素探针转换前后滑条身同过锚点 (99/179 vs 背景 27)/undo 还原; B->C 开窗预览 8 锚点改密度实时变 16/应用后 C 滑条 15 控制点字段保留/持久化 density=16 重开恢复/取消谱面不变预览清除; 带红锚点 C 渲染探针 254/211 正常, 全程无异常; 截图 v39-c2b-before/after (形状一致), v39-b2c-after (形状近似), v39-cat-red (红锚点 bulb = lazer 语义) 已肉眼复核。
- 坑: ① C->B 初版按 v37 sliderToBezierSegments 在红锚点分组转换, 与渲染端 (整条链) 偏差 23px — C->B 必须整条链一次转换才与 lazer 解码/渲染语义一致。② density=32 偏差反而 38px 的"高密度更差"假象, 根因是 buildEvenSpacing 丢长 (见上), 不是插值问题。③ 端点行为测试别用采样路径比对理论中点 (n=15 采样间隙本身 ~3px 噪声), 用公式在采样参数 t=j/15 处逐点比对。
- 回归: v38 check+cdp / v37 check / v36 check / v12 check / v25 check / v29 check 全绿 (sliderPath.ts 有改动), `npx tsc -b` 通过。
- 对应改动: convert/curveConvert.ts (新), convert/CurveDialog.tsx (新), sliderPath.ts (catmull 末端外推 + buildEvenSpacing 丢长修复), Inspector.tsx (多选转换区两按钮), App.tsx (挂载 CurveDialog), verifier/v39/*。

## v39 补充 (2026-07-26, 单选滑条转换按钮)
- 用户需求: 选中单个滑条时也要显示 滑条转连打 / 曲线互转 按钮 (原来只在多选区)。
- 改动: Inspector 抽出共用组件 `SliderConvertButtons({ sliders })` (转连打 + 卡特姆→贝塞尔 + 贝塞尔→卡特姆, 按 sliders 类型条件显示), 多选区传 selSliders, 单选滑条区传 [o] (与拆分按钮同区); 合并为滑条仍仅多选。
- 验证: v39 cdp 追加 D 段 8 断言 (单选 B: 拆分/转连打/B→C 按钮出现且 C→B 不出现, 转连打开窗预览 8 点取消, 单选 C: c2b 直接应用 curveType=B + undo); v36-v39 check + cdp 全绿, `npx tsc -b` 通过。
- 坑: v39 cdp 的 `__prev` 返回结构与 v36 不同 (无 n 字段) — 跨批次复用页面 helper 前先核对其返回结构。

## v40 (2026-07-26)
- 位置: verifier/v40/
- 运行: `cd app && node verifier/v40/check.mjs`; `node verifier/v40/cdp-v40.mjs` (需 7100 dev server 已启动)
- 内容: 用户 7 项需求批次 —
  1) **转连打间距单位 = 拍**: `StreamParams.spacingMs` -> `spacingBeats` (默认 0.5), `streamTimes(duration, p, spacingMs)` 改三参, computeStream 按 `p.spacingBeats * timingAt(滑条起点).red.beatLength` 解析; StreamDialog 标签「间距 (拍)」step 0.25。
  2) **数量=1 -> 仅滑条头一个 note** (streamTimes count 模式 `n===1 -> [0]`) + **对话框数字输入修复**: `DraftNum` (DraggableDialog.tsx 新组件) — 草稿态数字输入: onFocus 存草稿, onChange 实时 set 但文本不被 clamp 打断 (全选重打「16」能打出「1」), onBlur 回显; `data-conv={testid}` 透传; Stream/Split/Curve 三个对话框全部 Num 换 DraftNum, 转连打 count min 1。
  3) **间距曲线简化**: StreamCurve 删 accel/decel 选项 (遗留值在 weight 与 loadStreamParams 里映射 linear), 保留 等距/线性变化/先加后减(bell), 新增 先减后加 `'bellInv'` (`1 - d*sin(πp)`, 与 bell 镜像, 中段最疏)。
  4) **选中边框全时段**: renderer.ts 选中装饰抽成 `drawSelectionDecor(rc, o, radius)`, renderPlayfield 主循环后对 selected 且不在 visSet 的物件也调用 — 物件未出现时选中虚线环仍渲染 (否则转连打预览看不到整个连打范围)。
  5) **预览选中效果 + 时间轴预览**: EditorCanvas 预览 renderPlayfield 传 `selected: new Set(convPrev.objects.map(o=>o.id))`; Timelines TopTimeline 绘制列表 = 过滤 hideIds 的 hitObjects + convPrev.objects, sel 加 prevIds (预览物件黄环)。
  6) **Ctrl+点击 逐个添加/移除选中**: EditorCanvas 物件命中 `e.ctrlKey || e.metaKey || e.shiftKey -> toggleSelect` (对齐 lazer/stable, Shift 兼容保留); Timelines mousedown 切换选中同样加 ctrlKey/metaKey; App.tsx 快捷键面板加条目。
- 实测: 纯函数 13 断言 (0.5 拍->5 点 250ms 间隔/2 拍->2 点/count=1->仅头部 2000 保留 newCombo/bellInv 对称中段疏 (225,275,275,225) vs bell 中段密 (300,200,200,300)/遗留 accel=linear); CDP 16 断言: 1 拍->2 点隔 500ms/0.5 拍->3 点隔 250ms/打「1」输入框保持且预览仅头部/续打「6」->16 点/变化到% 全选重打 50/曲线选项恰 4 项/选中圆 seek 20000 后虚线环 22/36 采样点, 取消选中=0/时间轴预览黄环>0/预览单点不可见时选中环 21/36/Ctrl 点击三连 (选中->加选->取消保留其他), 全程无页面异常。
- 坑: ① **「镜像对均值 = 平均间距」断言数学上不成立** — 间距是权重倒数, `(1/(1-a)+1/(1+a))/2 = 1/(1-a²) > 1`, bell/bellInv 配对均值系统性偏高 ~5%, 断言改为方向性比较 (中段 bell 密/边缘 bell 疏)。② check.mjs 源码接线断言要避开注释与函数形参: `spacingMs: number` 会命中 streamTimes 形参 (改 `/^\s*spacingMs: number;/m`), 「加速」会命中注释 (改查 CURVES 数组项/option)。③ **v40 F 段假失败的根因是测试布景, 不是代码**: AR=9 preempt=600, seek(1500) 时 time=2200 的物件 1600 才出现, 「可见即可选」正确地让它不可命中 — 之前连点三处全空一度怀疑 hitTest/变换, 用 circle 工具点击读回新建物件坐标 (350,192 精确) 一步排除逆变换嫌疑, 布景改 time<=2100 即全绿。CDP 布景先算 preempt 可见窗。④ 时间轴黄环比对不能用「前后递增」: 预览隐藏源滑条后, 两个预览单点的黄环像素自然比整条滑条黄环少 — 源已隐藏时 >0 即证明预览物件带选中样式。
- 回归: `npx tsc -b` 通过; v12/v15-v40 全部 check.mjs 绿; CDP 抽跑 v36 stream/v37 split/v39 curve/v30 rightclick/v32 tl-drag 全绿。
- 对应改动: convert/stream.ts (重写), DraggableDialog.tsx (DraftNum), convert/StreamDialog.tsx (重写), convert/SplitDialog.tsx + convert/CurveDialog.tsx (DraftNum), renderer.ts (drawSelectionDecor + 全时段选中环), EditorCanvas.tsx (预览 selected + Ctrl 切换), Timelines.tsx (预览物件绘制+黄环 + Ctrl 切换), App.tsx (快捷键条目), verifier/v40/*, verifier/v36/tests.ts (streamTimes 三参适配), verifier/v39/check.mjs (density 断言放宽)。

## v41 (2026-07-26)
- 位置: verifier/v41/
- 运行: `cd app && node verifier/v41/check.mjs`; `node verifier/v41/cdp-v41.mjs` (需 7100 dev server 已启动)
- 内容: 用户 5 项反馈修复 —
  1) **circleToBezier 顺时针弧变形 (合并/拆分 P 滑条形状丢失, 真实谱面 Crystalia 第3+4滑条实测 173.8px 偏差)**: bezierPath.ts 圆弧转贝塞尔在 cross<0 (dir=-1) 时, `a0 = start + dir*step*i` 对【已带符号】的 step 二次乘 dir, 扫描方向反转, 弧终点落在错误位置; 且 `chunks = ceil(total/(π/2))` 对负 total 算出 1 块。修复: `norm` 返回有符号 total (sign=dir), 分块取 `ceil(|total|/(π/2))`, 角度推进 `a0 = start + step*i` (不再乘 dir), 切向统一用角度增加方向 (-sin,cos) 配合有符号柄长 k=(4/3)tan(step/4)r — 逆时针弧 (dir=+1) 行为与旧实现逐点相同 (回归覆盖)。注意同文件 sliderToBezierSegments 被 F2 拆分/F3 合并/F4 互转共用, 该 bug 影响所有 P 滑条转换。
  2) **转连打变距语义修正**: v36-v40 的变距是【时间】间隔渐变 (错误), v41 改为时间间隔始终等距 (lazer convertToStream 语义), 曲线 + endPercent 只控制单点沿路径的【空间】分布 — 新导出 `streamFractions(p, times, duration)`: equal → 位置比例=时间比例 (末点不一定到路径尾, 与 lazer 一致); 变距 → 相邻间距按权重累积归一覆盖整条行程 (末点恒在路径尾), 权重钳制 >=0, endPercent 支持 0~400 (0 = 尾部间距趋 0)。streamTimes 不再引用 weight。
  3) **间距改节拍下拉框**: StreamDialog 间距 (拍) 从 DraftNum 改为 select, 选项 1/1~1/16 (分母与节拍吸附 [1,2,3,4,6,8,12,16] 同组), 遗留持久化值不在列表时动态补一个 option 兜底。
  4) **endPercent 支持 0%/1%/重打 100 — 根因是 React 经典 bug 而非 clamp**: StreamDialog/SplitDialog 把 `Row` 组件定义在组件函数体内, 每次渲染都是新组件类型, 整棵子树重挂载; 击键 -> onChange -> params 变化 -> 重渲染 -> 输入框被替换成新 DOM 节点 -> 失焦, 后续击键落空 (调试实测: 插入 '1' 后 activeElement=BODY, 旧节点 isConnected=false)。v40 的 DraftNum 草稿机制本身是对的, 但救不了节点重挂载。修复: Row 提升到模块级。endPercent clamp 同时放宽 min 5 -> 0。
- 实测: 纯函数 9 断言 (顺时针弧终点=c/过中间点 0.071px/径向偏差 0.014px 分 2 块; 逆时针回归; Crystalia 合并 P 部分最大偏差 0.26px (修复前 173.8px)/B 控制点原样/长度=几何全长 595); CDP 14 断言 (下拉 8 选项/默认 1/2->3 点 250ms/1/4->6 点 125ms/变距时间等距 102ms/空间间距前疏后密 37>20/Input.insertText 真实击键重打 100/0/1 + 逐键 1-0-0='100'/UI 合并贝塞尔锚点逐点命中/红锚点接缝/选中新滑条/undo 还原), 全程无页面异常。
- 坑: ① **组件内定义组件 = 每次渲染重挂载**, 对话框里任何局部子组件都是定时炸弹; 验证数字输入必须用 Input.insertText 逐键 (原生 setter 一把赋值测不出失焦)。② CDP 布景先算 vel: loaded map SM=1.4 + 绿线 -100 -> vel=0.28px/ms, len200 单程 714.3ms — 别按 500ms 一拍脑补点数。③ v40 「镜像均值」教训续集: 变距权重按段中点采样, endPercent=0 末段只是趋近 0 不精确为 0, 断言写单调递减即可。④ getSliderPath 按 id 缓存 — 纯函数调试自造物件时用大 id, 否则 genId 从 1 开始撞缓存得到"完美匹配"的假绿。
- 回归: `npx tsc -b` 通过; v12/v15-v41 全部 check.mjs 绿; CDP 抽跑 v36/v37/v38/v39/v40 全绿 (v40 A 段已适配节拍下拉框)。
- 对应改动: convert/bezierPath.ts (circleToBezier), convert/stream.ts (streamFractions + 语义), convert/StreamDialog.tsx (下拉框 + Row 模块级 + endPercent 0~400), convert/SplitDialog.tsx (Row 模块级), verifier/v36/tests.ts + verifier/v40/tests.ts (变距语义适配), verifier/v40/cdp-v40.mjs (下拉框适配), verifier/v41/*。

## v42/v43 (2026-07-26)
- 位置: verifier/v42/
- 运行: `cd app && node verifier/v42/check.mjs`; `node verifier/v42/cdp-v42.mjs` (需 7100 dev server 已启动)
- 内容: 转连打【按数量】模式的时间对齐节拍网格。经历两版语义, 以 v43 为准 —
  - v42 (初版, 已废弃): 均布时间吸附网格 + 同格去重 + 超尾丢弃。问题: count=16 只出 3 点 (数量名不副实), 且位置从吸附后时间推算, 时间挤向尾部时位置全堆在路径尾。
  - **v43 (现行)**: 先按数量把位置沿路径分布 (等距 = 索引均布 i/(n-1), 与 v41 一致; 变距 = 权重分布), 时间再按间距网格从头部逐个排: `times[i] = snap_red(head + i*div)`, div = spacingBeats * 滑条起点 beatLength。数量恒定 = N; 允许 (n-1)*div 超出滑条尾 — 超尾点照常生成且位置不堆在尾部; 头部 note 保持滑条起点不动 (即使不在网格上)。spacing 模式不变 (lazer 语义: 从头部按 div 等距到滑条尾, 位置 = 球在时间 t 的位置)。
  - **StreamDialog**: 间距 (拍) 下拉框两种模式都显示, count 模式下含义 = 时间网格 (带「时间对齐网格」提示)。
- 实测: 纯函数 8 断言 (count=5@1/2 恰覆盖全时长; count=6@1/2 -> 6 点末点 3250 超尾; count=16 恒 16 点; @1/1 -> head+i*500; @1/4 全在 125 网格; 位置均布 100..300 超尾点不堆尾; 头部@2010 不动; spacing@2010 不吸附); CDP 9 断言 (count 模式下拉框+提示; count=6@1/2 时间/位置; @1/4; @1/1; 应用后 6 单点全对齐且源滑条替换), 全程无页面异常。
- 坑: ① 「吸附 + 去重」和「数量恒定」不可兼得 — 用户要的是后者, 网格冲突交给预览可见性。② 该语义再次改变 count 模式点数/时间断言: v36 A/B/C (恢复 5 点 2000..3000 + 空间严格递减)、v40 B (16 点 2000..5750)、v41 B (8 点 2000..3750) 均已适配。③ slides=2 折返滑条 count 模式位置按索引均布行程 (fracs*slides 反弹), 时间只跨 (n-1)*div 不再摊满全时长 — v36 tests 折返段时间断言已改。
- 回归: `npx tsc -b` 通过; v12/v15-v42 全部 check.mjs 绿; CDP 抽跑 v36/v37/v38/v39/v40/v41/v42 全绿。
- 对应改动: convert/stream.ts (count 分支 head+i*div + streamFractions 索引均布), convert/StreamDialog.tsx (间距下拉框两模式显示), verifier/v36/tests.ts + cdp-stream.mjs, verifier/v40/cdp-v40.mjs, verifier/v41/cdp-v41.mjs, verifier/v42/*。

## v44 (2026-07-26)
- 位置: verifier/v44/
- 运行: `cd app && node verifier/v44/check.mjs`; `node verifier/v44/cdp-v44.mjs` (需 7100 dev server 已启动)
- 内容: 转换预览的 combo 数字/颜色与转换应用后完全一致 (时间轴 + 游玩区同管线)。
  - 根因: 预览物件不在 `bm.hitObjects` 里 — 时间轴 `computeCombos(bm)` 查不到预览 id, `?? { combo: 0, index: 1 }` 兜底 → 数字全显示 1、颜色全 combo0; 游玩区第二趟 `renderPlayfield` 把预览当整张谱面 `computeCombos(pbm)` → 数字从 1 重排, 不承接前文。
  - 改法: `renderer.ts` 新增 `mergedWithPreview(bm, prev)` — 源物件按 hideIds 隐藏 + 预览物件按时间并入排序, 返回视图直接喂渲染/combo 计算; EditorCanvas 改为**单趟** renderPlayfield (删第二趟预览渲染, selView 仍并入预览 id 保证选中样式, v40 的"未出现选中物件也画装饰"自动覆盖预览物件); Timelines 同一管线; 新增 CDP 钩子 `__osuComboAt(id)` 走同一 `computeCombos(mergedWithPreview(...))`。
- 实测: 纯函数 14 断言 (空预览返回原 bm/源隐藏/排序/原 bm 不变; 非 nc 滑条预览首点 {0,3} 末点 {0,7} 后续 {1,1}; nc 滑条预览首点 {1,1} 后续重编号 {2,1}; 预览 == 应用后逐时间点比对); CDP 13 断言 (count=5@1/2 预览 5 点; 非 nc 数字 3..7 不显示 1; 时间轴像素探针 combo0 红 161,21,25; 切 nc 后数字 1..5 + 后续重编号 + 像素 combo1 绿 21,161,25; 应用后 @2000/@3000/@4000 与预览一致), 全程无页面异常。
- 坑: ① **store.select() 原地改 Set, 引用不变** — React useMemo 依赖 store.selected 不会触发重算; CDP 里改完谱面要"拨动参数"强制 useMemo 失效 (滑条对象本身也要原地改, 因为 sliders memo 持旧引用)。② 转连打默认 count=8 (DEFAULT_STREAM_PARAMS), CDP 布景务必显式 __setCount。③ 时间轴圆内像素探针要避开中央白数字与白环: 取圆心偏左 12px (RAD 24)。
- 回归适配: v36/v40 各 2 条接线断言从"二次 renderPlayfield"旧架构改到 mergedWithPreview 单趟; v31 导入行断言放宽 (加了 mergedWithPreview)。
- 回归: `npx tsc -b` 通过; v12/v15-v44 全部 check.mjs 绿; CDP 抽跑 v36/v37/v38/v39/v40/v41/v42 全绿。
- 对应改动: osu/renderer.ts (mergedWithPreview), components/EditorCanvas.tsx (单趟渲染 + __osuComboAt), components/Timelines.tsx (合并视图), verifier/v31/check.mjs, verifier/v36/check.mjs, verifier/v40/check.mjs, verifier/v44/*。

## v45 (2026-07-26)
- 位置: verifier/v45/
- 运行: `cd app && node verifier/v45/check.mjs`; `node verifier/v45/cdp-v45.mjs` (需 7100 dev server 已启动)
- 内容: 用户 7 项反馈 —
  1) **游玩区框选只选当前可见物件**: marquee 的 objectsInRect 前加 `isVisibleAt(bm, o, currentTime)` 过滤 (与单击命中同一可见窗口), 不再把矩形区域全时间的物件都框进来。
  2) **上方时间轴物件行框选**: 物件行空白处按下拖动出青色虚线矩形 (与游玩区同款), 命中 = 物件时长 [time, end] 与矩形时间区间相交且纵向覆盖物件行; Shift 在现有选区上追加; 未拖出矩形 = 原单击行为 (清空 + seek); tick 行保持按下即 seek。canvasDragging 标志复用, 游玩区/下方时间轴拖拽经过不互相干扰。
  3) **游玩区扩大 ~10%**: viewTransform 高度方向 `* 1.1` (吃 PAD_Y 留白), 宽度适配 Math.min 兜底防溢出; 渲染/鼠标换算/__osuToClient/__osuToCanvas 共用同一函数自动一致。
  4) **左右键按节拍移动时间**: 移植 lazer `EditorClock.seek` (暂停 snapped 分支) 为纯函数 `seekByBeats` — 步长 = 红线 beatLength/divisor*amount, 向前 floor / 向后 ceil 吸附节拍网格, 红线边界向后用目标侧红线 beatLength, 向前不越过下一条红线, 向后不越过本红线起点 (首条除外可退到 0), 落回原地时沿方向多走一拍; Shift = 4 拍 (lazer Editor.cs amount 语义)。移除旧的固定 250ms 步进。
  5) **锁定间距倍率控件**: 锁定间距按钮右侧 range(0.1~3, step 0.05) + number 输入, 双向联动写回 `editor.distanceSpacing` (序列化/放置公式直接生效), data-ds-input 便于测试定位。
  6) **右上角选区信息面板**: 与上方时间轴同行 (时间轴 flex-1 让出右侧 w-32), 显示选中首件 (按时间) 坐标 `x:… y:…` 与前/后间距倍率 `Prev: …x` / `Next: …x`。纯函数 `selectionSpacingInfo`: 间距 = 前件结束位置(滑条按折返奇偶取头/尾)→首件头部 / 末件结束位置→后件头部, 单位 = `distanceSpacing * 100 * 间隔拍数` 的倍数 (与 snapPlacement 放置公式同单位 — 锁定间距 1x 放置的物件 Prev 恰为 1.00x); 间隔 ≤0 拍 (重叠/同刻) 显示 —。
  7) **follow points**: 新模块 `followPoints.ts` 对齐 lazer `FollowPointRenderer/FollowPointConnection/FollowPointLifetimeEntry` — 连接对 = 时间相邻物件 (后件 newCombo 或任一端转盘则断链); 起点 = 前件堆叠后结束位置, 终点 = 后件堆叠后头部; 点距 SPACING=32 首点 1.5*SPACING=48 末点 < distance-32; fadeOut = 前件结束 + fraction*间隔, fadeIn = fadeOut - 800*min(1,TimePreempt/450); 动画 (时长 = 后件 TimeFadeIn): 淡入 + 位置 fraction-0.1→fraction (Easing.Out 近似 easeOutQuart) + 缩放 1.5→1, fadeOut 后同 duration 淡出。renderer 画在物件下层, 尺寸 = end.Scale(radius/64) * 动画缩放, 贴图保持宽高比; skin.ts 新增 followpoint 字段 (public/skin/followpoint.png + 皮肤目录可覆盖 + 程序化柔边白点回退)。
- 实测: 纯函数 30+ 断言 (seekByBeats 单/双红线 13 条; followPoint 连接对/点位/时刻/淡入淡出/尾窗 15 条; stackedEndPosition 折返奇偶 3 条; spacingMultiplier/selectionSpacingInfo 8 条); CDP 17 断言 (左右键 1625/1500/Shift 2000; 全区域框选只中 [c2,c3]; 时间轴框选 [c3] + 单击空白清空 seek; 面板 x:200 y:100/Prev/Next 1.00x; DS 输入 2 → 滑条联动 + 面板变 0.50x; follow point 亮度探针 中点 729/空白 91/newCombo 断链 80/c1->c2 仍在 354), 全程无页面异常。
- 坑: ① **滑条 Next 间距的间隔拍数按滑条尾时间算** — len200/SM1.4@500ms 尾时间 1714ms, 测试布景按 500ms 一拍脑补会得出 beats<=0 的 null (v41 同款教训: 布景先算 vel)。② **CDP Input.dispatchMouseEvent 坐标取整**, win=6000 的时间轴 1px≈6ms, seek 断言容差放到 8ms。③ followpoint.png 是 16x22 非方形, 复用方形 drawSprite 会拉伸 — follow point 专用绘制保持宽高比。④ 时间轴 marquee 起点不能落在物件 marker 命中阈 (win/40=150ms) 内, 否则走物件拖拽分支 — 布景起点选在物件时间 ±150ms 之外。⑤ **lazer follow point 无"单点全 alpha"平台期** — aIn 满档时刻恰为 fadeOutTime (aOut 同时开始衰减), 断言逐点在各自 fadeOutTime 验到位, 不要找"全部 alpha=1 的时刻"。
- 回归适配: v23 框选断言放宽 (objectsInRect 改多行 + 可见过滤); v16 会话记忆日志断言兼容现有文案 ("已从会话记忆恢复", 该失败为先前遗留)。
- 回归: `npx tsc -b` 通过; v12/v15-v45 全部 check.mjs 绿; CDP 抽跑 v30/v32/v44/v45 全绿。
- 对应改动: osu/followPoints.ts (新), osu/seekSnapping.ts (新), osu/spacing.ts (新), osu/skin.ts (followpoint), osu/renderer.ts (drawFollowPoints), components/EditorCanvas.tsx (可见过滤 + *1.1), components/Timelines.tsx (时间轴框选 + SelectionInfoPanel), App.tsx (节拍 seek + DS 控件 + 顶部布局), verifier/v16/check.mjs, verifier/v23/check.mjs, verifier/v45/*。

## v46 (2026-07-26)
- 位置: verifier/v46/
- 运行: `cd app && node verifier/v46/check.mjs`; `node verifier/v46/cdp-v46.mjs` (需 7100 dev server 已启动)
- 内容: 修复"皮肤文件夹中的 followpoint 读取不正确"。对照 lazer 源码两个缺口 —
  1) **序列帧命名**: lazer 用 `GetAnimation("followpoint", …)` 加载 (OsuLegacySkinTransformer), 不少皮肤**只有 `followpoint-0.png` 序列帧、没有 `followpoint.png`**, v45 的候选名只有 `followpoint(@2x).png` → 静默回退默认点。fileVariants 为 followpoint 增加 `followpoint-0@2x.png` / `followpoint-0.png` 候选 (取第 0 帧静态显示, 编辑器不做帧动画)。
  2) **@2x 半尺寸**: osu framework 对 @2x 贴图 ScaleAdjust=2 (按一半像素尺寸绘制); follow point 是按贴图宽度定显示尺寸的精灵 (hitcircle 等显式尺寸绘制不受影响), @2x 皮肤会被画成 2 倍大。skin.ts 新增 `skinScaleAdjust: WeakMap<SkinImage, number>` (@2x 候选加载成功时记 2), renderer 绘制时 `img.width/adj`, 并补 lazer maxSize (128,64) 上限约束 (OsuLegacySkinTransformer GetAnimation maxSize)。
  - 另: skin.ts 末尾暴露 `window.__osuSkin` (applySkinFromDir/resetSkinToDefault/getSkin/skinScaleAdjust), CDP 可在页面内构造 mock FsDirLike 直调同管线验证。
- 实测: 接线断言 6 条全绿; CDP 12 断言 (只有 followpoint-0.png 的 mock 目录 → 红色序列帧上屏 (243,21,22); followpoint@2x.png 64px → adj=2 + 绿色上屏 + 264px 处无绿色溢出证明半尺寸; 恢复默认回退正常), 全程无页面异常。
- 坑: ① **CDP `awaitPromise` + 页面内 `await import()` 长链会偶发 "Promise was collected"** (V8 inspector 弱引用 promise 被 GC) — 长异步改「同步启动 + 轮询 window.__job」模式, evalJs 同时检查 r.error (顶层错误不只是 result.exceptionDetails)。② mock FsDirLike 只需 `{ kind, name, entries, getFileHandle }` 四个成员, getFileHandle 对缺失文件名必须 reject (loadOne 靠 catch 走下一个候选)。
- 回归: `npx tsc -b` 通过; v12/v15-v46 全部 check.mjs 绿; CDP 抽跑 v44/v45/v46 全绿。
- 对应改动: osu/skin.ts (fileVariants 序列帧候选 + skinScaleAdjust + __osuSkin 暴露), osu/renderer.ts (ScaleAdjust/半尺寸 + maxSize 约束), verifier/v46/*。

## v47 (2026-07-26)
- 位置: verifier/v47/
- 运行: `cd app && node verifier/v47/check.mjs`; `node verifier/v47/cdp-v47.mjs` (需 7100 dev server 已启动)
- 内容: followpoint **序列帧动画**支持 (用户皮肤 a(No hitsound): followpoint-0..9.png 共 10 帧, 空白帧 0-3/7-9 为 1x1 占位, 箭头帧 4-6 为 128x128 — 皮肤常用的亮灭节奏控制法)。
  - 对齐 lazer `GetAnimation("followpoint", animatable, looping, applyConfigFrameRate: true)` + `SkinnableTextureAnimation`:
    - applySkinFromDir 新增 followpoint 专用通道: 单图 followpoint(@2x).png 优先; 否则连续加载 `followpoint-{i}(@2x).png` 序列帧到首个缺失 (上限 120), 不再走 fileVariants;
    - 帧时长 (lazer getFrameLength, applyConfigFrameRate=true 分支): skin.ini `AnimationFramerate: N` > 0 → 1000/N; 否则 1000/帧数 (整圈 1 秒, 不是 60fps — 那是 applyConfigFrameRate=false 的默认值);
    - 每点动画时间基准 = 该点 fadeInTime (FollowPoint.AnimationStartTime, IAnimationTimeReference), 帧 = `floor((time - animStart)/frameMs) % 帧数` 循环; FollowPointDot 新增 animStart 字段;
    - Skin 新增 `followpointFrames` / `followpointFrameMs`; 渲染按帧选图 (ScaleAdjust/maxSize 约束逐帧生效 — 128x128 帧被 maxSize(128,64) 压到一半, 与 lazer 一致)。
- 实测: 纯函数 9 断言 (帧序号/循环/负 playback 回卷); 接线断言 13 条; CDP 11 断言 (仿用户皮肤 10 帧布景: 无 skin.ini → frameMs=100, t=1400 红帧 4 上屏 (155,8,10) / t=1700 空白帧 7 消失; AnimationFramerate: 20 → frameMs=50, 同 t=1700 改显红帧 5; 单帧 followpoint-0.png 兼容静态显示), 全程无页面异常。
- 坑: ① **lazer 序列帧默认不是 60fps** — applyConfigFrameRate=true 时无 ini 配置走 `1000/textures.Length` (整圈 1s), 用户皮肤 10 帧 → 100ms/帧, 直接决定亮灭节奏断言的时间点。② 负 playback 断言: -40ms → floor(-0.4)=-1 → 回卷帧 9 (不是直觉的帧 6)。③ 空白占位帧是 1x1 PNG, 绘制尺寸 ~0.57px 自然不可见, 无需特殊处理。
- 回归适配: v46 check.mjs 的 fileVariants 断言改到 v47 专用通道 (CDP 行为不变: 单帧 followpoint-0.png 仍加载为 frames=[0])。
- 回归: `npx tsc -b` 通过; v12/v15-v47 全部 check.mjs 绿; CDP 抽跑 v45/v46/v47 全绿。
- 对应改动: osu/skin.ts (followpoint 专用通道 + followpointFrames/FrameMs + skin.ini AnimationFramerate), osu/followPoints.ts (animStart + followPointFrameIndex), osu/renderer.ts (按帧选图), verifier/v46/check.mjs, verifier/v47/*。

## v48 (2026-07-27)
- 位置: verifier/v48/
- 运行: `cd app && node verifier/v48/check.mjs`; `node verifier/v48/cdp-v48.mjs` (需 7100 dev server 已启动)
- 内容: 修复"直线上相邻 follow point 间距明显比 osu! 宽"。根因不是点距 (SPACING=32/首点 48/末点 distance-32 的排布 v45 起就与 lazer FollowPointConnection 逐行一致), 而是**贴图尺寸的 maxSize 处理语义**: v46/v47 用 `box = min(1, 128/w, 64/h)` 等比缩放, 128x128 帧被缩成 64x64 显示 (CS4 下 ~36.5x36.5 osu px), 箭头变窄 → 间隙视觉偏宽。lazer `LegacySkinExtensions.WithMaximumSize` 实际是**居中裁剪** (`texture.Crop`, 逐轴独立取 `min(像素, maxSize*ScaleAdjust)`, 裁后保留 ScaleAdjust): 128x128 帧 → 裁出 128x64 横带按 128x64 osu px 绘制 (CS4 下 ~73x36.5, 箭头宽 73 > 点距 32 → 与 osu 一样交叠成链)。
  - followPoints.ts 新增纯函数 `followPointCrop(imgW, imgH, scaleAdjust)` (完全镜像 WithMaximumSize: 未超限原样 / 超限逐轴 min + 居中裁剪 / 显示尺寸 = 裁剪像素 / ScaleAdjust) 与常量 FP_MAX_W=128 / FP_MAX_H=64 (= OBJECT_RADIUS*2 / OBJECT_RADIUS)。
  - renderer.drawFollowPoints 改用 9 参数 drawImage (源裁剪矩形 + 目标矩形), 删除等比缩放 box。
- 实测: 纯函数 10 断言 (128x128→裁(0,32,128,64)显示128x64 / @2x 256x256→裁(0,64,256,128)显示128x64 / 未超限原样 / 只超宽时高度不放缩 / 两轴都超各取 min / @2x 未超限按半尺寸); 接线断言 10 条; CDP 13 断言 (128x128 左蓝右红单图: -28 osu px 蓝 / +12 红 / -40 背景 / 垂直 +25 背景 — 证明宽 73 且全宽内容保留; @2x 256x256 绿: 同宽; 32x32 小黄: 不裁不放 18.2x18.2), 全程无页面异常。
- 坑: ① 探针别放连接线右侧 — 后件 hitcircle (半径 36.5) 会盖住 follow point 右端 (follow point 画在物件下层), 前件在当前时刻已消失, 左侧才无遮挡。② `WithMaximumSize` 名字误导 — 不是缩放是 Crop, 且逐轴独立 ("check per-axis for the minimum dimension to avoid accidentally inflating textures with weird aspect ratios")。
- 回归适配: v46 check.mjs 两条渲染断言改到 followPointCrop 通道 (行为语义被 v48 取代: maxSize 从等比缩放改为居中裁剪)。
- 回归: `npx tsc -b` 通过; v1-v48 全部 check.mjs 绿 (v8/v13/v14 无 check.mjs, 仅 CDP 脚本); CDP 抽跑 v45/v46/v47/v48 全绿。
- 对应改动: osu/followPoints.ts (followPointCrop + FP_MAX_W/H), osu/renderer.ts (drawFollowPoints 裁剪绘制), verifier/v46/check.mjs, verifier/v48/*。

## v49 (2026-07-27)
- 位置: verifier/v49/
- 运行: `cd app && node verifier/v49/check.mjs`; `node verifier/v49/cdp-v49.mjs` (需 7100 dev server 已启动)
- 内容: **选中框缩放** (lazer SelectionBox 黄色选择框 + 边/角拖拽手柄)。调研对齐: SelectionBox.cs (框/手柄布局/可用性), SelectionBoxScaleHandle.cs (拖拽→倍率换算/Shift 锁比/Alt 默认原点), OsuSelectionScaleHandler.cs (Begin/Update/Commit, 单滑条特殊分支, 游玩区钳制), GeometryUtils.cs (GetSurroundingQuad/GetScaledPosition/ClampScaleToPlayfieldBounds)。
  - 新模块 `osu/selectionBox.ts` (纯函数):
    - 缩放参考包围盒 = 选中可移动物件 (排除转盘) 的位置盒, 滑条含全部控制点; 显示盒 = 位置盒按圆圈半径外扩 (lazer: 手柄画在视觉框上, 缩放数学用位置盒, 两者分离);
    - 手柄可用性: 宽>0 才有左右边, 高>0 才有上下边, 都有才有四角 (单圆圈 0x0 → 无手柄, 对齐 updateState);
    - dragToScale: 倍率 = 1 + 位移/对应边长, 边手柄另一轴清零, 上/左边方向取反, 角手柄 Shift 锁长宽比 (取 X/Y 均值);
    - 缩放原点 = 手柄对角锚点; Alt = 默认原点 (选区点最小包围圆圆心, Welzl);
    - clampScaleToPlayfield: lazer ClampScaleToPlayfieldBounds (axisRotation=0) 逐角钳制, Both 轴保持 X/Y 比例;
    - applyScaleDrag: 多物件只缩放位置 (滑条整体移动不缩路径不改长度) + 越界整体移回; 单滑条特殊分支 — 控制点绕头缩放 (禁镜像) + resnapSliderLength 节拍吸附 + 出界/非法整体回滚;
    - 每次鼠标移动从 Begin 快照重算 (lazer Update 语义, 不累积)。
  - EditorCanvas: 手柄命中 (8 屏幕 px 容差, 就近优先, 先于节点编辑/物件命中) → beginDrag → mousemove 实时 applyScaleUpdate → mouseup commit/undo (空点击弹空快照); 拖拽中 Shift/Alt 按下松开经 window key 监听实时重算; 渲染黄色边框 (#f2b544 ≈ YellowDark, 3px) + 8 个 10px 手柄方块 (屏幕恒定尺寸)。
- 实测: 纯函数 30 断言 (包围盒/手柄可用性/倍率换算/锁比/MEC/钳制/多物件缩放/单滑条吸附与回滚/快照重算不累积); 接线断言 22 条; CDP 9 断言 (黄框与手柄像素上屏; 真实 Input.dispatchMouseEvent 拖 cr 手柄 +40 osu px → c2.x=340 且拖拽中实时生效, 一次 undo 还原; Shift+角拖锁比 1.2x; Alt 默认原点 (250,150); 空点击不消耗 undo), 全程无页面异常。
- 坑: ① lazer 手柄画在**视觉框**(含半径)上而缩放除数是**位置盒**尺寸, 两者别混。② clampScaleToPlayfield 的 Both 分支按幅值逐角顺序钳制 (后一个角用已钳制的 s 重算), 测试预期要按顺序手算。③ CDP `Input.dispatchMouseEvent` 的 modifiers 位掩码: 1=Alt 8=Shift, mouseMoved 也要带 (React 从事件读 e.shiftKey)。
- 回归: `npx tsc -b` 通过; v1-v49 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v45/v48/v49 全绿。
- 对应改动: osu/selectionBox.ts (新), components/EditorCanvas.tsx (手柄命中/拖拽/键盘修饰/渲染), verifier/v49/*。

## v50 (2026-07-27)
- 位置: verifier/v50/
- 运行: `cd app && node verifier/v50/check.mjs`; `node verifier/v50/cdp-v50.mjs` (需 7100 dev server 已启动)
- 内容: v49 选中框的 5 项反馈修复。
  1. **缩放拖宽/高到一定程度卡住** (双因): ① `applyScaleDrag` 的游玩区钳制原先拿**当前(已缩放)包围盒**反推允许倍率 — 越拖钳越紧, 倍率被压回 1 卡死; 对齐 lazer `OsuSelectionScaleHandler.originalQuad` (OriginalSurroundingQuad), 改为传入 **Begin 盒** (新增第 7 参 `originalQuad`) 做钳制基准。② 拖出画布时 `onMouseLeave` 触发 `onMouseUp` 直接终止拖拽; 改为 **window mousemove/mouseup 接管缩放/旋转拖拽** (lazer 拖拽同样不依赖指针在控件内), `onMouseLeave` 在手柄拖拽中不再提前收尾。
  2. **仅选中一个单点/转盘时不显示边框**: 新增 `selectionBoxVisible` — 可动物件 (排除转盘) 位置点 ≥2 或唯一物件是滑条才有框 (单圆圈/单转盘位置盒 0x0, 无缩放意义, 对齐 lazer updateState 的手柄可用性语义延伸到整框)。
  3. **拖拽手柄光标形状**: 边/角手柄悬停 ew/ns/nwse/nesw-resize, 旋转手柄 grab (按下 grabbing), 起手即设光标, 空白恢复默认。
  4. **框四角外侧旋转手柄** (对齐 lazer SelectionBoxRotationHandle + OsuSelectionRotationHandler): `rotationHandlePoints` (四角沿对角线外移 12.5px, 半径 15px 屏幕恒定) / `hitRotationHandle` / `angleDeltaDeg` (归一 (-180,180]) / `snapRotation` (Shift 吸 15°) / `rotationOrigin` (默认原点 = 选区点最小包围圆 MEC 圆心) / `applyRotateDrag` (头绕原点、滑条控制点绕头、每次从 Begin 快照重算)。hover 四角附近才显示手柄 (黄圆 + 弧箭头), 旋转命中优先于缩放命中。
  5. **上方时间轴空白点击变成选中最近物件、框选失效**: `hitTestMarker` 删掉 `win/40` 时间窗与"时长条范围内即命中"短路 (长滑条/转盘连体条覆盖物件行大半区域, 空白点击总被某个条抢走), 改为纯像素阈值 (`RAD + 3` css px, `Math.abs(sx - px)`) — 只有真正点中头圆才选中拖拽, 其余一律进框选。
- 实测: 纯函数 + 接线断言共 27 条; CDP 19 断言 (A 缩放大幅右拖钳到 512 后回拖 2.4x 恢复响应不再卡住; B 单选圆圈无黄框/多选恢复; C 光标 ew-resize/grab/默认; D hover 显示旋转手柄 + 拖 90° 绕 MEC (250,150) 旋转 + 一次 undo 还原; E Shift+旋转吸附 15°; F 时间轴框选选中 2 物件 + 空白单击清空选区不选最近物件 + 点头圆选中), 全程无页面异常。
- 坑: **CDP 时间轴坐标假阳性** — 谱面默认 `timelineZoom = 2` (parser.ts:109, 可视窗 3000ms), 测试按 `win = 6000` 算坐标, 3500ms 落在可视窗外 → clientX 超出时间轴 canvas 甚至视口 → mousedown target=`<html>`、`document.elementFromPoint` = null, 框选从未发生, 断言却靠布景残留选区假通过 (后续 seek 日志才暴露: 鼠标移动走进了"按住左键空白 seek"分支)。修法: 布景显式 `timelineZoom = 1` + 启动加 `--window-size=1440,900` (无头默认 800x600 比应用 min-width 窄) + 框选断言前 `clearSelection()` 杜绝旧选区假阳性。判症特征: target=HTML + elementFromPoint=null = 坐标出视口。
- 回归适配: v49 tests.ts 的 5 处 `applyScaleDrag` 调用补 Begin 盒实参 (签名加第 7 参 `originalQuad`, 语义同 EditorCanvas 的 `sd.quad`)。
- 回归: `npx tsc -b` 通过; v1-v50 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v45/v49/v50 全绿。
- 对应改动: osu/selectionBox.ts (originalQuad 钳制 / selectionBoxVisible / 旋转手柄全套), components/EditorCanvas.tsx (window 拖拽接管 / 光标 / 旋转交互与渲染), components/Timelines.tsx (hitTestMarker 像素阈值), verifier/v49/tests.ts, verifier/v50/*。

## v51 (2026-07-27)
- 位置: verifier/v51/
- 运行: `cd app && node verifier/v51/check.mjs`; `node verifier/v51/cdp-v51.mjs` (需 7100 dev server 已启动)
- 内容: 修复"拖选中框下边时框的上边异常移动"。根因: `applyScaleDrag` 的 `moveSelectionInBounds` 越界判定用**全控制点包围盒** (`selectionScaleQuad`), 而中间控制点自节点编辑起就允许拖出游玩区 — 选区里有出界中间控制点时, 每次缩放更新都误判越界并整体平移 (哪怕 1.0 倍率也移), 拖下边整个框 (含上边) 瞬移。lazer `OsuSelectionScaleHandler.moveSelectionInBounds` 用的是 `GetSurroundingQuad(keys, startAndEndOnly: true)` — 只含物件头 + 滑条路径末端 (`enumerateStartAndEndPositions`: `h.Position` + `h.Position + path.PositionAt(1)`)。
  - selectionBox.ts 新增 `selectionStartEndQuad`: 头 + 滑条路径末端; 末端用**当前几何新建 SliderPath** 计算 (不用 getSliderPath 缓存 — 调用点在拖拽更新中、invalidatePath 之前, 缓存是上一帧几何)。
  - 注意 lazer 的**钳制** (`ClampScaleToPlayfieldBounds`) 仍用全控制点 `OriginalSurroundingQuad`, 只有**越界移回**用头+尾 — 两处盒不同, 别混 (本批只改后者)。
- 实测: 纯函数 11 断言 (头+尾盒排除出界中间控制点/单 cp 滑条末端即 cp 出界计入/1.0 倍率不再误报 changed/拖下边顶圈不瞬移/滑条尾出界仍整体移回贴底缘); 接线断言 6 条; CDP 4 断言 (圆圈 + 带出界中间控制点 (560,300) 滑条, 拖 bc 手柄 4 步全程圆圈保持 (200,100) — 旧实现第一帧即瞬移 (152,100); 滑条头缩放 (300,350); 一次 undo 还原), 全程无页面异常。
- 坑: 复现时先排掉了三个"看起来可疑但都符合 lazer"的方向 — ① 多物件滑条整体随头移动 (控制点不独立缩放) 导致"顶边是控制点时顶边会动", lazer 同语义 (`ClampScaleToPlayfieldBounds` 注释自认 "sliderends move with the sliderhead"); ② window mousemove 与 canvas onMouseMove 双触发, 缩放从快照重算幂等、旋转因 lastP 更新增量为 0 也幂等; ③ 钳制因 Begin 盒已出界把倍率压到 <1 (lazer 同款)。
- 回归: `npx tsc -b` 通过; v1-v51 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v49/v50/v51 全绿。
- 对应改动: osu/selectionBox.ts (selectionStartEndQuad + moveSelectionInBounds 换用), verifier/v51/*。

## v52 (2026-07-27)
- 位置: verifier/v52/
- 运行: `cd app && node verifier/v52/check.mjs`; `node verifier/v52/cdp-v52.mjs` (需 7100 dev server 已启动)
- 内容: 选中框三个投诉的处理。③"三点圆弧 (P) 滑条选中时框只包控制点没包整条滑条"是真实偏差, 已修; ①"双滑条拖下边/左边对边异常移动"②"拖边框不等比缩放选中滑条路径"经逐行对齐 lazer 源码确认是其**多选原生语义**, 非我们的偏差, CDP 用精确手算值锁定该语义防回归。
  - **修复 (③)**: lazer `SelectionHandler.Update` 的框 = 各选中 blueprint `SelectionQuad` 的 union 再 `Inflate(INFLATE_SIZE=5)`; `SliderSelectionBlueprint.SelectionQuad` = `SliderBodyPiece` (整条路径实体, 含路径半径) ∪ 头/尾圆 ∪ 控制点手柄 — P 滑条弧身鼓出控制点范围也在框内。新增 `selectionDisplayQuad(bm, objs, radius)`: 滑条取 `getSliderPath` 采样折线 (与渲染同一条中心线) 的包围盒, 圆圈取位置, 转盘排除, 统一外扩 `radius + SELECTION_BOX_INFLATE(5)`。EditorCanvas `currentQuads` 显示盒/手柄/旋转手柄全部换用; **缩放数学参考盒不变** (仍是控制点盒 `selectionScaleQuad` = lazer OriginalSurroundingQuad) — 显示盒与缩放盒分离, 别混。
  - **lazer 原生语义 (①②, 不改)**: `OsuSelectionScaleHandler.Update` 多选只缩 `ho.Position` (滑条控制点随头刚性平移, 源码注释明言 group selection 不缩路径; 仅单选滑条走 scaleSlider 缩路径, v49 已对齐)。框每帧由 blueprint SelectionQuad union 重算, 因此当顶/底边由**非原点侧滑条的路径**构成时, 拖对边该侧会随头移动 — lazer 同款 (`ClampScaleToPlayfieldBounds` 注释自认 "slider ends move with the slider head")。v52 新路径实体盒让框紧贴滑条身, 这种移动在视觉上不再"异常"。
- 实测: 纯函数 9 断言 (INFLATE=5/单圆圈盒/P 滑条框顶 58.5 包住弧顶 vs 旧 158.5/L 滑条+圆圈 union 排转盘); 接线断言 8 条; CDP 14 断言 (A: P 滑条弧顶 (250,100) 框顶探针黄、框上 4px 无黄、旧控制点盒顶无框线; B: 双横滑条拖下边 4 步全程 A 头/路径锚定 (150,100)-(350,100) 不动、框顶黄线全程在、B 钳到 sy=1.42 头 (150,384) 路径随头 (350,384) 长度不变、一次 undo; C: 竖滑条顶边由其路径构成, 拖下边 A 头 (150,384) 路径刚性偏移 (0,-200) 保持、无越界整体平移、一次 undo), 全程无页面异常。
- 回归适配: v49/v50/v51 CDP 坐标整体 +5px (旧显示盒 = 控制点盒 ± 半径, 新盒 ±(半径+5)); v50 A 段回拖断言放宽 ±1 (2.4x 理论 440 恰落 Math.round 半值边界, osu<->client 亚像素舍入); v51 check 的 import 断言补 getSliderPath。
- 回归: `npx tsc -b` 通过; v1-v52 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v49/v50/v51/v52 全绿。
- 对应改动: osu/selectionBox.ts (SELECTION_BOX_INFLATE + selectionDisplayQuad, import getSliderPath), components/EditorCanvas.tsx (currentQuads 显示盒换用), verifier/v52/*, verifier/v49|v50|v51 坐标适配。

## v53 (2026-07-27)
- 位置: verifier/v53/
- 运行: `cd app && node verifier/v53/check.mjs`; `node verifier/v53/cdp-v53.mjs` (需 7100 dev server 已启动)
- 内容: 上方时间轴加 lazer 风格药丸标签 (新模块 `osu/timelinePills.ts` 纯函数 + Timelines.tsx 绘制)。
  - **红线 -> BPM 红药丸** (lazer TimelineTimingChangeDisplay.TimingPointPiece): 文本 `{60000/beatLength:n1} BPM` (如 120.0 BPM), 色 Red2 `#eb4747`, 画在 tick 行上部 (y 63..76)。
  - **变速绿线 -> SV 绿药丸** (lazer DifficultyPointPiece): `sv = -100/beatLength` (legacy 绿线负 beatLength), 文本 `{sv:n2}x` (如 0.50x), 色 Lime1 `#b2ff66`, 画在 tick 行下部 (y 76.5..89.5)。`svChangePoints` 只给**实际变速**的绿线出药丸 — SV 原样重申/纯音量变化的绿线不出 (否则满屏重复标签); 基准 SV=1。
  - **物件 -> 粉药丸** (lazer SamplePointPiece): 文本 `{bank 字母}{:自定义序号} {音量}` — bank = hitSample.normalSet 继承链 (物件 -> timing point -> [General] SampleSet), normal/soft/drum -> N/S/D (lazer abbreviateBank); 序号 >1 加 `:n`; 音量 = hitSample.volume 覆盖否则 timing point volume (复用 hitSounds.objectVolume)。普通物件 Pink1 `#ff66ab`, slider Pink2 `#eb4791` (lazer AlternativeColor); 挂在时间轴头圆下方 (y 50..64 垂入 tick 行); `pillLayout` 过密收缩为 3px 圆点 (lazer SamplePointContracted)。
  - 药丸统一: 文字色 B5 `#222a28`, 胶囊圆角 = 高/2, 两侧 padding 5px (lazer HitObjectPointPiece)。
- 实测: 纯函数 17 断言 (BPM 一位小数/SV 两位小数/变速过滤/采样继承链 S 30・D 60・S:2 30/slider alt/收缩排布); 接线断言 12 条; CDP 8 断言 (横向扫描计数法抗字形干扰: 红药丸@y70 / 绿药丸@y83 / 纯音量绿线无药丸 / 单点 Pink1 / 滑条 Pink2 / 100ms 间距第二物件收缩为点), 全程无页面异常。
- 回归: `npx tsc -b` 通过; v1-v53 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v50 全绿 (时间轴交互不受影响)。
- 对应改动: osu/timelinePills.ts (新增), components/Timelines.tsx (三种药丸绘制), verifier/v53/*。

## v54 (2026-07-27)
- 位置: verifier/v54/
- 运行: `cd app && node verifier/v54/check.mjs`; `node verifier/v54/cdp-v54.mjs` (需 7100 dev server 已启动)
- 内容: 旋转手柄显示尺寸对齐 lazer。lazer `SelectionBoxRotationHandle` 基准 `Size = 15`, 基类 `SelectionBoxControl.UpdateHoverState` 在 hover/按住时 `ScaleTo(1.5)` -> 22.5px (v50 实现恒定 15px 偏小)。我们的手柄只在 hover/拖拽时显示, 显示即放大态: EditorCanvas 渲染尺寸 15px -> `15 * 1.5 * px` (22.5px 屏幕恒定), redo 箭头随之等比放大。基准常量 `ROT_HANDLE_SIZE = 15` 与命中逻辑不变 (lazer 命中区在静止尺寸 15px 触发 hover 后才放大)。
- 实测: 纯函数 3 断言 (常量 15/12.5 + 角点外扩); 接线断言 3 条; CDP 4 断言 (hover br 手柄后环形扫描测半径: 8 osu 环 16/16 黄 — 旧半径 ~6.1 osu 全灭, 10 osu 环 0/16 — 圆外; 画布缩放 1.2375 屏幕px/osu, 新半径 11.25 屏幕px ≈ 9.1 osu 实测吻合), 全程无页面异常。
- 坑: 手柄尺寸是**屏幕恒定 px**, CDP 探针必须用实测画布缩放 (1.2375, 随窗口/canvas 尺寸变) 换算 osu 距离, 不能假设 1:1; 环形 16 向扫描计数比单点探针抗箭头暗色笔画干扰。
- 回归: `npx tsc -b` 通过; v1-v54 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v50 全绿 (旋转拖拽交互不受影响)。
- 对应改动: components/EditorCanvas.tsx (旋转手柄渲染尺寸), verifier/v54/*。

## v55 (2026-07-27)
- 位置: verifier/v55/
- 运行: `cd app && node verifier/v55/check.mjs`; `node verifier/v55/cdp-v55.mjs` (需 7100 dev server 已启动)
- 内容: 三项需求。
  1. **物件吸附** (新模块 `osu/objectSnap.ts`, 对齐 lazer `OsuHitObjectComposer.TrySnapToNearbyObjects`): 阈值 `OBJECT_SNAP_RADIUS = 6.4` osu px (lazer `OsuHitObject.OBJECT_RADIUS(64) * 0.10`, 严格小于; 用户记忆中的"约4像素"实际为 6.4)。目标点 = 当前可见 (`isVisibleAt`, lazer alive blueprints) 且未选中物件的**中心 (未堆叠, lazer 去 StackOffset) + 滑条尾端** (偶数折返尾在头)。放置 (`snapPlacement`) 与拖拽移动 (`snapDragDelta`: 被拖物件头+滑条尾快照几何逐点试探, 最近一对修正位移) 都生效; 优先级**物件吸附 > 锁定间距** (lazer: 对象吸附 > 距离吸附 > 网格); lazer 无开关、无视觉指示 (预览直接跳过去)。
  2. **Ctrl+方向键逐 px 移动选中物件** (stable 同款): `store.nudgeSelectedPosition(dx, dy)` — 一次按键一次 undo, 滑条控制点随头平移 + invalidatePath。有选区时优先; 无选区时 Ctrl+左右仍是原来的跳前/后物件 (行为保留)。注意这让"有选区时 Ctrl+左/右跳物件"被 nudge 取代 — 是有意的需求覆盖。
  3. **Prev/Next 加原始像素**: `SelectionSpacingInfo` 新增 `prevPx/nextPx` (与倍率同一份 stacked 位置距离, 四舍五入), 面板显示 `0.00x(0px)` 格式。
- 实测: 纯函数 13 断言 (6.4 常量/目标点集合/严格小于边界 6.4 不吸/最近目标/拖拽位移修正/多点最近对/prevPx nextPx); 接线断言 13 条 (含放置先物件吸附后锁定间距的顺序断言); CDP 12 断言 (放置点 (205,103) 吸到 (200,100) 而 (220,140) 原样 ±1、拖拽 B->A 重合 + undo、拖拽 B->滑条尾 (350,300)、Ctrl+右右下 -> (202,101) + 三次 undo 逐步还原、面板 Prev: 7.07x(141px)/Next: 2.25x(180px)), 全程无页面异常。
- 坑: ① CDP 找新放置物件不能 `hitObjects.at(-1)` (按时间排序, 新物件 time=1375 排最前) 也不能 `id > 布景id` (genId 是全局计数器, 新 id 更小) — 用布景 id 集合差。② 放置第二点点到 (211,122) 不是 bug: 是 distanceLock 开着时锁定间距生效 (物件吸附未命中后的下一级), 测试布景显式 `distanceLock = false`。
- 回归: `npx tsc -b` 通过; v1-v55 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v45 (Prev/Next 断言是 includes 子串, 新格式兼容) / v50 / v53 全绿。
- 对应改动: osu/objectSnap.ts (新增), osu/spacing.ts (prevPx/nextPx), osu/store.ts (nudgeSelectedPosition), components/EditorCanvas.tsx (放置+拖拽吸附), components/Timelines.tsx (面板格式), App.tsx (Ctrl+方向键), verifier/v55/*。

## v56 (2026-07-27)
- 位置: verifier/v56/
- 运行: `cd app && node verifier/v56/check.mjs`; `node verifier/v56/cdp-v56.mjs` (需 7100 dev server 已启动)
- 内容: **网格吸附** (新模块 `osu/gridSnap.ts`, 对齐 lazer 三类 PositionSnapGrid)。
  - 语义 (逐行核对 lazer 源码): 正方形 = `RectangularPositionSnapGrid` (旋转后逐轴取整再转回); 三角形 = `TriangularPositionSnapGrid` (pixelToHex/hexToPixel 六边形网格, 线间距 spacing*sqrt(3)/2); 圆形 = `CircularPositionSnapGrid` (半径按间距取整, 中心点原样)。
  - 原点固定游玩区中心 (256,192) (lazer 默认值; 不做 X/Y offset 滑条, 保持简单)。间距 4..256, 初始 = [Editor] GridSize, 修改写回 `bm.editor.gridSize` (lazer 同款写回)。旋转仅正方形 (周期 90) / 三角形 (周期 60), 圆形禁用; `rotateVector` 用 lazer `GeometryUtils.RotateVector` 公式 (x'=x cos+y sin, y'=-x sin+y cos), 输入先 `normalizeRotation` 归一到周期内。
  - 优先级 (lazer `TryMoveBlueprints` :75-77): **物件吸附 > 锁定间距 > 位置网格 (最后应用并覆盖结果)**。滑条控制点 push 只过"物件吸附+网格", 不走锁定间距 (保持既有滑条放置行为)。
  - 网格线**始终显示** (lazer LayerBelowRuleset 无条件添加), 开关只管吸附; 线 alpha 0.1 / 过原点首线 0.2 / 圆环 0.2 首环 0.8, `strokeStyle='rgb(255,255,255)'` + globalAlpha 分级 (不能用 rgba 低 alpha 叠 globalAlpha, 会双重衰减)。开关默认关 (lazer TernaryState.False); lazer 的 Shift 瞬时反转与 GridFromPointsTool 未做 (超范围)。
  - UI: 工具栏锁定间距控件后加 ⊞ 网格开关 + 类型 select + 间距/旋转 number 输入 (data-grid-input=type/spacing/rotation)。
- 实测: 纯函数 19 断言 (rotateVector/normalizeRotation/snapSquare 含旋转 45 手算值 (301.25,192)/triangle 晶格点 (288,192) 与 (272,219.71)/circle len50->64 len40->32 中心点 钳制 (512,192)/线族法向); 接线断言 15 条; CDP 12 断言 (渲染亮度探针 __colMax: square x=288 线 113>90 线间 56<80, circle 首环 163>150 环间 <80; 三类放置吸附 square (290,226)->(288,224) triangle (305,218)->(304,220) circle (330,192)->(320,192); 网格覆盖物件吸附结果 (288,192) 而非 (290,194); 拖拽锚头落格点 (320,224) + undo; 关网格原样 ±1; 控件齐全/间距输入 64 写回 GridSize/圆形时旋转输入 disabled), 全程无页面异常。
- 坑: ① 首环 (r=spacing) 才是 alpha 0.8 的亮环, 最初探针打在 r=2*spacing 的第二环 (alpha 0.2) 导致亮度阈值失败。② 测 select 控件要用 HTMLSelectElement 原生 setter + change 事件 (与 input 的 setter 技巧同理)。③ v55 接线断言按旧源码文本匹配 `return p;`, snapPlacement 重构为 `return gridSnapAt(bm, p);` 后需同步更新断言文本 (语义不变)。
- 回归: `npx tsc -b` 通过; v1-v56 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v50 / v55 全绿。
- 对应改动: osu/gridSnap.ts (新增), osu/store.ts (gridSnap/gridType/gridSpacing/gridRotation), components/EditorCanvas.tsx (类型感知网格渲染 + gridSnapAt + 放置/拖拽/滑条控制点接线), App.tsx (工具栏控件), verifier/v56/*, verifier/v55/check.mjs (断言文本同步)。

## v57 (2026-07-27)
- 位置: verifier/v57/
- 运行: `cd app && node verifier/v57/check.mjs`; `node verifier/v57/cdp-v57.mjs` (需 7100 dev server 已启动)
- 内容: 两项 bug 修复。
  1. **网格间距输入框无法全选输入 10/20**: 旧实现 onChange 逐键 `Math.max(4, Math.min(256, v))` 钳制, 输入 "1" 立即被钳成 4, 永远输不出 "10"。改为 `GridSpacingInput` 组件 (App.tsx): 局部文本态 `useState<string|null>(null)`, 输入中不钳制, 仅合法值 (lazer 4..256) 才提交 store 并写回 `editor.gridSize`, 失焦 (onBlur setText(null)) 还原为已提交值。
  2. **锁定间距默认关**: lazer `ComposerDistanceSnapProvider.cs:63` `DistanceSnapToggle = new Bindable<TernaryState>()`, TernaryState 首成员为 False (`osu.Game/Graphics/UserInterface/TernaryState.cs:14`) -> lazer 默认关。store.ts `distanceLock = true` -> `false` (注释标明依据)。
- 实测: 接线断言 12 条 (默认 false/无残留 true/TernaryState.False 注释/GridSpacingInput 局部态/提交校验/移除逐键钳制/失焦还原/写回保留/tsc); CDP 7 断言 (fresh store distanceLock===false; 逐键 "1" 不提交框内仍显示 1; "10"/"20" 正常提交并写回 GridSize; "999" 超范围不提交; 失焦还原为已提交值), 全程无页面异常。
- 坑 (回归波及的旧断言): ① v56 check 按旧源码文本 `gridSize = c` 匹配, 重构后变量改名 `v` 需同步。② v45 CDP "空白区无 follow point" 探针 (256,250) 正好压在 v56 起始终显示的原点网格线 (x=256, alpha 0.2) 上 -> 布景显式 `gridSpacing = 256` 稀疏化网格 + 探针移到 (250,250)。
- 回归: `npx tsc -b` 通过; v1-v57 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v45 / v55 / v56 全绿。
- 对应改动: osu/store.ts (distanceLock 默认), App.tsx (GridSpacingInput), verifier/v57/*, verifier/v56/check.mjs + verifier/v45/cdp-v45.mjs (断言/探针同步)。

## v58 (2026-07-27)
- 位置: verifier/v58/
- 运行: `cd app && node verifier/v58/check.mjs`; `node verifier/v58/cdp-v58.mjs` (需 7100 dev server 已启动)
- 内容: **选区信息面板防换行**。v55 起 Prev/Next 带 `(px)` 后缀, 极端值如 `Prev: 999.00x(600px)` (20 个 11px 等宽字符 ≈ 133px + px-2 内边距 ≈ 149px) 超出旧 w-32 (128px) 导致换行。修复: SelectionInfoPanel `w-32` -> `w-40` (160px) 并加 `whitespace-nowrap` 兜底; 时间轴容器本是 `flex-1 min-w-0`, 面板加宽即自动缩短, 布局无需其他改动。
- 实测: 接线断言 7 条 (w-40/移除 w-32/nowrap/flex-1 布局/tsc); CDP 4 断言 (布景 1ms 内 600px -> 3000.00x(600px), 比 999.00x 更长的应力串; 面板宽 160; 三行 offsetHeight 均 20px 单行; 无纵向溢出), 全程无页面异常。
- 回归: `npx tsc -b` 通过; v1-v58 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v45 绿。
- 对应改动: components/Timelines.tsx (SelectionInfoPanel 宽度), verifier/v58/*。

## v59 (2026-07-27)
- 位置: verifier/v59/
- 运行: `cd app && node verifier/v59/check.mjs`; `node verifier/v59/cdp-v59.mjs` (需 7100 dev server 已启动)
- 内容: **播放速度 UI**。对齐 lazer `PlaybackControl.cs` (BottomBarContainer, 速度页签 Anchor.CentreRight 在底栏右侧): `PlaybackTabControl` 四档 `tempo_values = {0.25, 0.5, 0.75, 1}`, 百分比显示 (`value:0%` -> 25%/50%/75%/100%), 激活页签加粗高亮 (lazer textBold FadeTo)。实现在 BottomTimeline 右侧播放控制区 (时间显示左侧), "倍速" 小标签 + 四页签, 点击调既有 `store.setRate(v)` (store.playbackRate/clock.rate/WebAudio source.playbackRate 三链路此前已就绪, 播放中切换 = pause+play 重启 source 重锚定)。lazer 还调 AudioAdjustments.Tempo (变速不变调); 我们用 playbackRate (变速变调, WebAudio 无内置 tempo 算法), 差异从简。
- 实测: 接线断言 9 条 (四档值/百分比/setRate/激活加粗/底栏位置/store 三链路/tsc); CDP 15 断言 (4 页签标签与顺序、默认 1.0 且 100% 激活、暂停态四档往返点击 rate+加粗、播放中切 50% 不中断且 rate=0.5、半速实测 800ms 推进 408ms), 全程无页面异常。
- 回归: `npx tsc -b` 通过; v1-v59 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本); CDP 抽跑 v45 绿。
- 对应改动: components/Timelines.tsx (BottomTimeline 倍速页签), verifier/v59/*。

## v60 (2026-07-27; 2026-08-10 重写: signalsmith-stretch 替换手写 WSOLA)
- 位置: verifier/v60/
- 运行: `cd app && node verifier/v60/check.mjs`; `node verifier/v60/cdp-v60.mjs` (需 7100 dev server 已启动)
- 内容: **变速不变调** (lazer `AudioAdjustments.Tempo` 语义)。初版为手写 WSOLA, 现替换为 signalsmith-stretch 官方 Web Audio 发布版 (npm `signalsmith-stretch`, MIT, WASM/AudioWorklet, WASM 内嵌 base64 无外部资源), 提升 0.25x/0.5x/0.75x 变速音质:
  - `osu/clock/tempoWorklet.ts`: 封装 `SignalsmithStretch(actx)` 创建节点 + `TempoNode` 类型 (包无 TS 声明, 见 src/types/signalsmith-stretch.d.ts)。**buffer 模式**: 整首 PCM 经 `addBuffers` 移交节点内部缓冲, 不连接输入 (必须保持 numberOfInputs=1 默认; 为 0 时其静音分支解引用空输入列表会崩)。
  - 锚定: `schedule({output: startW, input: offset, rate})` 在 AudioContext 时间线上锚定 "谱面位置↔播放时刻", 与 `source.start(when, offset)` 同语义; 节点自补偿内部延迟 (默认 preset 总延迟 120ms, `latency()` 可查), 每渲染块按映射重定位 — 实测冲激落点偏差 <3ms (含 0.25x 与仅提前 20ms 排程), 全程无漂移, app/时钟层无需任何延迟补偿。
  - store: 时钟锚定 (`clock.rate`/`onStartedAtCtxTime(startW)`) 与 source 路径一致, hitsound/滑条循环排程不变; 播完由 tempoEndTimer 定时器处理 (节点无 ended 回执; **不能提前 schedule 未来 stop** — 其"清除其后排程"语义会把未来 start 一并丢弃); 未就绪回退 playbackRate (变调) 且就绪后自动 pause+play 重进; 换歌销毁旧节点 (持有旧 PCM); rate=1 不走引擎; HTMLAudio 降级 `preservesPitch` 不变; AnalyserNode(fftSize 4096) 频谱钩子保留。
- 实测: Node 沙箱加载**真实 WASM worklet** 23 断言 (注册/ready/延迟 120ms; 冲激落点 1.0/0.2/1.7/0.2ms; 0.5x 时长翻倍+基频 441Hz+起始前静音+收尾静音; 0.25x 基频 525Hz; stop 静音); 接线断言; CDP 全绿 (预热/0.5x tempoActive+半速 408ms/0.25x 频谱 14/14 命中原音高且无 1/4 频率峰值/seek 保持/ended 停曲末/rate1 tempoActive=false, 无页面异常)。
- 坑: ① schedule 的"清除其后排程"按 outputTime (缺省 = worklet 当前时刻) 判定, 未来 stop 会吞掉未来 start — 播完 stop 必须到点再发。② numberOfInputs=0 在 !active 分支解引用空输入列表崩溃, 必须保持默认 1 且不连接。③ schedule 消息需领先节点内部延迟到达才能完全补偿, 否则过渡处短暂 soft catch-up (位置映射仍精确, 无漂移)。
- 对应改动: osu/clock/tempoWorklet.ts (重写为 signalsmith 封装), osu/clock/wsola.ts (删除), osu/store.ts (引擎接线/播完定时器), components/Timelines.tsx (tooltip), src/types/signalsmith-stretch.d.ts (新增), verifier/v60/*。

## v61 (2026-07-28)
- 位置: verifier/v61/
- 运行: `cd app && node verifier/v61/check.mjs`; `node verifier/v61/cdp-v61.mjs` (需 7100 dev server 已启动)
- 内容: 两项对齐 lazer 的时间轴改动。
  1. **未变速绿线也显示 SV 药丸**: lazer `TimelineHitObjectBlueprint.cs:130-137` 每个 IHasSliderVelocity 物件都挂绿色 SV 胶囊, 无"与上一条不同才显示"判断; 等值剔除只在导出 .osu 时 (`LegacyBeatmapEncoder.cs:325` IsRedundant)。`svChangePoints` -> `svPoints` (全部绿线出药丸, SV 重申/纯音量/纯采样集变化的绿线同样显示)。
  2. **红绿线三角旗 -> 竖线**: 移除三角形旗标, 改为 lazer 色 (Red2 #eb4747 / Lime1 #b2ff66) 2px 全高半透明竖线 (alpha 0.55/0.45; lazer `PointVisualisation.cs` 为 4px 圆角竖条半透加色, 我们取竖线语义)。v28/v53 旧断言同步更新。
- 实测: 纯函数 7 断言 (SV 重申/纯音量/纯采样集绿线全出/排序/非 SV 绿线过滤); 接线断言 9 条; CDP 7 断言 (三条未变速绿线全出 0.50x 药丸/y=30 物件行区域有红绿竖线/旧三角旗位置无残留/无点处无竖线), 全程无页面异常。
- 回归: `npx tsc -b` 通过; v1-v61 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本; v28 旗标断言改竖线色); CDP 抽跑 v45 / v53 全绿。
- 对应改动: osu/timelinePills.ts (svPoints), components/Timelines.tsx (竖线渲染), verifier/v53/* + v28/check.mjs (旧断言同步), verifier/v61/*。

## v62 (2026-07-28)
- 位置: verifier/v62/
- 运行: `cd app && node verifier/v62/check.mjs`; `node verifier/v62/cdp-v62.mjs` (需 7100 dev server 已启动)
- 内容: 绿线音效集编辑 + 插入默认值克隆。
  1. **绿行全字段编辑** (.osu 绿行本就携带 SV+sampleSet+sampleIndex+volume+kiai, lazer `LegacySampleControlPoint`; 解析器 8 字段往返是既有能力): Timing 表格新增音效集下拉 (Normal/Soft/Drum=1/2/3)、自定义序号输入、kiai 勾选 (effects bit0), 红线另有"省略小节线"勾选 (bit3, lazer OmitFirstBarLine)。修改经 emit->dataVersion 触发 hitsound 事件表重建, 立即影响播放。
  2. **插入默认值克隆** (新模块 `osu/timingEdit.ts`, lazer `ControlPointList.addNew` :161-184 克隆语义): `defaultNewPoint` = 当前时间生效同类点 (effectivePointAt: 同类 time<=t 最后一条) 全字段克隆; 无同类点用格式常规默认 (红 500ms/绿 -100/set1/vol80)。替换原硬编码默认。
- 实测: 纯函数 14 断言 (effectivePointAt 边界/克隆全字段/无同类默认/setEffectBit 位运算); 接线断言 11 条; CDP 10 断言 (插入绿线克隆 SV0.5/Drum/idx2/vol45/kiai、插入红线克隆 150BPM/3拍/Soft/vol55、表格改音效集/序号/kiai/omit、序列化往返 `1000,-200,4,2,5,45,0,0` 与 `0,400,3,2,0,55,1,8`), 全程无页面异常。
- 回归: `npx tsc -b` 通过; v1-v62 全部 check.mjs 绿 (v8/v13/v14 仅 CDP 脚本)。
- 对应改动: osu/timingEdit.ts (新增), components/TimingPanel.tsx (表格列 + 插入克隆), verifier/v62/*。

## v63 — 上时间轴插入按钮 + 双击胶囊编辑弹窗
- `store.ts`: `timingPointDialog` 状态机 (open/close/apply/remove), apply 走 pushUndo + 替换或插入 + 按时间排序 (一次 undo)
- `TimingPointDialog.tsx`: 红/绿线全参数弹窗 (时间/BPM或SV/拍号/音效集/序号/音量/kiai/省略小节线), edit 模式带删除; BPM<->beatLength、SV<->beatLength 换算
- `Timelines.tsx`: 右上角 +红/+绿 按钮 (草稿 = defaultNewPoint 克隆当前时间生效点); hitTestTimingPill 按绘制同款几何 (文本宽+10, y=63/76.5 高13) 命中, 双击开 edit 弹窗
- 验证: verifier/v63 (tests 4 组 store 语义 + check 4 组源码断言 + cdp 4 组端到端: 插入克隆草稿/双击编辑音量/红线 omitBar+取消不变/弹窗内删除)

## v64 — 多边形生成 (lazer PolygonGenerationPopover)
- `convert/polygon.ts`: 移植 tryCreatePolygon — 弦长=DS×velocity×timeSpacing (velocity=100×SM×sv/beatLength, sv 取最近 endTime<=t 滑条自身绿线, clamp [0.01,10]), R=弦长/(2·sin(π/n)), θᵢ=起始角+(i+1)·2π/n, 圆心固定 (256,192); 顶点 3-32/圈数 1-10/起始角 0-180/DS 0.1-6; 出游玩区 => outOfBounds
- `snapBeatTime`: SnapTime 四舍五入到当前红线 beatLength/divisor 网格; 每点 t=SnapTime(t+timeSpacing)
- `PolygonDialog.tsx`: 四参数 + newCombo (默认跟随选区 NC 状态) + 实时预览 (hideIds 空) + 参数记忆 + applyConversion 一次 undo; 出界禁用创建
- 入口: Inspector 生成区按钮 (两分支) + Ctrl+Shift+D (lazer 同款快捷键)
- 验证: verifier/v64 (tests 5 组纯函数 + check 3 组源码断言 + cdp 4 组端到端: 快捷键开窗预览/改顶点实时更新+应用+undo/出界禁用/newCombo 仅首件); v36 旧断言同步 conversionDialog 联合类型

## v65 — 批量复制 (自研, lazer 无此功能)
- `src/osu/duplicate.ts`: `computeDuplicate` — 选中物件复制 N 份到后续时间; 第 i 份 = 时间 +i×间隔拍 (`advanceByBeats` 逐红线段换算, 跨 BPM 保拍位, 各物件按自身时间推进) + 绕锚点旋转 i×角 + 平移 i×向量 (累积); 锚点三模式与普通旋转相同 (选区包围盒/游玩区中心/自定义点); 转盘位置固定只动时间; 滑条控制点变换保留红锚点与长度; 副本全字段深拷贝继承 hitSound/newCombo
- `DuplicateDialog.tsx`: 次数 1-99/间隔 0.25-64 拍/旋转 ±360°/向量 ±512px; 锚点直接复用 store.originMode/customOrigin (画布自定义点拖拽生效); 实时预览 (hideIds 空, 原物件保留) + 参数记忆 + applyConversion 一次 undo
- 入口: Inspector 生成区 批量复制 按钮 (两分支, 未选中禁用)
- 验证: verifier/v65 (tests 4 组纯函数 + check 3 组源码断言 + cdp 6 组端到端: 预览/参数实时更新/三锚点旋转/平移累积/应用+undo/取消); v36/v64 旧断言同步 conversionDialog 联合类型

## v66 — 手绘滑条 (完整对齐 lazer B-spline 拟合)
- `freehand/pathApproximator.ts`: osu-framework PathApproximator 移植 — BSplineToPiecewiseLinear (Boehm 节点插入 + 自适应细分) / PiecewiseLinearToBSpline (Cox-de Boor 基矩阵 + Adam 优化, 每 11 步重排标签) / 弧长插值器
- `freehand/bsplineBuilder.ts`: IncrementalBSplineBuilder 逐行移植 — FD_EPSILON=2.0 采样 7 阶平滑, 32 窗口 4 倍均值拐角检测, Tolerance×曲率密度布点, 近直线特判, <4px 细节丢弃 (尾部跟随点), 全量 200 迭代 lr=5 / 绘制中末段 10 迭代带 mask / Finish 100 迭代
- `freehand/freehandFit.ts`: tryCircleArc (外接圆 + 损失/单向 ≤ 一圈判定) + 段组装 (段起点红锚点; 单段圆弧 => 整条 P)
- `EditorCanvas.tsx`: 滑条工具只有头部时左键按下 = 手绘候选 (排在末点切红之前, 否则头部起笔被截获), 超 4px 进 Drawing (Degree 4 / Tolerance 1.8 / Corner 0.4 / Circle 0.0015, 原始光标点不吸附), 实时拟合预览走 pendingSlider; 松开 Finish 建滑条 (单弧 P / 否则 B 红锚点加倍, 长度几何全长 + 锁定间距吸附, 一次 undo); window mouseup 兜底; 候选未拖动 = 单击放点 (近头部则切红)
- 验证: verifier/v66 (tests 6 组纯函数: 直线 2 点/圆弧 singleArc 半径 ≈ 50/L 形 2 段红锚点/FD_EPSILON 细节丢弃 + check 4 组源码断言 + cdp 4 组端到端: 弧 => P 长 76/直线 => B/L 形 => B 重复对/单击放点不回归)

## v67 — Ctrl+S 保存谱面 (lazer Editor Save 语义)
- `osu/saveMap.ts`: saveBeatmap 三通道按来源路由 — server (服务器直读目录, POST /api/local-fs/write 写回原文件) / native (File System Access 授权目录, 手势内 requestPermission readwrite 后 createWritable 写回) / download (.osz/拖拽/演示谱面, 兜底下载); mapFileName stable 命名 "Artist - Title (Creator) [Version].osu" 剔除 Windows 非法字符, ASCII 空回退 Unicode; pickSaveRoute 纯函数按目录对象能力 (writeFile/queryPermission) 判定
- `store.ts`: mapSource (曲库目录 + 原文件名, load() 第 5 参传入, SongLibrary openDiff 记录) + save() (反馈消息区分 已保存/已导出/保存失败, 2.6s 自动清除, lastSave 测试挂钩)
- `server/localFsCore.mjs`: /api/local-fs/write (POST, body=文件内容, 沿用 rootAbs 越界防护); vite.config.ts 与 electron/main.cjs 同步加请求体收集; localFsCore.d.mts 声明同步; serverFs.ts serverDir 实现 writeFile, library.ts FsDirLike 加可选 writeFile
- `App.tsx`: Ctrl+S (preventDefault 拦浏览器保存页); 工具栏 data-save-message 反馈; 导出 .osu 按钮复用 mapFileName/downloadText
- 验证: verifier/v67 (tests 4 组纯函数: 命名/路由/序列化往返/server 通道写出 + check 6 组源码断言 + cdp 4 组端到端: 无来源下载 stable 命名/服务器来源写回含修改物件/失败反馈不清 lastSave/反馈自动清除)

## v68 — 批量复制增强 (复制绿线 / 向量箭头拖拽 / 自定义锚点吸附)
- `osu/duplicate.ts`: DuplicateParams 加 copyGreenLines (默认关); computeDuplicateTiming 纯函数 — 源 = 落在任一源物件 [time, endTime] 内的绿线 (滑条 = 整条 duration, 单点/转盘 = 该刻), 每份按与物件相同的 advanceByBeats 拍偏移, 共享绿线去重 + 同份目标时刻撞车保留后者
- `store.ts`: conversionPreview/applyConversion 支持绿线副本 (timingPoints 第三参, 同一次 undo); dupVectorView (锚+向量, 非响应式画布每帧读) + dupVectorDragHandler (弹窗注册回写)
- `DuplicateDialog.tsx': "复制绿线" 勾选框 (显示将生成条数); 绿线副本预览上时间轴 (Timelines/renderer mergedWithPreview 合并, WYSIWYG); 向量≠0 时画布画青色箭头 — 锚 = 第一批(源)物件结尾 (最后源物件尾端, 滑条取 sliderTailPoint), 拖箭头头 (10px 命中) 实时回写 dx/dy
- `EditorCanvas.tsx': 自定义旋转锚点拖拽加 物件吸附 (全部可见物件中心/滑条尾, 6.4px) + 网格吸附, 与物件放置同级 (批量复制与变换共用)
- 验证: verifier/v68 (tests 4 组纯函数: 开关/范围/共享去重/跨红线拍位/预览合并 + check 5 组源码断言 + cdp 4 组端到端: 预览 4 条绿线+应用+undo/箭头锚+拖头改向量+预览联动/锚点物件吸附/锚点网格吸附); v34/v36/v65 旧断言同步 (语义不变)

## v69 — 修复: 批量复制预览滑条长度不随"复制绿线"切换变化
- 根因: 上时间轴 objEnd 始终用 bm.timingPoints 推导滑条时长 (长度/头部SV), 预览副本落在不同 SV 区时条长 = 落点现有 SV, 与勾选无关; 应用后 (绿线已写入) 行为不同 => 预览不 WYSIWYG
- `osu/renderer.ts': 抽 objectEndAt 纯函数 (滑条 = 长度/头部SV×折返, 转盘 = endTime 兜底 +1000, 单点 = time)
- `Timelines.tsx': objEnd 改用合并预览绿线后的 timing (排序), 勾选复制绿线时预览条长 = 应用后效果
- 验证: verifier/v69 (tests 2 组纯函数: 推导公式/SV 0.5 翻倍/折返/转盘 + 合并预览集成 + check 2 组源码断言 + cdp 1 组端到端: 黄描边跨度实测 714ms vs 357ms, 73px ≈ 期望 72px)

## v70 — 全页签上下时间轴 + timing 页签紧凑独立窗口
- `App.tsx`: TopTimeline + SelectionInfoPanel 移出页签条件, 所有页签(edit/timing/…)都显示上时间轴与下时间轴, 原页签 UI 排其下
- `osu/timingEdit.ts`: formatMsTime (h:mm:ss.mmm, 负值钳 0) + activeGreenAt (当前时间生效绿线, 红线后复位, 与 timingAt 同语义)
- `store.ts`: timelineHoverTp 字段 (上时间轴悬停命中的红/绿线)
- `Timelines.tsx`: TopTimeline onMouseMove 悬停追踪 (±4px 内最近红/绿线, 拖拽中不追踪), onMouseLeave 清除
- `TimingPanel.tsx`: full 模式重写为紧凑独立窗口卡片 (w-fit 居中, border-collapse, 单元格 px-2 py-1 text-center whitespace-nowrap 连续排版); 四项 — 1. 时间输入框后加 data-tp-fmt 时分秒显示; 2. 红绿线属性连续排版并居中; 3. 悬停上时间轴红绿线 => 对应行 data-hover-tp 高亮 (bg-sky-500/25); 4. 当前时间生效绿线行 data-active-green 实时高亮 (bg-emerald-500/20), seek 即变; 右侧 w-72 说明栏
- 验证: verifier/v70 (tests 2 组纯函数: formatMsTime 5 例 + activeGreenAt 6 例 + check 4 组源码断言 + cdp 4 组端到端: timing 页签双时间轴+行渲染/0:00:01.000 格式/悬停命中+行高亮+移开清除/seek 1200-1600-2100 生效绿线跟随)

## v71 — timing 窗口内滚动条 + 切页签自动滚到生效绿线行
- `TimingPanel.tsx`: 顶部控制栏 (CS/AR/OD/HP + 增线按钮) 固定不滚, 表格区独立滚动 (data-tp-scroll, full 模式 max-h-[65vh]) => 滚动条收进紧凑窗口内部
- `osu/timingEdit.ts`: scrollTargetIndex 纯函数 — 生效绿线行优先, 无生效绿线则最近一条 time <= t 的点, 全在之前则首行, 空表 -1
- `TimingPanel.tsx`: 挂载后 rAF 按 scrollTargetIndex 把目标行滚到容器中部 (容器内 scrollTop, 不动外层页面); 页签切换组件重挂载 => 每次切到 timing 都自动定位
- 验证: verifier/v71 (tests 1 组纯函数 7 例 + check 3 组源码断言 + cdp 3 组端到端: 26 行布景容器限高滚动/切入自动滚到生效绿线行 15 且可视/seek(500) 切走切回滚回顶部)

## v72 — timing 表头行固定在窗口内不滚动
- `TimingPanel.tsx`: thead 改 sticky top-0 z-10 + th 加底色 bg-[#16161d] 遮挡滚动内容 (data-tp-thead 测试挂钩), 类型/时间等表头行在表格滚动时固定可见
- 验证: verifier/v72 (纯样式改动无 tests; check 2 条源码断言 + cdp 2 组端到端: 自动滚动 257px 后表头贴容器顶 offset=0 / 手动滚到底部表头仍固定)

## v73 — 手绘滑条落盘对齐 lazer 导出 stable (B 样条→贝塞尔转换)
- 根因 (对照 lazer SliderPlacementBlueprint + BezierConverter.ConvertToModernBezier + framework PathApproximator.BSplineToBezier): v66 把 builder 的 degree-4 B 样条控制点原样存为 stable 'B' (贝塞尔锚点), 段内 <=5 点时两者恰好一致, >=6 点的平滑长段被当 degree-(n-1) 高阶贝塞尔渲染 => 振荡偏离手绘轨迹; 多段内弧段被当二次贝塞尔; tryCircleArc 两处 dir==0 未按 C# continue 跳状态更新
- `freehand/pathApproximator.ts`: 导出 bSplineToBezier (framework BSplineToBezier — Boehm 节点插入后各 piece 平铺, 相邻 piece 共享端点 = 连续重复点)
- `freehand/freehandFit.ts`: convertCircleToBezierAnchors 移植 (BezierConverter circle_presets 5 档 + de Casteljau 收敛到 thetaRange + 旋转归位); fitSegmentsToPoints 重写 — B 样条段 => bSplineToBezier (piece 接缝合并为红锚点), 弧段单段保留 3 点 'P' / 多段内 => 圆预设锚点, 非末段不重复尾点 (与 lazer 同构); tryCircleArc 两处 continue 语义修正
- EditorCanvas 无需改动: 预览/成图同走 fitSegmentsToPoints, 预览即 WYSIWYG
- 验证: verifier/v73 (tests 6 组纯函数: Boehm 平铺/圆预设贴合 r 误差 0.02px/8 点段 3 接缝且转换后路径 ≡ B 样条 (偏差 < 0.25 容差)/builder 长笔画集成/多段弧转换/单弧 P 与直线回归 + check 4 组源码断言 + cdp 3 组端到端: 波浪笔画 dup=3 接缝 偏差 2.24px/弧+拐角弧段多锚点 弧主体偏差 0.15px 全程 5.10px (拐角窗口平滑)/无异常); v66 旧断言全部保持绿

## v74 — 手绘滑条四项 (B4 少控制点落盘 / 拖过时间轴不 seek / 预览连线 / 一键手绘)
- **B4 落盘 (对齐 lazer 编辑器)**: 手绘非单弧滑条落盘 curveType 改 'B4' (lazer 扩展格式 B4|, degree-4 B 样条, 控制点 = builder 原始输出, 450px 波浪笔画 8 个控制点 vs v73 贝塞尔锚点 20 个); 弧特判仅单段 (整条 P), 多段内弧段保留 B 样条控制点 (形状不变点更少; lazer 记 PERFECT_CURVE 段但我方单类型模型不支持混合段类型)。注意: B4 与 lazer 保存的 .osu 一致, stable 无法读取 (lazer 自身同此前提, stable 导出需经 BezierConverter 转换, 转换器已保留备用)
- `sliderPath.ts`: computeRawPath 加 case 'B4' (bsplinePath: 重复点分段 + bSplineToPiecewiseLinear degree-4); resolveSliderCurveType B4 + 红点对保持 B4; PendingPoint.bspline 标记 => computePendingPath 段按 B4 渲染 (修复 3 点段误推断 P); parser/serializer 原样往返 B4
- **拖过时间轴不 seek (根因)**: canvas onMouseLeave 此前会调 onMouseUp => 手绘被提前 finish 且 canvasDragging 被清 => 按钮仍按着经过时间轴时误 seek; 修复: freehandRef/drawCandRef 进行中 onMouseLeave 不终止 (与 v50 缩放/旋转同机制, window mousemove 继续采样 + window mouseup 收尾); 候选登记时也置 canvasDragging=true
- **预览控制点连线**: drawPendingSlider 加 2px 白线连接控制点 (与选中滑条 lazer PathControlPointConnection 一致)
- **一键手绘**: 滑条工具无待放点时左键按下 = 立即放头 + 登记 isHead 手绘候选, 保持按住续拖直接进手绘 (lazer OnDragStart 手感); 松开未拖动 = 头已落好, 不加点不切红
- 验证: verifier/v74 (tests 4 组纯函数: B4 路径/类型解析/预览 bspline/.osu B4 往返 + check 4 组源码断言 + cdp 4 组端到端: 一键 B4/单击放头不回归/拖过时间轴不 seek 且笔画不中断/弦上白色连线像素 7/7); v66/v73 旧断言同步 v74 语义

## v75 — 落盘弧段保形 + Ctrl+G 反转 (lazer 对齐)
- **落盘弧段贝塞尔锚点转换**: 点击放置滑条时预览按段推断类型 (3 点段 'P' 圆弧渲染), 但 finishSlider 落盘 'B' 保持控制点不动, 3 点段被 de Casteljau 当二次贝塞尔 => 形状塌掉 (实测偏差 50px)。修复: sliderPath.ts 新增 preserveArcsForBezier — 'B' 控制点列按红锚点重复对分段, 恰 3 点的段走 v73 移植的 convertCircleToBezierAnchors (lazer BezierConverter 圆预设, lazer 导出 stable 同款), 段间共享点直接拼接自动形成重复对, 坐标取整; 共线 3 点段原样 (退化直线), 2 点/4+ 点段不动; 非 'B' 原样返回。转换后与预览弧偏差 0.22px, WYSIWYG 保持。坑: 段重拼接时别再补一个 dup — 相邻段本就共享边界点, 补了会变三连点 (退化零长段)。
- **Ctrl+G 反转 (lazer OsuSelectionHandler.HandleReverse + SliderPathExtensions.Reverse)**: 新增 src/osu/reverse.ts — reverseSlider: 新头 = PositionAt(length) 截断真尾端; 截断滑条 (几何 > length) 丢尾端整段 (保留跨界段); 'P' 单段截断重算中点 = PositionAt(length/2) 保形; 控制点列整体反转 (红锚点重复对反转后仍相邻, stable 单 curveType 模型免 lazer 的段类型前向传播); edgeSoundsRaw/edgeSetsRaw 按 '|' 分段反转。reverseSelection: 多选时间镜像 o.time = selectionEnd - (o.end - selectionStart) (duration 镜像前求值; 转盘同款只改 time 不动 endTime), 反转后按新时间重排且 newCombo 保持时序位置 (combo 数字位置不随物件走)。store.reverseSelected: 一次 undo + invalidate 滑条路径缓存 + beatmap 重排序; 单选非滑条无操作 (lazer CanReverse: >1 或任一滑条)。
- **键位冲突处理**: 原 Ctrl+G = 旋转 90° 让位给反转 (lazer Ctrl+G = Reverse); 旋转 90° 改绑 lazer 官方键位 Ctrl+, (逆时针) / Ctrl+. (顺时针) (SelectionBox.cs OnKeyDown: Key.Comma/Key.Period); Ctrl+H/J 镜像不变。Inspector 提示文本同步; v17 check 旧断言 (Ctrl+G 旋转) 同步为新键位。
- 验证: verifier/v75 (tests 12 组纯函数: 弧转换保形/共线退化/多段重复对/非 B 不动 + 反转头尾互换/形状精确反转/截断 P 保形/截断丢段/edgeSounds 反转/时间镜像/newCombo 保持/单选无操作 + check 6 组源码断言 + cdp 4 组端到端: 弧段落盘保形+红锚点保留/Ctrl+G 头尾互换+undo 还原/单 circle 无操作/双 circle 时间镜像+newCombo 时序); CDP 端口 9411 (9410 被本机其他服务占用); 坐标断言用 ±1 容差 (osu->client->osu 往返舍入); addObject 不自动选中, CDP 布景需显式 select。

## v76 — 放置预览幻影尾点 + 节点拖拽吸附
- **预览尾点手柄**: 创建滑条时预览不显示当前光标处 (滑条尾) 的控制点。sliderPath.ts 新增 pendingPhantomPoint (cursor 距末点 >2 才计入, 从 computePendingPath 抽出, 路径幻影点与渲染共用同一判定); drawPendingSlider 用同一判定把幻影尾点接入白色连线并画白色手柄 (lazer 放置预览: 光标即当前滑条尾的控制点)。
- **节点拖拽吸附**: 修改已建滑条时拖控制点 (含头部、红锚点成对) 原先只吃 round 不吸附; 现与放置同款规则 — 物件吸附 (snapToNearby <6.4px, 目标 = 除本滑条外的可见物件位置+滑条尾) 优先, 网格吸附 gridSnapAt 最后应用并覆盖; 仍不钳制游玩区 (v29 语义保持, 旧断言已同步)。放置侧 (放头/续点) v56 起本就有吸附, 未动。
- 验证: verifier/v76 (tests 2 组纯函数: 幻影点判定/computePendingPath 一致性 + check 3 组源码断言 + cdp 3 组端到端: 幻影手柄增亮 23->206/拖控制点吸附 circle/拖头吸附网格交点 (288,192)); v29 check 节点拖拽断言同步 (round(p)->round(sp))。

## v77 — Electron 原生 "文件" 菜单 (stable 风格)
- **需求**: 打包 exe 后窗口菜单栏最左侧加 "文件" 菜单 (浏览器/dev 无变化): 保存 (同 Ctrl+S) / 打开一个难度 (当前谱面内切换) / 打开最近的难度 (持久化记忆) / 打开歌曲文件夹 (文件浏览器) / 在记事本中打开.osu文件。
- **主进程 (electron/main.cjs)**: buildMenu() 动态建菜单 — 保存 (CmdOrCtrl+S accelerator, enabled 取决于已加载) 与难度/最近项均经 webContents.send("menu-cmd") 下发; 打开一个难度子菜单 = 渲染端上报的当前文件夹难度列表 (当前项加 ✓); 打开最近的难度子菜单 = settings.json recents (server/recentsCore.mjs pushRecent: 置顶+同键去重+上限10, 每次 menu-state 上报时持久化); 打开歌曲文件夹 = shell.openPath(songsDir+folderRel); 记事本 = spawn notepad.exe (detached+unref); 非服务器来源 (拖拽导入, folderRel=null) 时文件夹/记事本项禁用。menu-state IPC 收到后重建菜单。
- **preload/桥接**: osuEditor.menuState(state) + onMenuCommand(cb) (可退订); electronBridge.ts 类型同步 (ElectronMenuState/ElectronMenuCommand)。
- **渲染端 (src/osu/electronMenu.ts)**: reportMenuState (store.load 末尾调用, 非 Electron 无操作) — folderRel 取 serverDir 新增的 serverRel (FsDirLike 加可选字段), listDifficulties 组难度子菜单 ([version] fileName); handleMenuCommand — save => store.save, open => openServerDifficulty (serverDir('songs', rel)+loadDifficulty+store.load 记录来源, 与曲库 openDiff 同路径); App.tsx 订阅 onMenuCommand (open 后关曲库面板); window.__osuMenuCmd 调试暴露。
- 验证: verifier/v77 (tests 6 组 pushRecent 纯函数 + check 4 组源码断言 (main/preload/electronMenu/接线) + cdp 4 组: 非 Electron 惰性/夹具 Songs 目录 open 加载/切换同夹具难度 2/打开不存在文件静默失败; 布景临时改写 local-dirs.json (vite 每请求重读), finally 恢复)。坑: cdp 脚本算 ROOT 必须用 fileURLToPath (目录名含中文, 手写 pathname 解码会留 %E7 编码); 原生菜单/notepad/shell 无法 CDP, 仅 node --check + 源码断言覆盖。

## v78 — 自定义网格中心 (可拖拽)
- **需求**: 为网格指定自定义中心, 逻辑同自定义锚点中心 (customOrigin), 支持拖拽可视化的中心标记。
- **store.ts**: gridOrigin (默认 (256,192) = 游玩区中心, lazer OsuGridToolboxGroup StartPosition 默认) / gridOriginCustom (默认关) / setGridOrigin (取整) / setGridOriginCustom / currentGridOrigin() = custom ? gridOrigin : GRID_ORIGIN。UI 状态, 不入 undo/谱面 (对齐 customOrigin 惯例)。
- **EditorCanvas.tsx**: gridSnapAt 与物件拖拽网格吸附两处原点 GRID_ORIGIN => currentGridOrigin() (放置/节点拖拽/物件拖拽全部生效); 网格线渲染同一原点 (O = currentGridOrigin(), 所见即所吸); 标记渲染 = 青色 #4df3ff 方框 (rect m±7) + 十字 (±14~±4) + 中心实心点 (r2.5), 仅 gridOriginCustom 时显示, 与工具无关; mousedown 标记命中 (半径 12, 与自定义原点同款) 置于所有工具分支之前 => 全工具可拖, 只改原点不进 undo; 拖拽只做物件吸附 (snapToNearby), 不做网格吸附 — 网格以标记自身为原点, 吸附会自锁跳动 (用户反馈修正); 不钳制游玩区; window mouseup 重置 gridOriginDragRef。
- **App.tsx**: 网格旋转输入后加 "◎ 中心" 开关 (开启时青色高亮) + 开启后显示 x/y 两个 number 输入 (对齐 lazer StartPositionX/Y 可配)。
- 验证: verifier/v78 (tests 5 组纯函数: 方形自定义原点/原点吸自身/默认原点回归/圆形径向吸附/三角形原点附近 + check 3 组源码断言 + cdp 4 组端到端: 自定义原点放置吸附 (292,176)+关自定义回归 (288,192)/circle 工具+网格吸附开启下拖标记仍精确跟随 (150,120) 不吸自身网格且不误放物件/标记像素 rgb(77,243,255)/开关切换 custom 且 x/y 输入显隐)。坑: 采样标记像素前须把光标移开 (buttons:0 hover), 否则 circle 工具放置预览盖在标记上; v68 check 的 window mouseup 行断言同步 (同行新增 gridOriginDragRef 重置)。

## v79 — 上方时间轴: 点击不改时间 + 尾圆可命中
- **需求 (用户反馈)**: 点击上方时间轴不该改变当前时间; 左键点物件有时会跳时间且选不中鼠标下的物件; 右键物件有时删不掉。根因: 单击物件/尾端/空白均会 seek (对象时间/尾时间/点击位置), seek 后窗口重居中导致视觉错位; hitTestMarker 只测头圆, 点在滑条/转盘尾圆上时落空 => 走框选分支 seek 且选不中, 右键同逻辑删不掉。
- **点击不 seek (Timelines.tsx)**: finishMarkerDrag 三个收尾分支 (框选未移动/拖尾未移动/物件未拖动) 全部去掉 seek — 单击物件 = 仅选中, 单击空白 = 仅清空选区, 单击尾端 = 无操作; tick 行 mousedown 不再 seek (仅清空选区); 按住拖动 scrub seek 移除; TopTimeline 的 seekFromEvent 删除 (BottomTimeline 不受影响, 仍可点击定位)。
- **尾圆命中**: 命中逻辑抽为纯函数 src/osu/timelineHit.ts timelineMarkerHit — 头圆与尾圆 (end-time>1ms 的物件) 同为命中目标, 像素阈值 rad+3 就近胜出; 连体条中段仍不命中 (v50 框选保护语义保持)。左键选中/拖拽预备与右键删除共用此命中, 尾圆上右键删除修复。
- 验证: verifier/v79 (tests 9 组纯函数: 头圆/尾圆/就近/阈值/中段不命中/窗口外 + check 2 组源码断言 (finishMarkerDrag 内无 seek, scrub 已移除) + cdp 5 组端到端: 点头圆/点尾圆选中且时间不变/点中段清空选中/右键尾圆删转盘/右键头圆删单点); 旧断言同步 — v32 (点击=选中不 seek), v35 (单击尾端不 seek), v45 (单击空白仅清空), v50 (命中逻辑挪 timelineHit.ts)。

## v80 — 上方时间轴: 连体条中段单击选中/右键删除 (barHit 兜底)
- **需求**: 点击滑条中间部分也要能选中滑条。与 v50 (条中段命中会抢走框选) 调和: barHit 只在**单击(未拖动)且圆命中落空**时兜底 — mousedown 拖拽预备仍只认头/尾圆, 按住拖动经过条区域照常进框选; 拖动与单击分流后两者兼得。
- **timelineHit.ts 新增 timelineBarHit**: 条 [sx,ex] 含 px 且有时长 (end-time>1ms) 的物件中, 取 time 最晚者 (绘制序 = 时间序, 最晚画在最上层); 排除窗口外与无时长物件。
- **Timelines.tsx 接线**: finishMarkerDrag 框选收尾未拖动分支 — 落空时先查 barHit, 命中则 select([...base, barId]) (Shift 追加), 真空白才清空选区; onContextMenu 右键同款兜底, 条中段右键删除修复。
- 验证: v79 批次内扩展 (tests +6 组 barHit 纯函数: 中段/边界/空白/单点排除/重叠取最晚 + check 新增 barHit 断言 + cdp C 组改为中段单击选中, 新增 C2 条区域拖动仍框选, D 组改为右键条中段删除); v45 check 清空选区断言同步; 全量 check + v45/v50 CDP 回归通过。

## v81 — 工具栏清理 + 保存反馈挪右上角标题
- **删除无用按钮**: 「打开 .osu / .osz / 音频」(打开走曲库/拖拽导入) 与「导出 .osu」(保存走 Ctrl+S) 按钮及隐藏 file input、exportOsu 函数一并移除; downloadText/mapFileName import 清理 (下载兜底仍在 store.save -> saveBeatmap 内); TimingPanel 帮助文本「导出 .osu」-> Ctrl+S。
- **谱面名称加宽**: 右上角标题 max-w-72 (18rem) -> max-w-[36rem] (约 2 倍)。
- **保存反馈挪位**: 原工具栏独立 saveMessage span 删除, 改为右上角标题前缀 — 保存时名称前加 [已保存]/[已导出] 粗体前缀且整行变绿 (text-emerald-400), 失败 [保存失败] 变红; data-save-message 属性改挂标题 span (v67 CDP 兼容), 2.6s 后自动消失不变。
- 验证: verifier/v81 (无新增纯函数, check 3 组源码断言 — 注意别在注释里写被断言“已删除”的原字符串, 会自命中; + cdp 2 组: 按钮/file input 从 DOM 消失, Ctrl+S 后标题 [已导出] 绿色前缀+完整谱面名+2.6s 消失); v67 check 导出按钮断言同步为“已删除”, v67 CDP 回归通过。

## v82 — 上方时间轴: 放置中滑条预览 (幻影虚线条)
- **需求**: 新建滑条 (非手绘, 点击放点模式) 时上方时间轴不显示正在放置的新滑条。修复: 放置中 (tool=slider 且 pendingSlider 非空) 在物件行画幻影 — 白 16% 填充条 + 75% 虚线描边 (6/4 dash) + 头/尾圆环。
- **sliderPath.ts 新增 pendingSliderTimeline (纯函数)**: 预览区间与 finishSlider 落盘完全同规则 — 时间 = currentTime 按 beatSnap 吸附; 长度 = computePendingPath 几何全长 (含幻影光标点), 锁定间距吸整拍, 下限 20px; end = time + len/vel (slides=1)。手绘滑条复用 pendingSlider, 同样受益。
- **store.pendingCursor**: EditorCanvas mousemove 维护 (仅滑条放置中, 原始未吸附坐标, 与画布预览一致), finishSlider/finishFreehandSlider 落盘/退化时清空; 时间轴 rAF 直接读, 不需要 emit。
- 验证: verifier/v82 (tests 5 组纯函数: 时间吸附/时长换算/锁定间距整拍/下限 20px/幻影光标计入长度 + check 3 组源码断言 + cdp 1 组端到端: 放 2 控制点后时间轴条位置 14->52 增亮, 条外不亮, Escape 后消失且 pendingSlider 清空); v66 (手绘) CDP 回归通过。

## v83 — 预览代码复用收敛 (用户调研后的重构)
- **背景**: v82 后落盘长度规则有三份拷贝 (finishSlider/finishFreehandSlider/pendingSliderTimeline), 时间轴真实物件与幻影是两套平行绘制。本批纯重构, 无行为变化。
- **落盘规则收敛 (sliderPath.ts)**: 新增 snapPlacementTime (当前时间按 beatSnap 就近 tick) 与 placementLength (几何全长 -> 锁定间距吸整拍 -> 下限 20px); pendingSliderTimeline 改为委托这两个函数; finishSlider/finishFreehandSlider 各自的三行规则拷贝删除, 改调 placementLength + snapPlacementTime (EditorCanvas 内 beatPx/vel 局部计算清零, sliderVelocityAt import 移除)。预览=落盘从此同源。
- **时间轴绘制收敛 (Timelines.tsx)**: 提取 drawTimelineObject (连体条 + 尾圆 + 折返点 + 头圆 + combo 数字, 样式参数化: fill/barFill/barStroke/headStroke/dashed/slides/number/dur); 真实物件 (combo 染色/选中黄环/newCombo 粗环) 与 v82 放置预览幻影 (白色半透明虚线) 共用。尾圆描边沿用条样式等原实现细节逐一保留。
- 验证: verifier/v83 (tests 11 组纯函数: snapPlacementTime 吸附/placementLength 锁定间距+下限+取整/pendingSliderTimeline 委托后语义回归 + check 3 组: 委托断言, EditorCanvas 两处 placementLength 且无第三份拷贝, 绘制两调用点 + cdp 3 组: 幻影渲染不变 14->52, 双击落盘 time/length 与预览区间换算一致 (99=99), 真实连体条渲染不变)。坑: cdp 断言换算 length 必须用页面内 sliderVelocityAt (demo 谱 sliderMultiplier=1.4, 手写 vel=0.2 会算错); v15/v31 旧断言同步到收敛后位置。

## v84 几何辅助点/线吸附 (Mapping Tools SnappingTools 移植, 仅三种)
- 需求: 工具栏 "🧲 辅助" 按钮打开 Geometry Dashboard 风格面板, 三种辅助图形作用于选中滑条, 可独立开关 (默认全开), 均参与吸附
- 语义来源 osu_mapping_tools SnappingTools Generators:
  - LinearLineGenerator: L 型滑条 = 头->最后锚点的无限直线 (中间锚点忽略), 裁剪到游玩区四边外扩 1000px 的框 (GEO_CLIP_BOX=(-1000,-1000)-(1512,1384))
  - PerfectCircle(Blanket)Generator: 仅 P 型且恰好 3 控制点 => 三点外接圆 (barycentric 外心公式), 更多点直接排除
  - 吸附 RelevantLine/Circle/Point.NearestPoint: 线=垂足, 圆=径向投射到圆周, 点=自身; 点偏置 -3 (PointsBias=3, 点优先于线/圆); 阈值=OBJECT_SNAP_RADIUS 6.4 (同物件吸附)
- 与 mapping tools 的刻意差异 (按用户规格): 仅作用于选中滑条; 线/圆用红色虚线 (mapping tools 线默认绿); 线扩展到 "首/尾段恰 2 控制点" 的非 L 滑条 (红锚点重复对分段, 重复边界点只算分界不计入段内点数)
- 实现: src/osu/geometryHelpers.ts 纯函数 (circumCircle/sliderHelperCircle/sliderHelperLines/clipLineToBox/geoHelperSnap); store geoCenter/geoCircle/geoLines 默认 true + geoPanelOpen; EditorCanvas snapWithGeo (物件吸附与辅助吸附取更近者) 接 4 处: snapPlacement/放头/续点/节点拖拽 (自定义原点/网格中心锚点拖拽刻意不接); GeoSnapPanel 三行 toggle
- 验证: v84/tests.ts 纯函数 (外接圆/分段/裁剪/吸附优先级); v84/check.mjs 源码断言; v84/cdp-v84.mjs 端到端 (红虚线圆+青圆心像素/开关后消失/延伸线两侧像素/垂足吸附 (250,295)->(250,300)/圆心吸附 (152,139)->(150,137.5)/面板 3 开关生效)

## v85 按钮弹窗居中
- 需求: 所有功能按钮打开的小窗口显示在屏幕中央
- 排查: 按钮小窗全部走 DraggableDialog (F1-F4 转换/批量复制/多边形/TimingPoint/几何辅助共 7 个); 曲库/皮肤/向导等全屏遮罩本就 flex 居中, 无需改
- 实现: DraggableDialog 初始 pos 从固定 (120,100) 改为 null, useLayoutEffect 挂载后按实测宽高用 dialogCenterPos 纯函数居中一次 (负值钳 0), 测量前 left/top=-9999 藏屏外避免闪烁; 拖拽逻辑不变, 关闭重开重新居中 (不记忆拖动位置)
- 验证: v85/tests.ts (居中/钳 0/奇数取整); v85/check.mjs (接线断言 + 7 个弹窗覆盖面 + 4 个遮罩居中); v85/cdp-v85.mjs (面板中心=视口中心 ±2px/拖拽跟随不复位/重开复位居中)

## v86 Pattern 库 (参考 osu_mapping_tools PatternGallery, 规格与用户逐条确认)
- 功能: 选中物件收藏为 pattern (全局跨谱面, localStorage); pattern 库窗口 = 分类侧栏 + 缩略图网格 (120x90 黑底无网格, 复用 renderPlayfield 皮肤渲染, 逐物件 time=o.time+1 满 alpha); 缩略图拖到游玩区落盘, 拖到分类标签移动分类; 删除/双击重命名
- 时序按节拍数记录: beatTimeAt/msAtBeat (多红线分段, 首红线 beat=0, 互为逆); 收藏逐物件 beatOffset=beatTimeAt(obj)-beatTimeAt(首物件), 放置 time=msAtBeat(目标, startBeat+beatOffset) — 跨变 BPM 保节拍结构 (mapping tools ScaleToNewTiming 语义); 起点 = 当前编辑器时间吸附节拍
- 位置: 相对首物件偏移, 放置首物件跟随鼠标 (snapPlacement 物件/网格/几何吸附同源)
- 只存 hitObjects (位置/时间/曲线/hitsound/newCombo/hitSampleRaw 等), 不存红绿线; SV 只记等效值 px/beat (100*sliderMultiplier*绿线sv)
- 对齐选项 (互斥勾选, 默认都不勾=原样复制):
  1) 插入绿线对齐: 开头插绿线 sv=收藏pxPerBeat/(100*当前mult) (钳 0.1-10), 结尾 (startBeat+patternBeats) 插绿线还原该处原 sv; 同时间点绿线替换
  2) 缩放滑条对齐: scale=beatsLen*落点pxPerBeat/pixelLength, 控制点相对头缩放, 保占拍数
- 落盘: store.dropPattern 一次 undo, 选中新物件; 拖拽中幻影 WYSIWYG (含绿线预览, 走 mergedWithPreview); Esc 取消
- 落点判定: elementFromPoint — 分类标签=移动分类, 直接命中游玩区画布=落盘, 其他(面板/时间轴)=取消 (与幻影 cur.inside 一致)
- 修复: makePattern 滑条 endMs 浮点误差 (Math.round, 否则 beatsLen 差 1e-16)
- 验证: v86/tests.ts (节拍换算 round-trip/变 BPM/收藏/三种放置模式/sv 钳制); check.mjs 接线断言; cdp-v86.mjs (收藏/缩略图非黑/240BPM 下仍间隔一拍 250ms/绿线对齐+还原/互斥/分类拖拽移动/删分类回未分类/删除)

## v87 缩略图 90x90 + pattern 内部绿线
- 缩略图 120x90 => 90x90
- 问题: pattern 内含绿线的滑条时, 两种对齐模式都出错 — 插绿线对齐只按首物件 SV 插一条, 中间 SV 变化丢失; 缩放对齐的等效速度不含内部绿线, 含绿线滑条缩放倍率错误 (用户实例: 第二滑条 0.5x, 同谱面粘贴长度也错)
- 修复 (patternLibrary.ts):
  - StoredPattern 增 greenlines?: { beatOffset(拍), sv(倍率) }[] — makePattern 记录覆盖时间段 [首物件时间, startBeat+patternBeats] 内的绿线 (段外不记)
  - instantiatePattern: greenlineAlign | scaleAlign 两种模式都插入内部绿线 (sv 为相对倍率原样保留, 时间 = msAtBeat(startBeat+beatOffset)); greenlineAlign 的开头对齐线排在内部线之后, 同时间压过内部线
  - scaleAlign 的等效速度用 tpsEff (目标 timing + 内部绿线合并) 计算, 否则含绿线滑条 scale 翻倍
  - 都不勾仍原样复制 (不插内部线); 旧存档无 greenlines 字段按空处理
- 同步: v86 tests 源谱面绿线挪到 pattern 起点前 (起点上的绿线现在会被记为内部线); v86 check 绿线断言同步 mkGreen 重命名
- 验证: v87/tests.ts (记录范围/两种模式插入/缩放含内部线/240BPM/旧数据兜底); check.mjs 接线断言; cdp-v87.mjs (90x90/收藏记录/无绿线谱面拖出 3 条绿线 + 长度 140/70/缩放模式仅内部线且不翻倍)

## v88 辅助点/线显示范围 (面板两个互斥勾选项)
- 需求: 几何辅助面板加两个互斥勾选 — all = 当前显示(可见)的所有物件都显示辅助线/点; selection = 仅当前选中物件 + 上次选中其他物件时的辅助线/点 (默认 selection)
- 实现:
  - store: geoScope ('all'|'selection') + setGeoScope; prevGeoIds = 上次非空选择集, select/toggleSelect/clearSelection 变更选择前 rememberGeoSelection() 快照
  - geometryHelpers.ts 纯函数 geoHelperSources(scope, objects, selected, prevIds, visible): all => 可见滑条; selection => 选中 ∪ 上次选中 (上次选中不受可见性限制)
  - EditorCanvas geoSourceSliders 委托纯函数, 渲染块与 geoSnap 吸附共用同一来源 (渲染+吸附一致)
  - GeoSnapPanel 两个 checkbox: checked = geoScope === v, onChange setGeoScope(v) — 互斥且一个必开 (点已勾的不变)
- 语义确认 (CDP B 组): 清空选择后"上次选中"= 最近一次非空选择 (如最后是 L 则 L 辅助保留, P 消失)
- 验证: v88/tests.ts (all 可见滑条/选中 ∪ 上次/不可见保留/单点无辅助); check.mjs 接线断言; cdp-v88.mjs (选中切换与上次保留/清空后最近一次保留/all 无选择全显示 + 可吸附未选中物件辅助线/互斥勾选状态)

## v89 辅助显示范围加 none (与 all/selection 互斥)
- GeoSnapPanel 第三个互斥勾选项 "不显示任何辅助线/点"; geoHelperSources/store.geoScope/setGeoScope 类型扩为 'all'|'selection'|'none', none => 来源空 (渲染与吸附同时关闭, 因共用 geoSourceSliders)
- 排障: CDP 初判红像素谓词过松, 命中 (256,296) 暗黄标记 rgb(141,108,51) (r-g 仅 33); 谓词加 d[0]-d[1]>60 收紧
- 验证: v89/tests.ts (none=>空, all/selection 不受影响); check.mjs (类型扩展 + 面板三选项); cdp-v89.mjs (none 下辅助消失且不吸附/勾回 all 恢复/三选项恰一个勾选)

## v90 辅助线按钮改切换 + 新增「辅助线配置」按钮 (v89 撤销, 批次文件已删)
- 用户决定: 不要面板里的 none 勾选项; 显示/隐藏改由工具栏按钮直接切换
- 变更:
  - 撤销 v89: geoHelperSources/store.geoScope/setGeoScope 回到两范围 ('all'|'selection'), 面板删 none 勾选项, verifier/v89 删除
  - store 新增 geoEnabled = true + setGeoEnabled (总开关); EditorCanvas geoSourceSliders 开头 if (!store.geoEnabled) return [] — 渲染与吸附同时停 (同一来源)
  - App.tsx 工具栏: 「🧲 辅助」改名「🧲 辅助线」, 点击 = setGeoEnabled(!geoEnabled) (红色高亮 = 开); 旁新增「⚙ 辅助线配置」按钮 = 开面板 (沿用 data-geo-input="panel-toggle", 新增切换钮 data-geo-input="toggle")
- 验证: v90/tests.ts (两范围回归锚点); check.mjs (none 撤销 + 总开关 + 两按钮接线); cdp-v90.mjs (默认开有辅助/点按钮关 => 消失 + 不吸附/再点开恢复/配置按钮开面板恰两范围勾选项)

## v91 — 移动拖拽/自定义锚点吸附辅助线点
- 需求: 移动拖拽选中物件也要吸附辅助线/点 (v84 只接了放置/放头/续点/节点拖拽 4 处); 自定义锚点 (变换原点/网格中心/批量复制向量头) 拖拽也接辅助吸附。
- 实现: geometryHelpers.ts 新增纯函数 `geoDragCorrection(dragPts, dx, dy, snap, objCorrDist)` — 各拖拽点按当前位移试探取最近命中修正, `best.dist >= objCorrDist` 时不覆盖 (与物件修正取更近者), 修正位移 Math.round 取整。
- EditorCanvas.tsx: `geoSnap(bm, p, exclude?)` 加排除参数; 移动拖拽块在 snapDragDelta 物件修正后记录 corrDist, 再 `geoDragCorrection(dragPts, dx, dy, p => geoSnap(bm, p, store.selected), corrDist)` (排除被拖物件自身辅助防自锁); 网格中心拖拽 `setGridOrigin(snapWithGeo(bm, cp, snapToNearby(cp, targets)) ?? cp)` (物件+辅助取更近, 仍不做网格吸附防自锁); 变换原点 `setCustomOrigin(gridSnapAt(bm, snapWithGeo(...) ?? cp))`; 批量复制向量头先 snapWithGeo 再回写 dupVectorDragHandler。
- 验证: verifier/v91 (tests.ts geoDragCorrection 6 用例 + check.mjs 接线断言 + cdp-v91.mjs: 拖单点/变换原点标记/网格中心标记到 L 滑条延伸线附近均吸附到 y=300)。cdp C 组初稿拖到距线 7px 超阈值 6.4 未命中, 改布景为 5px 后通过 (测试边距问题, 非代码问题)。
- 回归适配: v68 check (dupVectorDragHandler 改 sp 实参 + 原点 snapWithGeo), v78 check (网格中心改 snapWithGeo), v84 check (snapWithGeo 计数 4→7)。

## v92 — pattern 收藏归入当前分类 + 快捷键提示修正
- 需求: pattern 库中点「收藏选中」应归入当前选中的分类 (原固定未分类); 主界面快捷键提示还是旧的「Ctrl+G 旋转90°」, 与实际键位 (Ctrl+G 反转) 不符。
- 实现: patternLibrary.ts `makePattern` 加第五参 `group: string = DEFAULT_GROUP`; store.ts `addPatternFromSelection(name, group?)` 透传; PatternPanel.tsx 收藏按钮传当前侧栏选中分类 `group`。
- App.tsx 快捷键提示: 「Ctrl+G 旋转90° (Shift 逆时针)」改为「Ctrl+G 反转选区 (时间镜像+路径反向)」+「Ctrl+,/. 旋转90° (逆/顺时针)」两行 (Inspector.tsx 的提示此前已正确)。
- 验证: verifier/v92 (tests.ts makePattern group 缺省/传参 + check.mjs 接线断言 + cdp-v92.mjs: 切到 G1 收藏归 G1 / 未分类收藏归未分类 / 提示文本断言)。回归 check 全绿, v86 CDP 抽跑通过。

## v93 — pattern 缩略图滑条串形修复 (缓存 id 冲突)
- 症状: 收藏一个滑条后, 后续收藏的滑条缩略图都渲染成第一个滑条的形状(带偏移)。
- 根因: sliderPath.ts `pathCache` 与 renderer.ts `bodyCache` 都按 `o.id` 缓存且 key 不含几何; patternThumb.ts 合成物件 id 用 `i+1`, 每个 pattern 的首物件都是 id=1, 互相撞缓存 (也撞真实物件 id), 第二个滑条直接复用第一个的路径+滑条身位图 (sprite 带绝对 osu 坐标 => 偏移)。
- 修复: patternThumb.ts 新增 `thumbBaseId(patternId)` — 按 pattern.id 哈希派生负 id 段起点 (段内 4096 槽, 真实物件 id 为正不冲突), 合成物件 `id: base - i`; 同 pattern 重绘 id 稳定 => 缓存命中正确。
- 验证: verifier/v93 (tests.ts thumbBaseId 稳定/负段/段不重叠 + check.mjs 接线断言 + cdp-v93.mjs: 横向滑条与纵向滑条各收藏, 缩略图粉色墨迹包围盒分别 宽>>高 / 高>>宽; 谓词 r>120&&g<160&&b>80&&r-g>30 排除黄跟随圈/青头圆/白边框的干扰)。回归 check 全绿, v86 CDP 抽跑通过。

## v94 — exe 启动恢复上次谱面
- 需求: exe 每次进入默认打开上次打开的谱面 (若存在), 而不是演示谱面。
- 实现: main.cjs 加 `get-recents` IPC (readSettings().recents ?? []); preload.cjs 暴露 `getRecents`; electronBridge.ts 加 `ElectronRecentEntry` 类型与 `getRecents()`; App.tsx 初始加载 effect 改异步 — Electron 下先取 recents[0] 经 `openServerDifficulty` 加载, 成功则 `setShowLibrary(false)` 直进编辑器; 无记录/目录已删等任何失败回退原演示谱面逻辑 (等待期间用户已从曲库加载则不覆盖)。
- 验证: verifier/v94 (check.mjs 接线断言, 无新纯函数 — pushRecent 已在 v77 覆盖; cdp-v94.mjs 用 Page.addScriptToEvaluateOnNewDocument 注入 mock window.osuEditor + 页面层 mock /api/local-fs/* 内存虚拟歌曲目录, 不依赖 dev server 真实曲库配置: A) recents[0] 存在 => 自动恢复该谱面且曲库界面不出现; B) recents 空 => 演示谱面 + 曲库界面显示)。踩坑: 虚拟目录里 .mp3 的 file 端点若 404, findFileInDir 大小写兜底分支的 getFile() 无 try/catch 会让 loadDifficulty 整体失败 → mock 需对音频返回 200。
- 注意: 未重新打包 exe (release 目录仍是旧版), 需要时跑 electron-builder。

## v95 — 新建滑条尾端吸附节拍 (lazer FindSnappedDistance)
- 需求: 新建滑条创建结束后尾端应吸附到节拍 (此前落盘 length = 几何全长, 尾端时间任意)。
- lazer 语义 (SliderPlacementBlueprint.updateSlider -> ComposerDistanceSnapProvider.FindSnappedDistance): 放置时 ExpectedDistance 恒过节拍吸附 — tick = vel * beatLength/BeatDivisor px, tick 数就近取整 (SnapTime round-to-nearest), 但绝不超几何全长 (超出 1ms 容差则退一个 tick); 与距离网格/锁定间距开关无关。
- 实现: sliderPath.ts `placementLength` 加第 7 参 `beatSnap`, 非锁定间距分支从 `Math.round(几何长)` 改为 `snapSliderLength(..., beatSnap)` (该函数是既有 lazer 移植, 节点编辑/合并/选框缩放已在用); 锁定间距分支不变 (整拍必在 tick 格上); 下限从 20px 变为 max(20px, 1 tick)。pendingSliderTimeline 透传 beatSnap => 时间轴预览=落盘同源不变。EditorCanvas finishSlider/finishFreehandSlider 两调用点传 `store.beatSnap`。
- 验证: verifier/v95 (tests 12 用例: snap 4/2/1 的就近取整+不超几何+1ms 容差边界 87/88px, 下限, 锁定分支不变 + check 接线断言 + cdp: 几何 160px => 落盘 4 tick=140 且尾端 1500 恰在 tick 上, 预览区间=落盘区间; 几何 110px => 3 tick=105)。
- 回归适配: v83 tests (placementLength 7 参, 0 -> 1 tick 25), v82 tests (仅头部预览下限 20px -> 25px => end 2125)。check 全绿, v83 CDP 抽跑通过。

## v96 — 辅助线默认关+记忆 / 节点拖拽排除自身辅助
- 需求1: 辅助线默认关闭, 且记住上次开关。实现: store.ts `LS_GEO_ENABLED = osu-editor:geo-enabled` + `loadGeoEnabled()` (缺省 false), `geoEnabled = loadGeoEnabled()`, `setGeoEnabled` 写 localStorage。
- 需求2: 拖直线滑条节点不吸自身延伸线 / 拖三点圆弧滑条节点不吸自身三点圆 (这些辅助由被拖点决定, 点必在线上, 只能辅助线跟点动)。实现: EditorCanvas `snapWithGeo` 加第 4 参 `exclude?: ReadonlySet<number>` 透传 `geoSnap`; 节点拖拽传 `new Set([nd.objId])`。移动拖拽此前已排除 store.selected, 不受影响。
- 验证: verifier/v96 (check 接线断言, 无新纯函数 — 持久化 helper 由 CDP 覆盖; cdp: 全新 profile 默认关 -> 切换开 -> reload 仍开; 拖 L 滑条尾节点到延伸线 5px 处不落 y=300; 拖三点圆中间节点到圆 5px 处不落回圆上)。
- 回归适配: v90 check/cdp (默认开断言 -> 默认关+记忆, 布景的 setGeoEnabled(true) 移除改为测默认关, 段落顺序调整为 关->开->关), v84 cdp 布景显式 setGeoEnabled(true)。check 全绿, v90/v84/v91 CDP 抽跑通过。

## v97 — 网格按钮文案: 网格 -> 网格吸附
- App.tsx 工具栏网格开关按钮文本 `⊞ 网格` 改 `⊞ 网格吸附` (与 title 提示一致)。纯文案, 无逻辑改动; verifier/v97 check 断言文案。回归 check 全绿。

## v98 — 时间轴折返标记改皮肤 reversearrow
- 需求: 上方时间轴折返滑条的折返标记用皮肤中的折返图片, 而不是一个白点。
- 实现: Timelines.tsx drawTimelineObject 折返段 — 删除 `rgba(255,255,255,0.85)` 的 3.5px 圆点, 改 `getSkin().reversearrow` drawImage (尺寸 rad*1.3); 方向: 奇数 repeat 节点在尾端 -> rotate π 朝左, 偶数节点在头端 -> 原向朝右 (与游玩区 renderer.ts:421 折返箭头同图同语义); 真实物件与放置预览幻影共用入口不变。
- 验证: verifier/v98 (check 接线断言: 皮肤贴图引入/旧圆点删除/方向 rotate; cdp-v98.mjs: slides=3 滑条布景, repeat 节点 36px 窗白像素 100 ≫ 旧圆点 38, 方向判别 = 箭头头部三角纵向跨度大于杆部 — s=1 左跨 10>右跨 5 朝左, s=2 右跨 10>左跨 5 朝右; 截图 v98-repeat-arrow.png 人工复核 ←/→ 正确)。踩坑: 质心偏移探针对真实皮肤箭头图 (杆+头质量近似对称) 无区分度, 换纵向跨度判别立即可靠。
- 回归: tsc + 全部 check 全绿, v53/v61 (时间轴 CDP) 抽跑通过。

## v99 — 1000 节点滑条渲染性能 (<10ms)
- 需求: 测试滑条渲染性能, 期望渲染 1000 个节点的滑条耗时 <10ms。
- 根因: 旧 bezierPath 每采样点 O(k²) de Casteljau 密集求值 (采样数 max(10,12k)), 1000 控制点单段 = 12000 采样 × ~500k 次内循环 ≈ 6e9 次运算, 冷路径卡数十秒 (稳态帧靠 pathCache/bodyCache 不受影响)。
- 优化 (sliderPath.ts `flattenBezier` 混合策略):
  - **<=24 点段**: 自适应剖分 (de Casteljau 中点剖分递归, 弦高 <=0.25px 输出弦, 深度兜底 24) — 输出比均匀采样稀疏且更准;
  - **>24 点段**: 截断 Bernstein 求值 (bernsteinAt) — 权重 b_i(t)=C(n,i)t^i(1-t)^(n-i) 集中在众数 round(n·t) 附近 (σ=√(n·t(1-t))), 从众数用相邻权重比向两侧递推, 相对权重 <1e-9 截断, 每点 O(窗口~6σ) 取代 O(n²); 采样密度保持旧版 12/控制点 (>0.5px 去抖);
  - **不可行的方案备查**: de Casteljau 剖分不降阶 (左右各仍 n 点), 大段递归每层 2^d·n² 指数爆炸 (初版实测 1000 点 sine 1469ms); lazer PathApproximator 在 osu.Framework (NuGet), 对大单段贝塞尔同样有此问题。
- 探针: EditorCanvas 每帧 renderPlayfield 耗时环形缓冲 `window.__perfRender` (900 帧); `window.__invalidatePath(id)` 失效路径+body 缓存 => 下一帧即冷帧。
- 实测 (verifier/v99): 纯函数 zigzag/sine 1000 点 6.0/3.8ms, SliderPath 全链路 3.4ms, 形状 vs 512 点密集 de Casteljau 偏差 <=0.3px; CDP 1000 节点 zigzag B 滑条: 稳态帧 p95=0.30ms (缓存命中), 冷帧 (路径剖分+重采样+离屏 body 描边全重算) 4.30ms, 均 <10ms。
- 踩坑: ① 高阶贝塞尔对折线控制多边形有强阻尼 (zigzag B 曲线塌向中线, 非硬角 — 硬角需红锚点分段); ② v9/v67 tests.ts 含顶层 await 需 --format=esm 且 v9 需在自身目录运行 (相对路径解析), 与本改动无关的既有约定。
- 回归: tsc + 全部 check + 全部 tests.ts 全绿, v38/v39/v73/v74 CDP 抽跑。

## v100 — 滑条头尾贴图回退对齐 lazer (皮肤 hitcircle 全透明场景)
- 用户报告: 滑条头是实心染色圆, 与 note 渲染不一致 — 其皮肤把 hitcircle 做成全透明 (note 合并到数字显示)。
- 根因: skin.ts 回退链 — sliderstartcircle 缺失时保留程序化实心白盘 (makeProceduralBase 初始值), 着色后 = 实心染色圆; note 用加载的全透明 hitcircle 故只显示环+数字。
- lazer 语义 (LegacyMainCirclePiece.load :64-103): 前缀贴图 (sliderstart/endcircle) 缺失 => 整组回退 hitcircle + hitcircleoverlay; 前缀 circle 存在但对应 overlay 缺失 => 无 overlay (不回退 hitcircleoverlay)。附加: lazer 有 FindProvider 层级 (beatmap 提供 hitcircle 时不用用户皮肤的 sliderstartcircle), 本项目单皮肤模型不适用。
- 实现: skin.ts `resolveSliderCircleFallback(skin, has, empty?)` — 缺失 circle 整组回退, 缺失 overlay 给 1x1 透明占位 (emptyImage); `applySkinFromDir` 与 `loadDefaultFilesInto` 加载完成后以 loadedKeys (实际提供的贴图) 各调一次。渲染层零改动 (note 与滑条头本就是 tinted+overlay+number 同构, 差别只在贴图槽位)。
- 验证: verifier/v100 (tests.ts 三场景桩贴图断言 + check 接线断言 + cdp: 页内 mock FsDirLike 只给 全透明 hitcircle + 白环 overlay, 滑条头/单点中心均暗 (7 vs 22, 差 15) 且白环同亮 (255/255); 截图 v100-slider-head.png 人工复核 滑条头 = 白环+数字与 note 一致)。踩坑: t=滑条头时刻滑条球正压头上, 探针打到球像素 (255) — seek 到中段再探; 单点 preempt 内淡入未完结时环读数偏暗, seek 对齐物件时间。
- 回归: tsc + 全部 check 全绿, v13/v93/v98 (皮肤相关) CDP 抽跑。默认 public/skin 四张头尾贴图齐全, 回退解析对其为 no-op, 默认观感不变。

## v101 — hitsound 总线余量 + 同采样并发上限 (密集 1/4 刺耳修复, 方案 A)
- 用户报告: 摆满 1/4 的段落音效明显比 lazer 吵 (谱面: 1357624 sabi - true DJ MAG top ranker's song Zenpen (katagiri Remix))。
- 诊断: ① 该图最密 1/4 段 (~88ms 间隔) 物件 hitSample 多为 1:0:0:0: -> hitnormal 走默认回退, 我们回退 stable 经典 normal-hitnormal (1.245s 长尾巴, 峰值 0.976), lazer 回退其自带采样 (更短更轻), 素材本身不同; ② 引擎侧无并发上限无总线余量, 88ms 间隔 vs 1.245s 尾巴 => 同采样叠 ~14 层, 与音乐混音后总线持续超满幅, Web Audio 输出硬削波 = 刺耳 (本批修复); ③ lazer 默认回退采样对齐属方案 B (未做)。
- lazer 语义: OsuGameBase.cs:93 `SAMPLE_CONCURRENCY = 6`, :301 `Audio.Samples.PlaybackConcurrency = 6` — 同一采样最多 6 个并发 voice, 超限偷最老 (BASS 采样语义); 单音音量公式 max(vol,5)/100 两边本已一致。
- 实现:
  - 新 `src/osu/clock/voiceLimiter.ts`: `SAMPLE_CONCURRENCY = 6` + `VoiceLimiter<K,V>` (按 buffer FIFO, register 逐出最老 / release 注销 / totalCount); erasableSyntaxOnly 禁参数属性, 用显式字段。
  - store.ts: `HITSOUND_BUS_GAIN = 0.8`; `ensureHitBus()` 建 hitsound 总线 GainNode(0.8) -> destination; `trackVoice(buf, src)` 登记并发 (超限 stop 最老, addEventListener('ended') 注销, 与循环音 onended 互不干扰); 两处出声点 (一次性 hitsound sink + sliderslide 循环) 均改 `gain.connect(this.ensureHitBus())` + `trackVoice`, store 内仅剩总线一处直连 destination; `debugVoiceStats {active, maxSeen}` 调试钩子。
- 验证: verifier/v101 (tests.ts 19 项: 上限/FIFO 逐出顺序/release 腾名额/无效 release/key 独立/clear/回收; check.mjs 接线断言; cdp-v101.mjs: 页内直驱 sink 连排 20 个 normal-hitnormal @20ms — 并发峰值恰 6 (无上限时 20), 轮询不超, 播完全部注销, 总线增益 0.8)。踩坑: GainNode.gain 是 float32, 断言需 ε=1e-6。
- 回归: tsc + 全部 check 全绿, v17 (排程延迟) / v24 (hitsound) CDP 抽跑通过。

## v102 — 上方时间轴增强: 全高度框选/边缘滚动累积/绿线选中拖拽/复制粘贴
- 需求: ① 下半部分(tick 行)也能起手框选; ② 框选拖到左右边缘自动滚动当前时间并跨滚动累积选中; ③ 框选命中绿线 SV 胶囊 -> 与选中物件同款黄描边 + 支持复制粘贴; ④ 单击绿线胶囊选中, 按住拖动改时间 (吸附节拍), 双击保持编辑。
- lazer 语义对齐:
  - **TimelineDragBox.cs**: 框选锚定"时间"而非屏幕 x — startTime = TimeAtPosition(mousedownX), 每条边 Box.X = PositionAtTime(t) 每帧重算, 滚动时锚边钉在时间上 => 跨滚动累积选中;
  - **TimelineBlueprintContainer.handleScrollViaDrag**: 边缘容差 40px, 基础速度 sign*min(10, overshootPx²) (overshoot clamp 40, ≥√10≈3.2px 即满速), ramp = min(1, 按住ms/5000) 且速度归 0 时清零重计;
  - **ReceivePositionalInputAt 越界**: 拖出 canvas 后 window mousemove 兜底继续跟踪。
- 实现:
  - 新 `src/osu/timelineSelect.ts` (纯函数): edgeScrollVelocity/edgeScrollRamp (ramp 独立 — 合进速度会 ramp=0 死锁, CDP 抓到), marqueeObjectIds (时长相交, v45 语义), marqueeGreenTimes, bandHit + 药丸纵带常量;
  - Timelines.tsx: marqueeRef 改 {tAnchor, px0, y0, x1, y1, base, baseGreens, scrollAccum, selKey}; 框选矩形与选区更新移入帧循环 (滚动帧指针不动也累积); mousedown 顺序 = 尾端 -> 物件 -> 绿线药丸 (选中+拖拽预备) -> 红线药丸 (单击惰性) -> 全高度框选; greenDragRef 拖绿线 (snapMs 吸附, beginDrag/commitDrag 一次 undo); drawPill 加 sel 参数画 #ffcc22 描边; 悬停绿线药丸 ew-resize;
  - store.ts: `selectedGreenLines` (time 键), selectGreenLines/selectWithGreens (非加选 select/clearSelection 连带清空绿线 — 单一选择模型), clipboardGreens 与物件共用时间原点 copy/paste, 同时刻粘贴覆盖不叠加, 粘贴后新绿线选中。
- 验证: verifier/v102 (tests.ts 21 项 — lazer 常量/速度曲线/端点相交; check.mjs 23 项; cdp-v102.mjs T1-T6: 下半起手框选/框选两绿线且不碰物件/单击选中不改时间/拖动吸附 1/4 => 2250/paste(6000) 参数保留+同时刻覆盖不叠加/边缘滚动 10000->21454 累积选中 13000+14000)。
- 回归适配: v45/v63/v79 check 旧源码断言按新语义改写 (marqueeRef 结构/hitTestTimingPill 返回 {idx,tp}/下半单击=未拖动框选落空仅清空; v79 的 seekFromEvent 断言限定顶部组件 — 下方时间轴同名函数误伤)。
- 回归: tsc + 全部 check 全绿, v31/v32/v35/v61/v63 (时间轴相关) CDP 抽跑通过。

## v103 — 波形/频谱悬浮窗 (Waveform/Spectrogram Panel, Audition 风)
- 需求: 上方时间轴正上方独立窗口 — 宽度恒与时间轴对齐 (X 不可动), 可 Y 轴拖动, 顶边拉伸高度 (默认 92px=时间轴高), 可折叠 (折叠=右侧 fixed 悬浮小窗, 两轴可拖, 不遮下方 UI); 波形图/频谱图可切换, 显示参考 Adobe Audition。
- 实现:
  - 新 `src/osu/fft.ts` (纯函数): 原位 radix-2 迭代 FFT (位反转+蝶形, 2 幂校验) / hannWindow / frameMagnitudes。
  - 新 `src/osu/waveformData.ts` (纯函数为主): AudioBufferLike 接口 (node 可测); computePeaks 1ms 分桶全声道 min/max; STFT 2048/512 Hann → dB 80dB 归一 → 256 对数 bin (30Hz–16kHz, logBinForFreq/freqForLogBin 互反); getSpectrogram 分块异步 (200 帧让出主线程) + ensureSpectrogram 同步取渐进数据; WeakMap 缓存随 buffer 回收; spectroColor Audition 风色带 (黑→深蓝→紫→红→橙→黄→白); pixelShift 滚动移位纯函数。
  - 新 `src/components/WaveformPanel.tsx`: 展开态 absolute left-0 right-0 bottom-full 锚在时间轴 flex-1 容器 (App.tsx 加 relative) — 宽度恒对齐; translateY(-offsetY) 只动 Y; 顶边 ns-resize 句柄拉高 (clamp 48..400); 折叠态 fixed z-40 小窗 (150x24) 两轴拖动, 默认右侧; rAF 帧循环只在展开态跑; 视口公式与 TopTimeline 逐像素一致 (win=6000/zoom, 中心 store.currentTime); 波形 = 对称绿渐变 (核心 #7fe07f/端部 #1e6e2e) + 中线 + 播放头; 频谱 = 离屏缓存滚动填充 (整像素 drawImage 平移 + 只补露出列, 亚像素 frac 累计; 尺寸/缩放/framesDone 变化全量重绘), 低频在下; 解码降级显示"音频不可用"。
  - store.ts: `getAudioBuffer()` 公开 getter; `wavePanelOpen`/`setWavePanelOpen` + localStorage `osu-editor:wavepanel-open` (默认关); 面板几何/模式存 `osu-editor:wavepanel:state`。
  - App.tsx: 工具栏「📈 波形」切换按钮 (data-wave-input=toggle)。
- 坑: ① 合成 PointerEvent 无活动指针, setPointerCapture 抛 NotFoundError — 全部 try/catch; ② CDP 测试同任务内派发 pointermove 后立即读 rect 拿到旧值 (React 批量更新未落 DOM) — 事件与断言拆两步 + sleep; ③ putImageData 未算到区域必须先填不透明黑 (alpha=0 会透出页面底色)。
- 验证: verifier/v103 (tests.ts 10 组 — FFT 峰值 bin/冲激平坦/hann 端点/peaks 分桶/双声道极值/mixdown/对数 bin 往返/dB 归一/色带单调/pixelShift/chirp 整曲频谱峰值位置; check.mjs 含 esbuild bundle 跑 tests + 50 项接线断言; cdp-v103.mjs T1-T7: 页内合成 1s 440Hz WAV 布景 → 对齐/绿波形像素/频谱非黑/Y 拖 X 不动/拉高 92→112/折叠小窗/小窗两轴拖+展开恢复)。
- 回归: tsc + 全部 check 全绿, v102 (时间轴) CDP 抽跑通过。

## v104 — 波形窗修复: 面板钳制/双向拖动 + 20ms 对齐补偿
- 问题: ① 波形/频谱相对时间轴右偏 ~20ms; ② 面板向上拖过工具栏后标题条被推出视口顶, 卡在遮挡工具栏的位置, 无法拖回也无法点 ✕ ("无法拖动/无法隐藏"); ③ 默认位(时间轴正上方)盖住页签/工具栏, 且只能上拖不能下移。
- 修复 (WaveformPanel.tsx):
  - `WAVE_VISUAL_OFFSET_MS = 20` (lazer Editor.WAVEFORM_VISUAL_OFFSET=20ms, 补偿解码/编码延迟): 波形/频谱采样取 t+20 → 内容左移 20ms 对齐时间轴。
  - `clampOffset`: 顶边 clamp [0, innerHeight-80], 以"自然顶边 baseTop=rect.top+offsetY"换算 — 允许负 offsetY (面板可下移到游玩区上方), 且顶边永不出视口 (标题条/✕ 始终可达)。
  - useLayoutEffect: 拉高/重挂载后 rect.top<0 自动 offsetY+top 下移回屏。
- 坑: 旧钳制 `maxOff=innerHeight-300` 与面板实际位置无关, offsetY 过大即把面板顶(含标题条/✕)推出视口 — 用户卡住症状的根源; CDP 合成事件测不出来, 需按几何推理 + 受信 Input.dispatchMouseEvent 验证。
- 验证: verifier/v104 (check.mjs 10 项接线断言; cdp-v104.mjs T1-T5: 500ms 冲激峰值列=x(480)±2px 证明补偿生效 (无补偿在 x(500)+4px 外)/上猛拖钳 top=0/下拖 200 跟随/拉高 200 后 top>=0/✕ 关闭卸载)。
- 回归: tsc + 全部 check 全绿, v103 CDP 抽跑通过。

## v105 — 波形窗: 右侧竖标题条 + 右上角模式按钮 + 半透明背景
- 需求: ① 标题条从顶部横条改为右侧竖条; ② 波形图/频谱图切换按钮像时间轴 +红/+绿 一样浮在波形右上角; ③ 波形/频谱背景半透明。
- 实现 (WaveformPanel.tsx):
  - 布局: 标题条 = `absolute right-0 top-0 bottom-0 w-[18px]` 半透明竖浮条 (竖排"波形" + 折叠 + ✕, 保留 data-wave=header 兼容历史 CDP), Y 拖动逻辑不变; 模式按钮 = `absolute right-6 top-[9px]` 浮层 (同 TopTimeline `absolute right-1 top-1` 的 +红/+绿 风格); 画布保持 w-full 全宽 → 时间刻度仍逐像素对齐; HEADER_H 常量移除。
  - 半透明: WAVE_BG 改 rgba(20,20,20,0.55); 频谱底 alpha=140, 数据像素 alpha 随强度 140→255 (SPECTRO_BG_ALPHA)。
  - **半透明 × 滚动缓存的合成坑**: ① 波形/频谱主画布每帧必须先 clearRect, 否则 source-over 逐帧累积变不透明+残影; ② 离屏同画布 drawImage 平移必须 `globalCompositeOperation='copy'`, 否则半透明源与自身重叠区二次叠加变深。
- 验证: verifier/v105 (check.mjs 15 项; cdp-v105.mjs T1-T6: 全宽对齐/竖条贴右缘宽 18 且拖 Y 跟随/模式按钮右上角浮层/波形 bg alpha=140 柱 255/频谱静音 140 强信号 >200/✕ 关闭)。注意: 频谱最强信号 t≈0.9 → alpha≈244, 断言不能卡 255 (alpha 随强度是设计)。
- 回归: tsc + 全部 check 全绿, v104 CDP 抽跑通过。

## v106 — 频谱逐列自适应 (去方格) + 波形/频谱偏移根因修复 (+20ms 归 0)
- 起因两问: ① 频谱能否 1ms 一帧去方格? ② +20ms 视觉补偿应查根因, 不该用魔数。
- **根因实测** (证据脚本 `verifier/v106/dbg-chrome-trim.mjs`, 实测文件 = 用户报告谱面 audio.mp3):
  - LAME3.100, LAME tag: encDelay=576/padding=984 (标准 576+529=1105 采样延迟); ffprobe start_time=0.025057。
  - **Chrome decodeAudioData 与 ffmpeg 一致地裁剪了编码延迟**: 同一文件首瞬态 Chrome=1414.13ms vs ffmpeg(untrimmed)=1414.15ms, 长度同为 386.106s → 我们解码管线无 bug, `WAVE_VISUAL_OFFSET_MS=20` (v104 引入) 在物理上是错的, **波形/频谱采样偏移归 0**; lazer 的 −20ms (Editor.WAVEFORM_VISUAL_OFFSET) 是其自身显示约定, 不是可移植的物理补偿。
  - **频谱右偏真凶 = FFT 窗口前缘效应**: 旧整曲路径帧取 [t, t+46ms] 窗口, 能量却画在帧起点 t → 系统性右偏半窗 ≈ +23ms (@44.1kHz, 2048 帧)。窗口改为以列中心为中心即修复。
  - 谱面瞬态 vs 节拍网格残差 δ≈+26ms 且随时间漂移 (12s 内 +26→+51) → 残差是 mapper 计时/编码版本差异, 任何常数都无法"正确"对齐 (佐证不该用常数补偿)。
- 实现:
  - waveformData.ts: 整曲路径 (SpectroData/computeSpectrogram/getSpectrogram/ensureSpectrogram/SPECTRO_HOP/渐进 framesDone) **全删**; 新 `spectroColumnAt(mono, sr, centerMs, out)` — 2048 Hann 窗**以 centerMs 为中心**取帧 (边缘零填充, 模块级 scratch 零分配) → FFT → 对数 bin; 新 `getSpectroColumn(buf, centerMs)` — WeakMap<buffer,{mono,sr,cols,lru}> 列缓存, key=round(ms), LRU cap `SPECTRO_LRU_CAP=10000` (~10MB)。
  - WaveformPanel.tsx: WAVE_VISUAL_OFFSET_MS 删除 (drawWave/drawSpectro 采样归 0); renderSpectroStrip 改逐列 — 每像素列取 `t0+((x+0.5)/W)*win` (像素中心, 无任何补偿) → getSpectroColumn; 有效分辨率恒 = msPerPixel, **任何缩放级别无方格**, 且比"1ms 整曲预计算"省 ~400MB 内存; 离屏滚动缓存 (v105 'copy' 平移) 不变, 滚动只补新露出列 (LRU 复用); 歌曲范围外列留半透明黑底。
  - 代价: 开面板/缩放突变时整窗 ~1200 列 FFT ≈ 60-90ms 一次性卡顿 (方案已接受)。
- 验证: verifier/v106 (tests.ts 5 组 — chirp 逐列峰值 bin/窗口居中 (500ms 冲激: col500=0.236 强, col480=col520=0.000 对称弱; 前缘窗口 col480 会强, 可区分)/边缘零填充/同 key 同引用/LRU 逐出; check.mjs 18 项; cdp-v106.mjs T1-T3: 波形冲激 x(500)±2px 偏移归 0/噪声信号区最长同值列连跑=1 <4 无方格/频谱冲激亮列 x(500)±2px)。
- 回归适配: v103 tests.ts T9 与 check.mjs (整曲 API 断言 → 逐列 API); v104 check.mjs/cdp T1 期望从 x(480) 改回 x(500) (补偿移除)。
- 回归: tsc + v1-v106 全部 check 全绿, v103/v104/v105 CDP 抽跑通过。

## v107 — 波形窗点击穿透 (画布/空白直达下层, 仅控件可点)
- 需求: 展开态波形/频谱窗挡住下层游玩区, 期望没点中右侧标题条/按钮时点击穿透到后面的控件。
- 实现 (WaveformPanel.tsx, 纯 CSS 方案 — 画布本身无任何指针交互逻辑): 面板容器 `pointer-events-none` (画布/空白处继承 → 点击/框选/拖动直达下层), 三个控件单独 `pointer-events-auto`: ① 顶边拉伸句柄 ② 波形图/频谱图模式按钮浮层 ③ 右侧竖标题条 (Y 拖动/折叠/关闭)。折叠小窗不受影响 (依然整体可拖)。
- 验证: verifier/v107 (check.mjs 8 项 — 容器 none/控件 3 处 auto/小窗不加 none; cdp-v107.mjs T1-T5: 画布中心 elementFromPoint 命中面板外/标题条仍命中/模式按钮命中且点击切频谱生效/拉伸句柄命中/画布处 Input.dispatchMouseEvent 受信点击目标在面板外)。
- 坑: T5 最初用 `document.dispatchEvent` 合成事件, target 恒为 document 测不出 hit-test → 改受信 `Input.dispatchMouseEvent`; check 统计 `pointer-events-auto` 个数时被注释里的同名文本干扰 → 只数 class 用法 `pointer-events-auto"`。
- 回归: tsc + v1-v107 全部 check 全绿, v105/v106 (波形窗相关) CDP 抽跑通过。

## v108 — 工具栏「曲库→重做」移入左侧栏 + 波形面板默认位适配
- 需求: 曲库/皮肤所在一栏中从「曲库」到「重做」的全部控件移入新增左侧栏; 控件略放大, 功能组间用线隔开。
- 实现 (App.tsx):
  - 顶部工具栏只留标题 + 右上角谱面信息/保存反馈 (不再含任何按钮);
  - 新主体结构 `flex-1 flex min-h-0` = 左侧栏 (`w-44 shrink-0`, 纵向滚动) + 右侧内容列 (页签栏 → 上时间轴+选区信息 → 主区域 → 下时间轴, 下方时间轴后闭合);
  - 左侧栏分组 (组间 `h-px bg-white/15` 分隔线 7 条): 文件 (曲库/皮肤) / 四工具 (2×2 网格) / 节拍吸附 / 锁定间距 (+倍率滑条数字) / 网格 (开关/类型/间距/旋转/中心+x/y) / 辅助线 (+配置) / pattern+波形 / 历史 (撤销/重做并排); 控件全宽 `px-3 py-1.5 text-sm` 略放大; 全部 data 属性原样保留 (历史 check/CDP 零适配)。
- **连带产品修复 (CDP 抓出)**: 工具栏缩为单行后, 时间轴上方只剩 ~82px, 放不下 97px 波形面板 — 默认位被 v104 钳制压到 top=0 遮住页签 (v103 CDP T1"面板在时间轴上方"/T4"上移 30"双双失败暴露)。WaveformPanel 默认 `offsetY = DEFAULT_OFFSET_Y = -200` → 面板默认停在时间轴下方游玩区顶部 (不遮页签/时间轴, 配合 v107 点击穿透), 用户可拖回上方 (持久化不变)。
- 回归适配: v103 cdp T1 改断言"默认停在时间轴下方且在屏内"; v86 cdp 落点位置断言放宽 ±1px (左栏使游玩区 1216→1040px, client→osu 取整量化差, 相对偏移 64 仍精确)。
- 验证: verifier/v108 (check.mjs 24 项 — 布局骨架/工具栏无按钮/侧栏控件齐全/分隔线≥7/略放大/波形默认位; cdp-v108.mjs T1-T5: 侧栏贴左缘宽 176/工具栏 0 按钮/分隔线 7/点滑条工具+网格吸附生效/侧栏右缘即右侧内容)。
- 回归: tsc + v1-v108 全部 check 全绿; v86/v103/v104/v105/v106/v107 CDP 抽跑通过。

## v109 — 左侧栏层级/宽度对齐右栏 + 「网格中心」文案
- 需求: ① 左侧栏层级改为位于上时间轴下方、下时间轴上方 (v108 是通高栏, 把上下时间轴挤窄了); ② 宽度与右侧 Inspector 栏一致; ③ 「◎ 中心」按钮文案改「网格中心」。
- 实现 (App.tsx): 页签栏/上时间轴移回根部 (恢复全宽); 主区域行 `flex-1 flex min-h-0` = 左侧栏 (`w-44`→`w-56`, 与右栏同宽) + 内容 (edit: 游玩区+右 Inspector 内嵌行; setup/timing 包 `flex-1 min-w-0 overflow-auto flex flex-col` 容器, 侧栏三个页签都显示) ; 下时间轴在主区域行之后。按钮文案 `◎ 中心` → `◎ 网格中心`。
- 验证: verifier/v109 (check.mjs 10 项 — 层级顺序/w-56 左右同宽/旧 w-44 移除/setup/timing 包裹/新旧文案; cdp-v109.mjs T1-T5: 侧栏顶=上时间轴底 175≈174/侧栏底=下时间轴顶 727/左右栏同宽 224 且右栏贴右缘/上时间轴恢复全宽左缘=0/网格中心文案+timing 页签下侧栏仍在上时间轴下方)。
- 回归适配: v108 check (结构段重写 — 页签栏夹在工具栏与侧栏之间, toolbar 切片到页签栏为止; w-44→w-56; 层级断言) 与 cdp (div.w-44→div.w-56, 宽度区间 200..260)。
- 坑: cdp-v109 T5b 误用 `typeof r5 === 'string'` 判空 — evalJs 恒返回字符串 ('missing' 或 JSON), 应只特判 'missing'。
- 回归: tsc + v1-v109 全部 check 全绿; v45/v56/v78/v84/v86/v103/v104/v107 CDP 抽跑通过。

## v110 — 工具栏加高 h-12: 波形面板最上方齐贴时间轴
- 需求: 加高「osu! 谱面编辑器」工具栏行, 使波形图拖到最上方 (offsetY=0) 时正好贴在上方时间轴之上且不重合。
- 几何: 工具栏 33 + 页签栏/边框 49 = 时间轴顶 82 < 面板高 97 (92 画布 + 5 拉伸句柄) → 差 15px。工具栏 `py-1.5` 改 `h-12` (48px) → 时间轴顶 = 48+49 = 97 = 面板高, offsetY=0 时面板 [0,97] 正好齐贴时间轴顶。
- 实现: App.tsx 工具栏加 h-12 (附几何注释)。
- 验证: verifier/v110 (check.mjs 5 项; cdp-v110.mjs T1-T3: 工具栏高 48/面板 offsetY=0 时 top≥0 且 bottom==时间轴顶 ±1/无异常)。
- 回归: tsc + v1-v110 全部 check 全绿; v103/v104/v108/v109 CDP 抽跑通过。

## v111 — 谱面信息移到游玩区左下角 + 变速播放频谱漂移修复
- 需求: ① 工具栏右侧谱面名移到游玩区左下角显示 (仿放置滑条提示样式); ② 开启歌曲变速 (0.25/0.5/0.75x) 时波形图/频谱图移动速度与上方时间轴不一致。
- 根因 (②, 纯数学可证): drawSpectro 滚动缓存旧簿记 `sc.t0 (上次平移时的帧时间) + frac (亚像素残差)` — **dx=0 的帧不更新 t0 却把该帧累计位移全塞进 frac**, 下一帧 `pixelShift(旧t0, 新t)` 又包含这段位移 → 双计。每轮 "dx=0→平移" 循环多移 ~0.5-1px 且随帧数线性累积 (verifier/v111 tests T4 实测: 0.25x 600 帧漂移 124.6px); 慢速滚动 (变速播放) 时 dx=0 帧占比高 → 频谱相对时间轴越播越偏早。波形模式每帧全量重绘不受影响。
- 实现:
  - `waveformData.ts`: 新纯函数 `spectroScrollStep(imgT0, t0, win, width)` → `{dx, newImgT0}` — imgT0 是离屏位图**精确表示的视口起点** (浮点毫秒), 平移 dx 像素后 `newImgT0 = imgT0 + dx*win/width`, 亚像素残差自然留在 imgT0 里, 不变式: 与当前 t0 偏差恒 ≤0.5px, 任何帧数/速率不累积。
  - `WaveformPanel.tsx`: scrollRef 改 `{cv, imgT0, win, w, h}` (frac 删除); drawSpectro 走 spectroScrollStep; 新露出列按位图自身时间基准 newImgT0 采样 (旧用帧时间 t0, 接缝混 ≤0.5px 时间差)。
  - `App.tsx`: 工具栏谱面信息 span 删除 → 游玩区 relative 容器内新增 overlay `absolute bottom-2 left-2 text-xs bg-black/60 rounded px-2 py-1 truncate max-w-[36rem] pointer-events-none`; 保存反馈逻辑原样 ([已保存] 前缀绿/失败红, data-save-message 属性保留, v67/v81 CDP 零适配)。
- 验证: verifier/v111 (tests.ts T1-T4: 基本步进/7 档速率各 10000 帧偏差恒 ≤0.5px/反复进退 3000 帧 ≤0.5px/旧簿记对照 600 帧漂移 124.6px 证明断言有效; check.mjs 13 项; cdp-v111.mjs: 谱面 overlay 贴游玩区左下角 8/8px 且工具栏无名 + 0.25x 播放 12s 后频谱冲激列 3000/4000ms 与期望列差 0.8/1.4px ≤2.5 (旧实现此处 >10px), 暂停后 0.2/0.9px, 时间轴 tick sanity 同步)。
- 回归适配: v110 check (工具栏不再含 data-save-message, 改断言在左下角 overlay); v108 check (同上); v103/v106 check (renderSpectroStrip 第三参 t0→newImgT0, import pixelShift→spectroScrollStep)。
- 回归: tsc + v1-v111 全部 check 全绿; v103/v104/v106/v110 CDP 抽跑通过。

## v113 — 绿线 Del/右键删除 + J/K 移动 + 复制粘贴绿线-滑条同刻偏差修复
- 需求: ① 上时间轴选中的绿线支持按 Del/Backspace 删除、右键删除; ② 选中绿线时 J/K 像选中物件一样前/后移一个吸附距离; ③ 修复复制多根绿线与滑条粘贴后, 原本与绿线同刻的滑条改用前一条绿线速度的问题。
- 根因 (③): `store.paste` 两条路径取整不对称 — 物件 `o.time = c.time + atTime` (不取整), 绿线 `Math.round(c.time + atTime)`。`atTime = currentTime` 常带小数 (音频时钟), 同刻复制的滑条与绿线粘贴后相差 frac(atTime) (<1ms), 滑条落在绿线**之前**; `timingAt` (parser.ts) 按 `p.time > time + 1e-6` 截断, 于是滑条取到前一条绿线的 SV。duplicate.ts 路径本就双边取整, 只有 paste 不对称。
- 实现:
  - `store.ts deleteSelected`: 守卫改为 `!selected.size && !selectedGreenLines.size`; 选中的绿线按 time 键过滤删除 (红线不受影响), 与物件共用一次 undo (快照本就含 timingPoints)。
  - `store.ts deleteGreenLinesAt(times)`: 新方法, 一次 undo 删除指定时刻绿线并同步选区; 时间轴右键用。
  - `store.ts nudgeSelected`: 同上守卫修正; 选中绿线 `tp.time += ms` 后 timingPoints 重排序, `selectedGreenLines` 按新 time 重键 (同 Timelines 拖拽的换键模式)。App.tsx 的 J/K 路由 (步长 = `Math.round(red.beatLength / beatSnap)`) 不变, 物件/绿线/混合选区一键同动。
  - `store.ts copy/paste`: 物件时间改走 `Math.round(c.time + atTime)` 与绿线同路径, 同刻复制粘贴后严格相等; 顺带修复 `endTime` 不平移的旧 bug (copy 转相对时间, paste 还原取整) — 旧逻辑复制的转盘粘贴后 endTime 仍是原绝对时刻。
  - `Timelines.tsx onContextMenu`: 物件命中前先 `hitTestTimingPill` — 绿线药丸右键删除 (点在选中绿线上删全部选中绿线, 否则只删该线); 红线右键不动作。
- 验证: verifier/v113 (tests.ts: 混合选区删除/仅绿线删除/右键删除/J-K 平移重键排序/同刻滑条+绿线 frac(atTime)=0.4 粘贴后时间严格相等且 sliderVelocityAt 取到同刻 SV=2.0 (旧实现得 0.28)/转盘 endTime 平移, 各附 undo 恢复断言; check.mjs 14 项接线断言)。注意: tests.ts 里源物件 id 勿用 1 — parser.genId 是进程内计数器从 1 起, 粘贴新物件会撞 id。
- 回归: `npx tsc -b --force` + v1-v112 全部 check 全绿 (v60 除外 — 其 signalsmith-stretch DSP 断言由另一并行任务处理, 与本批改动无关: v60 tests.ts 不 import 任何 src 文件)。

## v114 — 右键已选中项删整个选区 + Q/W/E/R 改 lazer 三态语义
- 需求: ① 选中多个物件/绿线时, 右键其中一个应删除所有选中 (而非只删点中的那个); ② 选中多个物件时 Q/W/E/R (newCombo/whistle/finish/clap) 应统一作用于全部选中物件。
- 根因 (②): 旧实现 `toggleSelectedHitSound` 逐物件 XOR (`hitSound ^ bit`)、`toggleSelectedNewCombo` 逐物件取反 — 混合选区 (部分有位部分没有) 按键后各翻各的, 观感就是"没对所有选中生效"。lazer 依据: `HitObjectComposer.checkToggleMappingFromKey` (Q/W/E/R -> 三态按钮) + `DrawableTernaryButton.Toggle` (False/Indeterminate -> True, True -> False) + `EditorSelectionHandler.SetNewCombo` — 即**未全有则全部置位, 全有才全部清位**。
- 实现:
  - `store.ts toggleSelectedHitSound`: 先 `every()` 判全有, 再走既有 `setSelectedHitSoundBit(bit, !all)` 统一置/清; `toggleSelectedNewCombo` 同理统一 `o.newCombo = on`。均一次 undo, 空选区无操作。
  - 右键删除三处统一语义: **点中已选中项 -> `store.deleteSelected()` 删整个选区 (物件+绿线, 一次 undo); 点中未选中项 -> 只删该项** (旧路径保留)。`EditorCanvas.tsx onContextMenu` (物件)、`Timelines.tsx onContextMenu` (物件 marker/bar 兜底、绿线药丸)。
- 验证: verifier/v114 (tests.ts: 混合选区首按全部置位且保留其它位/全有才全清/undo 恢复/newCombo 三态/空选区不入栈; check.mjs 9 项: 三态接线 + XOR 已删 + 三处右键整区删除 + 未选中单删路径保留)。
- 回归适配: v113 check (绿线右键断言改 v114 语义: 选中->deleteSelected/未选中->deleteGreenLinesAt); v24 check (toggleSelectedNewCombo 断言 `o.newCombo = !o.newCombo` -> `o.newCombo = on`, 意图"只动 newCombo 位"不变)。
- 回归: `npx tsc -b --force` + v1-v113 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v115 — 左侧栏「锁定物件」(stable Lock Notes)
- 需求: 左侧栏加锁定物件开关 (stable 「编辑 > Lock Notes」; lazer 无此功能, 语义照 stable), 开启后无法移动/修改任何物件。
- 语义界定 (stable): 锁定只挡**已有物件**的变更 (移动/时间/几何/音效/删除/转换), **放置新物件、粘贴、批量复制 (纯新增)、绿线编辑不受影响**; 选中/框选仍可用。
- 实现 (统一守卫, 不集中拦截 undo/emit):
  - `store.ts lockNotes = false` (UI 状态, 开关走 emitSelection 不 bump dataVersion)。方法级守卫: `deleteSelected`/`nudgeSelected` 改 `delObjs`/`moveObjs` 短路 (锁定时物件跳过, 绿线照删/照动); `nudgeSelectedPosition`/`applyTransform` (旋转/镜像/缩放)/`reverseSelected`/`applyToSelected` (hitsound/newCombo/hitSample)/`updateObject` 直接 return; `applyConversion` 仅 `removeIds.length` 时拦 (批量复制 removeIds=[] 放行)。
  - UI 直改路径守卫: `EditorCanvas` — 旋转/缩放手柄、节点编辑、物件移动拖拽 (可选中不可拖)、右键控制点操作与通用删除; `Timelines` — 拖尾改折返、物件时间拖拽 (可选中)、右键删物件 (绿线右键放行); `Inspector` — `upd` 数值/下拉编辑。
  - `App.tsx` 左侧栏「🔒/🔓 锁定物件」开关 (琥珀色高亮=开, data-lock-notes 挂钩), 放在「锁定间距」组后。
- 验证: verifier/v115 (tests.ts 6 组: 删除/J-K/Ctrl+方向键/变换/Q-W-E-R/updateObject/删源转换被拦且无 undo 入栈, 绿线/放置/纯新增/解锁恢复放行; check.mjs 23 项: 全部守卫点接线 + 开关接线 + addObject 不加守卫)。
- 回归适配: v113 check (deleteSelected/nudgeSelected 守卫重构为 delObjs/moveObjs 短路, 断言同步); v35 check (拖尾判定行加锁定短路, 优先级断言同步)。
- 回归: `npx tsc -b --force` + v1-v114 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v116 — 批量复制「缩放/份」+「添加绿线缩放滑条」
- 需求: 批量复制新增「缩放/份」输入框与「添加绿线缩放滑条」勾选框。缩放 0.1 => 第 1 份 1.1x/第 2 份 1.2x...; -0.1 => 0.9x/0.8x...。勾选后滑条参与缩放并添加绿线, 否则滑条不缩放。
- 语义: 第 i 份几何缩放 s = 1 + i×scalePerCopy (绕既有锚点, 先缩放再旋转再平移; 下限 0.1 防负缩放)。圆圈/滑条头尾位置按 s 缩放; 转盘照旧不动。滑条未勾选时 k=1 (只旋转+平移, 几何与长度原样)。
- 补偿绿线 (勾选且 s≠1): 几何缩放 s 使滑条像素长度变 s 倍 → 时长变 s 倍; 对每份每条滑条生成两条绿线 — **头部 SV = 生效SV×s / 尾部还原生效SV**, 拷贝时长与原件一致 (mapping 常用的几何缩放+SV补偿手法)。生效 SV 判定基于谱面绿线 + v68 绿线副本; 尾时间按缩放后 SV 推导 (`sliderVelocityAt`); 同刻冲突头部优先; 绿线字段克隆该时刻生效绿线 (`defaultNewPoint`, lazer addNew 语义)。
- 实现: `duplicate.ts` — `DuplicateParams` 加 `scalePerCopy` (默认 0) / `scaleSlidersGreenLines` (默认 false; loadParams 合并默认值, 旧存档兼容); `computeDuplicate` 的 rot 带缩放系数 k, 滑条 `length` 同步缩放 (2 位小数); 新纯函数 `computeDuplicateScaleTiming(bm, objs, p, base)`。`DuplicateDialog.tsx` — 「缩放/份」DraftNum (-0.99..5, step 0.05) + 勾选框, 预览/应用改用 `allTiming = 复制绿线 + 补偿绿线`。
- 验证: verifier/v116 (tests.ts 7 组: 0.1/-0.1 逐份缩放坐标/滑条勾选与否/补偿绿线头 SV×s 尾还原且时长不变/生效 SV 乘算基准/空条件/多份独立/默认参数与 v65 行为一致; check.mjs 15 项)。
- 回归适配: v65/v68 check (预览/应用绿线参数 `timing` -> `allTiming`)。
- 回归: `npx tsc -b --force` + v1-v115 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v117 — 滑条节点多选 (Alt 层): 框选/多选节点 + 整体拖动/旋转/缩放
- 需求: 支持框选、多选滑条节点, 选中的节点可一起拖动/旋转/缩放, 同时保证原有其他功能正常; 选中滑条时在游玩区边缘提示此高级用法。
- 交互设计 (lazer 无此功能, 自研; 与 lazer 已有 Alt 场景 — 缩放手柄默认原点/Alt+滚轮/Alt+QWER — 不冲突):
  - **不是新工具/新模式**: Alt 修饰键临时进入「节点层」, 物件层行为零改动 (无 Alt 时单击节点仍是单点拖拽; 白点切红自 v118 起需 Ctrl+点击)。
  - Alt+点选节点 = 选中 (Shift/Ctrl = 加选/减选); Alt+空白拖动 = 节点框选 (修饰键追加); 节点所在滑条自动并入物件选区 (节点层是物件选区的细化)。
  - 节点选区非空时, 选中框/旋转/缩放手柄 (v49/v50 全套几何) 自动作用于选中节点 — `currentQuads` 分流到 `nodeBounds`; Esc 先退节点层再清物件选区。
  - 选中滑条且节点层未激活时, 游玩区下边缘画半透明黄色提示文案。
- 实现:
  - 新纯函数模块 `nodeSelection.ts`: `ctrlPoints` (含头部+堆叠偏移) / `nearestNode` (跨滑条最近优先, 并列取序号在前) / `nodesInRect` / `nodeBounds` (q/dq 分离同款) / `withRedPartners` (v29 语义: 红锚点重复对不拆散) / `snapshotNodes` / `transformNodesFromSnapshot` (从 Begin 快照重算, 取整写回)。
  - `store.ts`: `selectedNodes` / `nodeSelectionCount` / `setSelectedNodes` (自动并入物件选区) / `toggleSelectedNode` / `clearNodeSelection`; 联动清空接入 select(非加选)/toggleSelect/clearSelection/selectGreenLines/selectWithGreens/deleteSelected。
  - `EditorCanvas.tsx`: 4 个拖拽 ref (移动/框选/缩放/旋转); Alt 分支排在旋转/缩放手柄之后、单滑条节点编辑之前; 节点拖动锚点吃物件/辅助线/网格吸附 (排除被拖滑条自身, v96 同款防自锁), 拖拽中 resnapSliderLength + invalidatePath + commitDrag; 手柄拖拽复用 dragToScale/anchorOpposite/anchorAxis/angleDeltaDeg/snapRotation, Alt=默认原点 (节点集 MEC 圆心), 收尾语义与物件层一致 (动过 commit, 没动 undo 弹空快照); window mousemove/mouseup/keydown/keyup 同步接线; 渲染 = 黄环高亮 (#f2b544, 屏幕恒定半径) + 黄色虚线框选矩形 + 下边缘提示。
  - v115 lockNotes 门控覆盖全部新入口。
- 验证: verifier/v117 (tests.ts 9 组 27 断言: 纯函数 + store API/联动清空; check.mjs 30 项: Alt 分支/分流/四个 ref/收尾 x2/渲染三件套/提示条件/App ESC/lockNotes 门控)。
- 回归适配: v84 check (snapWithGeo 计数 7 -> 8, 新增节点拖动吸附点)。
- 回归: `npx tsc -b --force` + v1-v116 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v118 — 滑条节点编辑对齐 stable: 按住 Ctrl 点击才插白点/白点转红
- 需求: 原来鼠标点到滑条线就插新白点、点白点就转红; 用户习惯 osu!stable 行为 — 需按住 Ctrl 再点击才插白点/转红。
- 语义 (stable): **Ctrl+点击线段** = 在最近点插入白点; **Ctrl+点击白点** = 转红; 直接点击 (无 Ctrl) 只选中/可拖拽, 不改形。红->白仍是右键 (v29, 不变, 不需 Ctrl); 节点拖拽/删除/Alt 层 (v117) 不受影响。
- 实现 (`EditorCanvas.tsx`): `nodeDragRef` 加 `toggleRed = 按下时 ctrlKey||metaKey`; 线段命中插点循环整体包进 `if (e.ctrlKey || e.metaKey)` (不按 Ctrl 落到物件命中 = 选中/拖整物件); onMouseUp 未拖拽分支 `next = ctrl && nd.toggleRed && !isRedPairPoint(...) ? toggleSliderPointRed : null` (无 Ctrl 弹空快照, 无操作)。
- 验证: verifier/v118 (check.mjs 8 项: toggleRed 字段/接线、插点 Ctrl 门控、切红 Ctrl 门控、拖拽与右键不受影响)。本改动为交互门控, 纯函数 (insertSliderPoint/toggleSliderPointRed) 未动, 沿用 v25/v26 测试。
- 回归适配: v29 check 断言 `!isRedPairPoint(...) ? toggleSliderPointRed` 仍匹配 (前置加了 nd.toggleRed); v29/cdp-redpair.mjs (CDP 手工测试, 需 dev server) 模拟的是无 Ctrl 点击, 其行为预期已过时, 如重跑需加 Ctrl。
- 回归: `npx tsc -b --force` + v1-v117 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v119 — 网格类型新增「无网格」(显示/吸附全关, 贴近游玩表现)
- 需求: 网格模式下拉加「无网格」— 显示的网格与游玩时表现不同, 关闭网格后更贴近游玩表现。
- 实现: `gridSnap.ts` GridType 联合 + `'none'`, `snapToGrid` 对 none 直通 (不吸附也不钳制, 与完全不开网格吸附行为一致); `store.ts` gridType 类型联合同步; `EditorCanvas.tsx` — 网格线渲染、自定义网格中心标记显示/拖拽均在 none 时停; `App.tsx` 下拉加「无网格」选项, 旋转输入在 none 时禁用 (`rotationPeriod('none') = null`, 与 circle 同款)。
- 语义边界: 无网格 ≠ 关闭「网格吸附」开关 — gridSnap 开关控制吸附, gridType 'none' 同时停显示与吸附; 间距 (GridSize) 照常可编辑 (谱面属性, 切回其他类型即用)。
- 验证: verifier/v119 (tests.ts 7 断言: none 直通/不钳制/无旋转周期 + 其余类型行为不变; check.mjs 9 项接线)。
- 回归适配: v56 check (gridType 类型联合断言 +none); v78 check (网格中心标记显示/拖拽条件断言 +none 门控)。
- 回归: `npx tsc -b --force` + v1-v118 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v120 — 未保存改动提示 (切换谱面/难度/关闭编辑器前弹保存/废弃弹窗)
- 需求: 改动谱面后, 浏览其他谱面/其他难度/关闭编辑器都会直接废弃当前改动; 需要弹窗提示保存/废弃。
- 脏标记: `store.dirty` — 埋点在 `pushUndo` (全部谱面变更的统一入口: 组件直调或 beginDrag), `load`/ `save` 成功时清除 (undo 回到原样不清脏, 常规编辑器语义)。`save()` 改返回 `Promise<boolean>` (保存并继续依赖成功与否)。
- 拦截: `store.guardUnsaved(action)` — 脏时把 action 登记为 `pendingAction` 并返回 false (调用方直接 return), 弹窗确认后重入原动作。接线点: SongLibrary `openDiff` (浏览其他谱面/难度)、App `importFiles` 的 .osz/.osu 两支 (拖入导入)、`openServerDifficulty` (Electron 菜单「打开一个难度/最近的难度」, 启动恢复时 dirty=false 自然放行)。
- 关闭编辑器: Electron — 渲染端经 `dirtyState` IPC 上报脏标记, 主进程 `win.on("close")` 拦截并回发 `close-request`, 渲染端弹同款提示, 确认后 `confirmClose` 真正关窗 (菜单退出同理被拦); 浏览器 — 仅非 Electron 注册 `beforeunload` 原生提示。`getElectronAPI` 加 `typeof window === 'undefined'` 守卫 (node 单测环境)。
- 弹窗: `UnsavedDialog.tsx` (z-60 盖住曲库) — 保存并继续 (保存失败不执行后续动作, 弹窗保留) / 废弃改动 / 取消, 三按钮带 data-unsaved-dialog 挂钩。
- 验证: verifier/v120 (tests.ts 5 组 13 断言: load 清脏/pushUndo 置脏/guardUnsaved 放行与拦截/resolvePendingAction 取消与确认/无谱面放行; check.mjs 21 项: store/拦截点/Electron 三进程通道/弹窗接线)。
- 回归适配: v67 check (save() 返回类型 Promise<void> -> Promise<boolean>)。
- 回归: `npx tsc -b --force` + v1-v119 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v121 — 菜单栏最右侧「未保存改动」指示器 (⚪ + 文本)
- 需求: 文件/设置菜单栏最右侧加谱面改动指示器, 小白点加文本形式; 有改动才显示, 保存后消失。
- 实现 (electron/main.cjs): buildMenu 模板末尾 (「设置」之后) 条件追加 `{ label: "⚪ 有未保存改动", enabled: false }`; `dirty-state` IPC 处理器里 isDirty 翻转即 buildMenu — v120 的脏标记链路 (pushUndo 置脏 / save+load 清脏 -> reportDirtyState 上报) 驱动, 实时出现/消失, 无需轮询。
- 验证: verifier/v121 (check.mjs 5 项: 条件项文本与禁用、位置在设置之后、翻转即重建、脏标记链路)。纯 main.cjs 改动, 无 ts 变更。
- 回归: v1-v120 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v122 — hitsound 修复: 密集段消音 + 暂停时音效一起停 (+ 听感延迟)
- 需求: hitsound 感觉有延迟; 短时密集音效 (180bpm 1/8 塞满) 直接消音; 暂停歌曲时音效要一起停。
- 根因 (消音/听感延迟同根): v101 的 VoiceLimiter 把**提前 ~250ms 预排程 (lookahead) 的未来 voice 也计入并发名额**。密集段未来 voice 占满 6 个名额, 正在发声的 voice 一开口就被当"最老"瞬杀 — 听感近乎完全消音, 偶发残响也让人误以为延迟。
- 修复 (对齐 lazer BASS 语义 — 并发只数发声中的 voice):
  - `voiceLimiter.ts` 重构: `register(key, v, start, end)` 带发声区间 (AudioContext 时间), 只统计与新 voice **同时发声**的旧 voice, 超限才逐出最老; 新增 `drain()` (暂停清空); 未来预排程 voice 不占名额。
  - `store.ts trackVoice(buf, src, gain, startCtx, endCtx?)`: 发声起点 = `max(排程时刻, 现在)`; 被逐出的最老 voice 在新 voice 发声时刻 `setTargetAtTime(0, ·, 0.008)` (~25ms 淡出) 后 stop — 防咔哒; 一次性 hitsound 与 sliderslide 循环两处出声点同款接线。
  - 长尾巴样本 (hitfinish ~400ms) 密集触发时上限兜底仍在 (稳态并发 ≈ 时长/间隔 > 6 才逐出)。
- 暂停修复: 新增 `stopAllHitVoices()` (drain 后停止全部 voice, 含已预排程未发声的 — 旧实现暂停后这些还会响 ~250ms), 接入 `stopSource()` (暂停/换谱/变速重启都经此处); 排程器 `setMuted(true)` 已有。恢复播放时 `resync()` 游标从头重算, 暂停窗内被杀的音效自动重排。
- 验证: verifier/v122 (tests.ts 4 组: 180bpm 1/8 密集段零逐出复刻/同时发声超限逐出/长尾巴兜底/drain 清空; check.mjs 11 项接线)。
- 回归适配: v101 tests.ts 重写为新 register 语义 (9 组), v101 check.mjs 断言同步 (sounding 过滤/新签名/gain 记录/trackVoice 两处调用)。
- 回归: `npx tsc -b --force` + v1-v121 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v123 — 未保存改动指示器移到应用内顶栏最右侧 (替代 v121 菜单项)
- 起因: v121 的原生菜单项指示器无法显示在窗口最右侧 (Windows 原生菜单项不支持右对齐)。
- 实现: `App.tsx` 顶栏 (h-12 标题行) 加 `flex-1` 撑开后渲染指示器 — 白点 (rounded-full bg-white) + 「有未保存改动」文本, `store.dirty` 为真才显示, data-dirty-indicator 挂钩; `store.setDirty` 翻转时 `emitPlayback()` 即时显隐。`electron/main.cjs` 移除菜单指示项与 dirty-state 里的 buildMenu 调用 (dirty-state 仍供关闭拦截)。
- 验证: verifier/v123 (check.mjs 6 项: 条件渲染/挂钩/白点/文本/最右侧位置/即时刷新)。
- 回归适配: v121 check 重写 (菜单指示器已移除, 断言脏标记链路保留)。
- 回归: `npx tsc -b --force` + v1-v122 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v124 — 未保存改动指示器移到游玩区左下角谱面信息前
- 需求: 指示器改到游玩区域左下角的谱面信息前, 与 [已保存] 标记位置相同。
- 实现: `App.tsx` 左下角谱面信息 pill (v111) 内, 谱面名前加 `[⚪ 未保存]` 前缀 (data-dirty-indicator 挂钩) — 与 `[已保存]` 前缀同位置同 `<b>` 样式, 未保存指示排在保存反馈之前 (两者实际互斥: 保存成功即清脏); 顶栏指示器 (v123) 移除。setDirty 翻转 emitPlayback 即时显隐保留。
- 验证: verifier/v124 (check.mjs 4 项: 前缀文本/位置在 pill 内/在谱面信息前/在已保存前缀前)。
- 回归适配: v123 check 重写 (顶栏指示器已移除, 断言即时刷新链路与指示器存在)。
- 回归: `npx tsc -b --force` + v1-v123 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v125 — spinner 缩圈 + 转盘旋转对齐 osu!lazer
- 需求: 修复 spinner 缩圈异常 + 转盘不旋转, 表现与 osu!lazer 对齐。
- lazer 出处: `LegacyOldStyleSpinner.cs` (经典皮肤: 缩圈 ScaleTo(SPRITE_SCALE*1.86) 起 → ScaleTo(SPRITE_SCALE*0.1, duration) 终, 即相对转盘 ~1.4x → ~0.08x, 贯穿整个转盘期间; 开始前恒定不缩) + `DefaultSpinnerDisc.cs` (ambient 自转 RotateTo(25*duration/2000, preempt+duration), 即恒定 12.5°/s, 从 preempt/2 前起转)。
- 实现: `src/osu/renderer.ts` — 新增导出纯函数 `spinnerApproachRatio(frac)` (frac<=0 恒定 1.4, 期间线性 1.4→0.08) 与 `spinnerAmbientRotation(dtMs, preemptMs)` (0.0125°/ms × max(0, dt+preempt/2)); `drawSpinner` 加 `preempt` 参数 (调用处 renderPlayfield 传入), 转盘改为恒定大小 360 并用 drawSprite 旋转参数自转, 缩圈尺寸走 spinnerApproachRatio。移除旧的错误范围 (缩圈 2.2→1.0, 转盘 360*(1-frac*0.12) 缩放)。
- 验证: verifier/v125 (tests.ts 10 项纯函数断言 + check.mjs 11 项源码接线断言)。
- 回归: `npx tsc -b --force` + v1-v124 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v126 — 视觉间距辅助线 (物件等距轮廓, 可调距离)
- 需求: 在物件周围一定距离处绘制与物件等距的辅助线, 距离可调, 加到辅助线设置窗口。
- 实现:
  - `geometryHelpers.ts`: `geoDistSources()` (范围语义同 geoHelperSources, 但作用于单点+滑条, 转盘排除) + `offsetPolyline(pts, d)` (折线双侧等距偏移: 顶点法线=相邻段法线平均, miter 补偿限幅 3 倍防尖刺, 重合点沿用前段法线, 掉头段退化单侧法线)。
  - `store.ts`: `geoDist` (默认关, 避免默认干扰) + `geoDistValue` (默认 50 osu px, setGeoDistValue clamp 0-500); setGeoFlag 键加 'geoDist'。
  - `GeoSnapPanel.tsx`: 第四行开关「视觉间距辅助线 (Distance Guides)」+ 行尾 px 数字输入 (关时禁用)。
  - `EditorCanvas.tsx`: 几何辅助块后渲染 — 轮廓距离 = csToRadius(CS) + geoDistValue (物件边缘等距); 单点=金色虚线圆环, 滑条=offsetPolyline 左右偏移线 + 头尾半圆端帽; 样式 rgba(242,181,68,0.8) dash [6,5] (与红色几何辅助/黄色框选区分); 受 geoDist 开关 + 工具栏「辅助线」总开关控制, 范围共用 geoScope。仅视觉参考, 不参与吸附。
- 验证: verifier/v126 (tests.ts 12 项: 直线双侧偏移/直角 miter 长度与方向/锐角限幅/重合点/单点/来源筛选; check.mjs 19 项接线断言)。
- 回归: `npx tsc -b --force` + v1-v125 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v127 — 删除标题行 + 波形/频谱默认画在上方时间轴背景 (废弃 WaveformPanel)
- 需求: ① 删除「osu! 谱面编辑器」标题行 (无实际功能); ② 波形图/频谱图默认显示在上方时间轴背景, 废弃原悬浮窗; ③ 时间轴物件/各种线显示在波形上层; ④ 时间轴右侧加波形图/频谱图切换钮 + 背景/上层切换钮; ⑤ 波形切到上层时右侧按钮仍需更高层级。
- 实现:
  - 新增 `src/osu/waveformDraw.ts`: drawWave/drawSpectro/renderSpectroStrip 与配色常量从 WaveformPanel 原样抽出 (滚动缓存类型导出为 SpectroScroll 接口; import 改 './waveformData')。
  - `store.ts`: wavePanelOpen 默认改开 (无存储时 true); 新增 waveMode ('wave'|'spectro') / waveOnTop (bool) 状态 + setter + localStorage 持久化 (osu-editor:wavepanel:mode / ontop)。
  - `Timelines.tsx` TopTimeline: drawWaveLayer() 在帧循环内两级绘制 — 背景模式 (waveOnTop=false) 在时间轴内容之前 (物件/红绿线/tick/药丸/时间针自然在上层), 上层模式在帧尾当前时间针之后 (canvas 内最上层); 频谱滚动缓存 spectroScrollRef 移入本组件。右侧按钮组加 z-10 (DOM 恒高于 canvas 内容), 新增「波形图/频谱图」(data-wave=mode) 与「背景/上层」(data-wave=layer) 切换钮 (波形显示时才渲染)。
  - `App.tsx`: 删除 h-12 标题行; 移除 WaveformPanel import/渲染; 左栏「📈 波形」按钮语义改为时间轴波形显示开关 (title 更新)。
  - 删除 `src/components/WaveformPanel.tsx`。
- 验证: verifier/v127 (check.mjs 21 项: 标题行删除/面板废弃/store 默认开与持久化/两级绘制顺序/切换钮/z-10)。
- 回归适配: v103 (面板段重写为 waveformDraw+TopTimeline 接线), v104 (钳制断言删除, 20ms 偏移断言迁 waveformDraw), v105 (面板 chrome 删除, 半透明断言迁), v106/v111/v112 (读取路径改 waveformDraw, import 路径改 './waveformData', v111 滚动缓存类型改 SpectroScroll 接口), v107 (点击穿透语义作废, 重写为面板删除+按钮 z-10 记录), v108 (工具栏断言改删除断言, offsetY 断言删除), v110 (加高对齐语义作废, 重写保留 v111 左下角信息断言)。
- 回归: `npx tsc -b --force` + v1-v126 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v128 — 歌曲库会话缓存: 二次打开免重扫 + 记住上次位置
- 需求: 歌曲库记住上次位置, 未刷新时第二次打开不用重新加载。
- 实现 (`src/components/SongLibrary.tsx`): 模块级 `libraryCache` 会话缓存 (rootName/dirs/难度数徽标/搜索词/选中歌曲/难度列表/滚动位置)。
  - 状态初值全部取缓存 (dirs/filter/selName/diffs/scrollTop/meta); 恢复目录后缓存按目录名匹配命中 → 跳过 startScan, 日志「已从会话缓存恢复列表 (未重新扫描)」, 并补取选中歌曲背景 (objectURL 不跨挂载)。
  - 滚动位置: view.top 初值取缓存, root 就绪且列表挂载后一次性 scrollTop 恢复。
  - 失效时机: 任何显式扫描 (「重新扫描」/「更换目录」/拖拽导入/授权后首扫) 走 startScan → 顶部 `libraryCache = null`; 换目录打开时清掉按旧缓存初始化的状态再重扫。
  - 安全: scanDoneRef 标记 — 扫描中途关闭面板不写缓存, 下次打开重扫, 防残缺列表被当成完整结果; 'loading' 占位徽标不入缓存。
- 验证: verifier/v128 (check.mjs 19 项: 缓存结构/失效时机/初值恢复/命中跳扫顺序/scanDone 门槛/滚动恢复/快照字段)。
- 回归: `npx tsc -b --force` + v1-v127 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v129 — 游玩区扩大 (上 18px/下 10px 间隔) + 面板半透明浮层
- 需求: 增大游玩区域, 与上时间轴留 18px、与下时间轴留 10px 间隔; 上下时间轴/左右侧栏背景改半透明, 能看到背后游玩的物件。
- 实现:
  - 布局重构 (`App.tsx`): 主区改相对容器 — edit 页签时 EditorCanvas 铺满底层 (absolute inset-0 z-0); 上时间轴行/中间行(左侧栏+内容+右检查器)/下时间轴组成浮层列 (z-10)。浮层列整体 pointer-events-none, 各面板 pointer-events-auto (中央空隙点击直达画布); setup/timing 页容器也补 pointer-events-auto。
  - 游玩区定位 (`EditorCanvas.tsx` viewTransform): 预留常量 PANEL_TOP_H=93 (92 canvas + 1 border) / PANEL_BOTTOM_H=82 (80 h-20 + 2 border) + 间隔 GAP_TOP=18 / GAP_BOTTOM=10 → RESERVED_TOP=111 / RESERVED_BOTTOM=92; 可用高度 = 画布高 − 上下预留, 缩放公式不变 (*1.1), oy 从预留顶起算。面板行高改动需同步常量 (注释注明)。
  - 半透明: 左右侧栏/右检查器 bg-[#16161d]/75; 上时间轴 canvas 底 rgba(12,12,17,0.72); 下时间轴 canvas 底 rgba(16,16,24,0.7) + 容器 bg-[#151520]/70; SelectionInfoPanel bg-[#0c0c11]/72。
- 验证: verifier/v129 (check.mjs 16 项: 预留常量/间隔/oy 起算/画布底层/浮层列/pointer-events/各处半透明)。
- 回归适配: v108/v109 (侧栏类名加 /75, setup/timing 容器加 pointer-events-auto), v28/v45 (缩放公式断言 r.height → availH)。
- 回归: `npx tsc -b --force` + `npx vite build` + v1-v128 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v130 — 游玩区高度利用系数 1.1 → 1.2 (下时间轴间隔 64px → ~13px)
- 需求: 下时间轴间隔实测 64px 过大, 改成原来的 1/5 (~13px); 游玩区域同步再放大。
- 根因: viewTransform 高度缩放系数 1.1 刻意保留 PAD_Y 呼吸空间 → 垂直 slack ≈ 8.6% 可用高, 居中分摊后实测间隔 = 10 + slack/2 ≈ 64px。
- 实现 (`EditorCanvas.tsx` viewTransform): 系数 1.1 → 1.2 (几乎吃满 PAD_Y 留白) → slack ≈ 0.69% 可用高, 实测间隔 ≈ 10 + availH×0.35% ≈ 13px (= 64/5, 用户规格); 游玩区高度同步再放大 ~9%。居中公式与 GAP_TOP=18/GAP_BOTTOM=10 规格不变。
- 验证: verifier/v130 (check.mjs 6 项: 系数/注释/规格保留/居中公式/slack 数值)。
- 回归适配: v45 check (断言 1.1 → 1.2)。
- 回归: `npx tsc -b --force` + v1-v129 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v131 — 皮肤修复: followpoint 序列帧优先 + 滑条球按贴图固有尺寸
- 需求: 皮肤 "- (RX) Fantastical Evening Star" 的 followpoint 不显示; 滑条球大小疑似未与 lazer 对齐。
- 诊断:
  - followpoint: 该皮肤 followpoint.png 是 1x1 透明占位图, 真实内容在 followpoint-{n} 序列帧 (60 帧, 40 帧 1x1 占位 + 20 帧 128x10 箭头)。我们加载器单图优先 → 加载占位图, followpoint 全不显示。lazer `LegacySkinExtensions.GetTextures`: animatable 时先查 followpoint-0, 有帧即整组动画, 静态图被忽略 — 我们顺序反了。
  - 滑条球: 该皮肤 sliderb.png 为 170x170 含 ~21px 透明内边距 (球内容 128px)。lazer `LegacySliderBall` AutoSize = 贴图尺寸 (上限 MAX_FOLLOW_CIRCLE_AREA_SIZE = OBJECT_DIMENSIONS*3 = 384), 即按贴图固有尺寸 170/128 × 2r 绘制, 视觉球与 note 等大; 我们压进 2r 盒子 → 视觉球小 25%。
- 实现:
  - `skin.ts`: followpoint 通道改序列帧优先 (帧连续加载到首个缺失, 有帧即整组动画, 无帧才回退单图); 默认帧率 1000/帧数 → 1000/60 (lazer SIXTY_FRAME_TIME); 新增 `skinSpriteWidth` WeakMap — 皮肤目录 sliderb 登记固有宽度 (img.width ÷ ScaleAdjust), 程序化回退 sliderb 登记 128 (= 2r 盒子, 默认皮肤外观不变)。
  - `renderer.ts`: 滑条球绘制尺寸 = size × min(固有宽度 ?? 128, 384) / 128。
- 验证: verifier/v131 (check.mjs 12 项: 帧优先顺序/单图回退/60fps/宽度登记/渲染接线)。
- 回归适配: v47 check (帧时长默认断言 1000/帧数 → 1000/60)。
- 回归: `npx tsc -b --force` + v1-v130 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v132 — 显示设置面板 (页签栏右侧, 5 个显示开关)
- 需求: 应用内顶栏添加显示设置: ① 是否使用皮肤中的物件/滑条颜色 ② 滑条中间细实线确认轨迹 ③ 开关缩圈 ④ 开关滑条渐出 ⑤ 开关 note 点击特效 (命中暂留放大淡出 vs 立即消失)。
- 实现:
  - 新增 `src/osu/displaySettings.ts` (纯数据层, 无 React): `DisplaySettings` 五开关 (skinColors/sliderPathLine 默认关, approachCircle/sliderFadeOut/hitExplosion 默认开 = 保持旧行为), 可变单例 `displaySettings` 渲染循环直读, `setDisplayFlag` 翻转 + localStorage (`osu-editor:display-settings`) 持久化。
  - `skin.ts`: Skin 接口 + `comboColors`/`sliderBorder`/`sliderTrackOverride` (程序化回退 `[]`/null/null); 新增 `parseSkinIniColours` 解析 skin.ini `[Colours]` 段 (Combo1..8 跳号按编号排序转 '#rrggbb', SliderBorder/SliderTrackOverride); applySkinFromDir 内 skin.ini 文本改共享读取 `iniTextP` (AnimationFramerate 与 [Colours] 共用, 不再重复读文件)。
  - `renderer.ts`: `comboColor(bm, combo, override?)` 加可选第三参 (皮肤色优先, 向后兼容); 新增 `sliderBodyColors` (开皮肤颜色时 skin.ini border/track 优先, 未定义回退谱面); drawSlider 画 body 后 `sliderPathLine` 开时沿 path.points 画 2px 白细实线 (alpha 0.45); drawApproach 开头 `!approachCircle` 直接 return; bodyCache key 本含 border/track, 换色自动失效。
  - `lifecycle.ts` alphaAt: 结束判定后两分支 — 关滑条渐出时 slider 结束立即 0, 关点击特效时 circle 命中立即 0 (结束前行为不变; spinner 不受影响)。
  - `Timelines.tsx`: 时间轴物件 combo 染色同步皮肤颜色开关 (getSkin().comboColors override)。
  - `store.ts`: `displayPanelOpen`/`setDisplayPanelOpen`/`setDisplayFlag` (转发 displaySettings setter + emitSelection)。
  - 新增 `src/components/DisplayPanel.tsx` (仿 GeoSnapPanel 开关行, DraggableDialog); `App.tsx` 页签栏右侧 flex-1 撑开 + 「👁 显示设置」按钮, 面板挂载。
- 验证: verifier/v132 (tests.ts 32 项纯函数断言: 默认值/翻转/[Colours] 解析含跳号与缺段/comboColor override/alphaAt 两开关分支互不串扰; check.mjs 源码接线断言 24 项)。
- 回归适配: v31 check (Timelines 染色行第三参 override → 断言放宽为前缀匹配)。
- 回归: `npx tsc -b --force` + v1-v131 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v133 — 视觉间距辅助线滑条轮廓修复: 折线 miter 偏移 → 描边环带法 (精确等距)
- 需求: 滑条的视觉间距辅助线不对, 没有正确计算各种类型滑条边缘外扩对应距离。
- 根因: v126 用 `offsetPolyline` (顶点法线 = 相邻段法线平均 + miter 补偿限幅 3 倍) 画路径双侧轮廓。顶点法线 miter 只在采样点法线方向上恰好等距: 曲率半径 < 偏移量的内弯处偏移折线自交产生尖刺/回折 (限幅仅缓解), 急弯/回头段退化处理也只是近似 — 贝塞尔/完美圆弧等曲线滑条的等距轮廓普遍不准。
- 修复 (`renderer.ts` 新增 `drawDistanceGuideRing`, 与 drawSliderBodyOutline 同离屏模式): 粗描边 (半径 distR + w/2, lineJoin/lineCap = round) 后 destination-out 镂空 粗描边 (半径 distR - w/2, 下限 0.001 保护), 留下宽度 w 的环带, 中心线距路径恒为 distR。canvas 圆角 join/cap 粗描边区域 = 路径与半径 R 圆盘的 Minkowski 和, 对直线/贝塞尔/完美圆弧/急弯任意滑条类型都是精确等距轮廓; 内弯自动裁剪, 端帽自动为半圆 (v126 手绘头尾半圆端帽移除)。代价: 环带实心 (虚线无法沿环带边缘)。
- 附带修复 (`EditorCanvas.tsx`): 间距辅助线随堆叠偏移平移 (g.translate + 圆环 o.x+dx/o.y+dy, 与物件显示位置对齐; 此前画在堆叠前坐标); 滑条环带金色实心 rgba(242,181,68,0.8) 宽 1.5 osu px, 单点保持金色虚线圆环。
- `geometryHelpers.offsetPolyline` 保留 (v126 纯函数测试仍用), 注释标注已被描边环带法取代、不再用于渲染。
- 验证: verifier/v133 (check.mjs 15 项源码接线断言: 环带导出/圆角 join cap/双描边半径/变换沿用/离屏复用/堆叠偏移/offsetPolyline 移除)。
- 回归适配: v126 check (offsetPolyline 双侧轮廓/头尾半圆端帽/单点圆环坐标断言 → 环带法 + 堆叠偏移新断言)。
- 回归: `npx tsc -b --force` + v1-v133 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v134 — 视觉间距辅助线支持吸附 (物件边缘贴金色环带)
- 需求: 视觉间距辅助线没有吸附效果 (v126 原设计为仅显示)。
- 实现:
  - `geometryHelpers.ts` 新增 `distGuideSnap(p, distR, dragR, circles, paths)` 纯函数: snap 目标 = 源轮廓外扩 (distR + dragR) 的等距曲线 — 单点源为圆环 (径向投射), 滑条源为路径等距曲线 (沿最近点法向投射; 折线最近点含端点, 端帽半圆自然覆盖); 阈值 OBJECT_SNAP_RADIUS (6.4 osu px, 同物件/几何辅助吸附); 长路径段包围盒早退 (性能); 语义 = 被拖/放置物件边缘恰好贴上环带 (两物件边缘间距 = geoDistValue)。
  - `EditorCanvas.tsx` 新增 `geoDistSnap(bm, p, exclude)`: 与渲染同一来源 (geoDistSources/geoScope/geoEnabled 总开关 — 所见即所吸), 含堆叠偏移, exclude 拖拽中物件防自锁 (同 geoSnap)。
  - `snapWithGeo` 改漏斗形式: 物件吸附 / 几何辅助吸附 / 间距辅助线吸附三者取更近者 — 放置 (snapPlacement)、节点拖拽、原点拖拽全部生效; 物件移动拖拽链在 geoDragCorrection 后追加第三级 `q => geoDistSnap(bm, q, store.selected)` (corrDist 传递比较, 更近者胜; 顺带修正 v91 链路应用 gc 后未更新 corrDist 的近似)。
  - `GeoSnapPanel.tsx`: 开关行与页脚描述同步 ("边缘吸附到环带, 间距恰为设定距离"; 移除"仅显示, 不参与吸附")。
- 验证: verifier/v134 (tests.ts 11 项纯函数断言: 单点内/外侧径向投射、阈值边界、多源取近、滑条中段法向投射、端帽等距、路径上除零保护、空来源; check.mjs 14 项源码接线断言)。
- 回归适配: v96 check (snapWithGeo 透传 exclude 断言 → 漏斗数组形式)。
- 回归: `npx tsc -b --force` + v1-v133 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v135 — 上方时间轴右侧加「关闭波形/频谱」按钮
- 需求: 给上方时间轴加一个关闭波形图/频谱图的按钮 (此前只能从左侧栏「波形」开关关闭)。
- 实现 (`Timelines.tsx`): 时间轴右侧按钮组 (z-10 浮层) 的 wavePanelOpen 条件块内, 「波形图/频谱图」「背景/上层」之后加 `data-wave="close"` ✕ 按钮, 点击调 `store.setWavePanelOpen(false)` — 与左侧栏「波形」开关同一状态 (localStorage 记忆), hover 变红提示关闭语义。
- 验证: verifier/v135 (check.mjs 4 项: 按钮存在/同一状态/条件块内顺序/z-10 保持)。
- 回归: `npx tsc -b --force` + v1-v134 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v136 — 修复「废弃改动」无效: 弹窗确认后动作重入 guardUnsaved 被二次拦截
- 现象: 切换至另一个难度时, 在"未保存的改动"窗口中点击「废弃改动」没有任何效果 (弹窗看似不关/重开, 难度不切换)。
- 根因: 切难度 (electronMenu.openServerDifficulty)、曲库开难度 (SongLibrary.openDiff)、拖入文件 (App.importFiles ×2) 的流程第一行都是 `guardUnsaved(重入动作)`。点「废弃改动」`resolvePendingAction(true)` 执行该重入动作 → 重入 `guardUnsaved` → 脏标记仍在 (dirty 仅在 load/save 成功时清) → 再次拦截, pendingAction 重设, 弹窗重开 — 用户看来就是"点击没效果"。(关窗流程的 pendingAction 是直接 confirmClose 不重入守卫, 本不受影响。)
- 修复 (`store.ts`): 新增 `bypassUnsavedOnce` 一次性放行标记 — `resolvePendingAction(true)` 先清 pendingAction (弹窗立即关), 再在标记下同步执行动作: 重入 `guardUnsaved` 首行消费标记直接放行, 难度正常切换; `try/finally` 保证动作未走 guard 时标记不外泄 (不会意外放行下一次拦截)。「保存并继续」路径 save() 本已清脏, 行为不变; 动作中途失败时脏标记保留, 仍可 Ctrl+S 手动保存。
- 验证: verifier/v136 (check.mjs 9 项: 标记存在/bypass 在脏检查前/resolve 置位+finally 消费/先清 pendingAction/三个重入拦截点仍在)。
- 回归适配: v120 check (guardUnsaved 放行断言窗口 120 → 600 字符, 容纳前置 bypass 块)。
- 回归: `npx tsc -b --force` + v1-v135 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v137 — 上方时间轴暗化层: 波形下层暗化波形 / 波形上层暗化内容 (同一层半透明暗色)
- 需求: 波形显示在上层时, 物件和红绿线等元素需要暗化 (放一层半透明的暗色控件) 并显示在下层; 波形显示在下层时, 波形需要暗化 (还是之前那一层半透明的暗色控件)。
- 实现 (`Timelines.tsx`): 新增 `drawDimOverlay` (rgba(8,8,12,0.5) 全时间轴覆盖, css px 坐标系 — drawWaveLayer 结束后已复位, 直接接着画即可)。背景模式: `drawWaveLayer → drawDimOverlay` (波形暗化, 后画的时间轴内容保持正常亮度); 上层模式: 时间轴内容全部画完 (当前时间针之后) `drawDimOverlay → drawWaveLayer` (内容暗化, 波形全亮最上层)。两种模式用同一层暗色, 波形与内容的相对层级不变。
- 验证: verifier/v137 (check.mjs 8 项: 共用暗化层/颜色/全覆盖/背景模式顺序/上层模式顺序/上层在时间针之后)。
- 回归适配: v127 check (两分支单行 drawWaveLayer → 带 drawDimOverlay 的块形式, 层级断言同步)。
- 回归: `npx tsc -b --force` + v1-v136 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v138 — 波形上层模式修复: 离屏合成, 下层时间轴内容透出 (半透明底)
- 现象: 波形位于上层时, 看不到下层的物件、绿线等原上方时间轴内容; 期望波形在上层是半透明背景, 类似之前的独立波形图窗口。
- 根因: `drawWave`/`drawSpectro` 内部 `setTransform(identity) + clearRect(W,H)` (v105 独立窗口设计: 半透明底需每帧清帧防 source-over 累积)。v127 移入时间轴后, 上层模式直接画主画布时 clearRect 把已画好的时间轴内容 (物件/红绿线/v137 暗化层) 整片抹成透明 — 下层内容不是被遮住, 是被擦除了。
- 修复 (`Timelines.tsx`): `drawWaveLayer` 加 `onTop` 参数 — 上层模式先画到离屏画布 `waveTopScratchRef` (clearRect 只清离屏), 再 `drawImage` 整体贴回主画布; 波形半透明底 (WAVE_BG 0.55 / 频谱 SPECTRO_BG_ALPHA 140) 透出下层经 v137 暗化层压暗的物件/红绿线, 观感 = 旧独立波形窗口。背景模式下方无内容, 保持直接画 (clearRect 无害, 行为不变)。
- 验证: verifier/v138 (check.mjs 10 项: onTop 参数/离屏 ref/离屏绘制+贴回/两调用点/半透明底保留)。
- 回归适配: v127/v137 check (上层分支断言兼容 `, true` 参数)。
- 回归: `npx tsc -b --force` + v1-v137 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v139 — 间距辅助线吸附语义修正: 参考点直接吸到「可见环带」(WYSIWYG)
- 现象: v134 实现吸附后, 用户反馈视觉间距辅助线对放置/移动物件仍然没有吸附效果。
- 根因: v134 采用"物件边缘贴环带"语义 — snap 目标 = distR + dragR (源轮廓外扩 distR 后再外扩一个被拖物件半径)。吸附带位于可见金色环带外侧一个物件半径处 (CS4 ≈ 36 osu px); 用户自然地把物件中心拖到金线上, 光标距吸附带恰有一个半径远, 永不触发 — 表现就是"没有吸附"。
- 修复: `distGuideSnap` 目标改为 distR (= 绘制的环带中心线, 去掉 dragR 参数) — 参考点 (物件头/尾中心, 即光标持点) 直接吸附到画出来的那条线, 所见即所吸。吸附来源/阈值 (6.4px)/防自锁/漏斗与拖拽链接线全部不变。
- 文案同步: GeoSnapPanel 开关行与页脚改为"物件中心吸附到环带线" (移除"边缘贴环带"描述); EditorCanvas 注释同步。
- 验证: verifier/v139 (check.mjs 7 项变更点断言: 目标=distR/dragR 移除/调用点/文案); verifier/v134 tests.ts 纯函数断言按新语义重写 (target=60: 单点内外侧径向投射/阈值边界/多源取近/滑条法向/端帽等距/除零保护)。
- 回归适配: v134 check (语义断言更新为 distR 目标 + 去 dragR; 注释提及用分号区分代码)。
- 回归: `npx tsc -b --force` + v1-v138 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v140 — 脏标记按内容指纹判断: 无实际改动/撤销回保存态不显示未保存
- 现象: 没有实际改动物件/timing (或者撤销了) 的情况下, 仍显示为未保存。
- 根因: v120 在 `pushUndo` 统一埋点 `setDirty(true)` — 只要执行过操作就置脏, 不区分操作是否真的改了内容; 撤销回保存态也不会清 (dirty 仅 load/save 时清)。
- 修复:
  - 新增 `src/osu/dirtyFingerprint.ts` (纯函数): 谱面内容指纹 = 六段数据 (hitObjects/timingPoints/difficulty/editor/general/metadata, 与 snapshot() 同范围) 的 JSON 序列化; 选择集/播放时间等非数据状态不参与。
  - `store.ts`: `savedFingerprint` (load/save 成功时更新基准) + `refreshDirty()` (当前指纹 !== 基准 => 脏), 挂 `emit()` 漏斗 — 所有数据变更路径 (离散操作/undo/redo/拖拽提交) 都会经过; `pushUndo` 不再盲置脏 (pushUndo 发生在变更前, 本就无法判断是否真有改动)。undo 回保存态 → 指纹一致 → 指示器消失; redo → 重新变脏; 操作结果与原状相同 → 不脏。附带修正: 书签/timelineZoom 等 [Editor] 段变更现在也会正确置脏 (此前不经 pushUndo 永不脏)。
- 验证: verifier/v140 (tests.ts 9 项纯函数断言: 幂等/深拷贝一致/物件 timing 难度 书签改动检测/改回原值归位; check.mjs 10 项源码接线断言)。
- 回归适配: v120 check (pushUndo 置脏断言 → v140 不再盲置脏), v121 check (置脏断言 → refreshDirty)。
- 回归: `npx tsc -b --force` + v1-v139 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v141 — 废弃 曲线互转/拖文件开谱面, 新增 三点圆弧→贝塞尔
- 需求: 废弃「贝塞尔→卡特姆」「卡特姆→贝塞尔」「拖文件进窗口打开谱面」三个功能 (用不到), 补充三点圆弧滑条转贝塞尔滑条的按钮。
- 废弃曲线互转 (v39 F4 引入): 删除 `convert/CurveDialog.tsx` (B→C 采样参数窗) 与 `convert/curveConvert.ts` (catmullToBezierSlider/bezierToCatmullSlider 无其他引用); Inspector 移除 `data-conv-apply="c2b"` / `data-conv-open="curve"` 两按钮; App.tsx 移除 CurveDialog import 与挂载; store `conversionDialog` 联合类型去掉 curve 项。bezierPath.ts 的 `catmullToBezier` 保留 (sliderToBezierSegments 的 C 分支在用)。
- 废弃拖文件开谱面 (`App.tsx`): 删除整个 `importFiles` (.osz 解压打开 / .osu+同批音频背景 / 单独补音频背景三分支, 含两处 v120 guardUnsaved 拦截)、根 div 的 onDragOver/onDragLeave/onDrop 与 dragOver 遮罩, 连带清理孤儿 import (parseOsu/invalidatePath/SAMPLE_FILE_RE)。开谱面入口保留曲库 openDiff 与菜单 openServerDifficulty。
- 新增 圆弧→贝塞尔 (`Inspector.tsx` SliderConvertButtons): 选区含 P 滑条时显示 `data-conv-apply="p2b"` 按钮, 无参数不弹窗 — `sliderToBezierSegments` (P 型三点步进 circleToBezier, ≤90° 分块 k=4/3·tan(θ/4) 近似, 误差 <0.03%) → `segmentsToPoints` (段接缝重复点红锚点) → `{ ...o, id: genId(), curveType: 'B', curvePoints: pts.slice(1) }` (浮点不取整), `applyConversion(selP.map(o=>o.id), out)` 一次 undo; 只动 P 滑条, 其他选中物件不进 removeIds。转连打/合并为滑条按钮不动。
- 验证: verifier/v141 (tests.ts 11 项纯函数断言: 三点弧形状偏差 <0.5px/端点不变/过中间点/5 点两段接缝红锚点/退化 2 点转直线/字段保留/纯函数不改原物件; check.mjs 25 项源码接线断言: 三功能移除 + p2b 接线 + bezierPath 复用件完好)。
- 回归适配: v39 check/tests (曲线互转三节断言与 C↔B 纯函数测试随功能废弃移除, sliderPath catmull 端点断言保留), v36 check (conversionDialog 联合类型断言去 curve 项), v85 check (DraggableDialog 用户列表去 CurveDialog), v120 check (拖入 .osz/.osu 两处拦截断言移除), v136 check (同)。
- 回归: `npx tsc -b --force` + v1-v140 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v142 — 上方时间轴: 滑条中段可选中+拖动, 折返点显示与滑条尾同款圆圈
- 需求: ① 上方时间轴的滑条中段也需要能选中、拖动滑条; ② 滑条折返也需要显示和滑条尾一样的圆圈。
- ① 中段选中+拖动 (`Timelines.tsx` mousedown): 头/尾圆命中落空后、绿线药丸/框选前新增连体条中段分支 (复用 v80 纯函数 `timelineBarHit`, 限物件行 y<=OBJ_H) — 命中即与圆命中同款: Shift/Ctrl 加选减选/单选, 非锁定物件时准备 `markerDragRef` (anchorId=barId, 吸附节拍拖动多选同 delta 跟随, 一次 undo)。命中优先级: 尾端 resize > 头/尾圆 > 中段 > 绿线药丸 > 框选。框选不再能从条上起手, 但 v102 全高度起手保持 — 物件行空白处与行下方任意高度仍可框选 (v50 "长滑条条占满行导致框选进不去"的教训由全高度框选化解); timelineHit.ts 注释同步。v115 锁定物件语义保持: 可选中不可拖; v80 mouseup 单击兜底与右键删除兜底不动。
- ② 折返点圆圈 (`drawTimelineObject`): 每个 repeat 节点先画与滑条尾同款的圆 (st.fill 填充 + 沿用条样式的描边环), 皮肤 reversearrow 画在圆圈上指示方向 (奇数节点朝左/偶数朝右, v98 语义保留) — 真实物件与放置预览幻影共用入口, 两处同时生效。
- 验证: verifier/v142 (check.mjs 17 项源码断言: 折返圆填充/描边/箭头在上/贴图保留; 中段 barHit/物件行限制/markerDrag 预备/加选/优先级顺序/锁定语义/旧路径保留; timelineHit 注释同步)。
- 回归适配: 无 (v50/v79/v80/v98/v102 旧断言全部兼容)。
- 回归: `npx tsc -b --force` + v1-v141 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v143 — followpoint 序列帧默认帧时长修正: 1000/帧数 (皮肤亮灭节奏恢复, 连线不再断裂)
- 现象: 皮肤 "a(No hitsound)" 的 followpoint 显示异常 — 本该连接滑条尾到下一物件的连线断裂, 只剩零星可见段。
- 根因: 该皮肤 followpoint-0..9.png 共 10 帧, 仅帧 4-6 是箭头 (116x4 横线), 帧 0-3/7-9 为 1x1 空白占位 — 皮肤常用的亮灭节奏控制法, 依赖"整组帧 1 秒一轮"的默认帧时长。v131 把无 skin.ini AnimationFramerate 时的默认帧时长从 1000/帧数 改成 1000/60 (误读 lazer SIXTY_FRAME_TIME 注释) — 亮灭加快 6 倍 (周期 166.7ms, 可见窗 50ms), 相邻 follow point 的帧相位差 (~50ms 级) 超过可见窗, 静态时刻只剩 ~30% 点可见 → 连线看似断裂。
- 依据 (lazer `LegacySkinExtensions.getFrameLength`): `applyConfigFrameRate=true` (followpoint 的调用方式) 且 ini 无 AnimationFramerate 时默认帧时长 = `1000 / textures.Length` (整组 1 秒一轮); SIXTY_FRAME_TIME 仅用于 `applyConfigFrameRate=false` 的路径。
- 修复 (`skin.ts`): `followpointFrameMs` 默认 `1000 / 60` → `1000 / frames.length`; ini `AnimationFramerate > 0` 时 `1000 / rate` 不变; 序列帧优先通道/渲染按帧选图/animStart 语义全部不变。
- 验证: verifier/v143 (check.mjs 10 项: 默认 1000/帧数/SIXTY_FRAME_TIME 移除/lazer 依据注释/通道与渲染逻辑不变)。
- 回归适配: v131 check (默认帧率断言 1000/60 → 1000/帧数, 即恢复 v47 语义), v47 check (同; v47 CDP 的 frameMs=100 断言本就是 1000/10, 无需改动)。
- 回归: `npx tsc -b --force` + v1-v142 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v144 — 缩圈按物件颜色染色 + 音量设置 (主/歌曲/音效三级)
- 需求: ① 缩圈也需要按物件颜色染色; ② 显示设置按钮左边加个音量设置, 支持分别调整主音量、歌曲音量、音效音量。
- ① 缩圈染色 (`renderer.ts`): `drawApproach` 加 `color` 参数, 贴图改 `tintedSprite(skin.approachcircle, color)` (与 hitcircle 同款 multiply 乘算, WeakMap 缓存) — 单点与滑条头两个调用点均传 combo 色 (v132 皮肤颜色开关同源); spinner 缩圈 (spinnerApproach) 不动。
- ② 音量设置:
  - 新增 `volumeSettings.ts` (纯数据层, 仿 displaySettings): master/music/effects 三字段 (0-100 钳制取整), localStorage 'osu-editor:volume-settings' 持久化; `musicGain() = 主×歌曲`, `effectsGain() = 主×音效`。
  - `store.ts`: 新增音乐总线 `ensureMusicBus()` — 常速 source 与变速 tempoNode 统一经此进 destination (增益 = musicGain); hitsound 总线增益 = `HITSOUND_BUS_GAIN × effectsGain()` (v101 余量保留, 单点/滑条/循环音全覆盖); 兜底 `<audio>` 设 `volume = musicGain()`。`setVolume()` 持久化 + `applyVolumeBuses()` 同步现存总线 + emitSelection; `volumePanelOpen` 面板开关。
  - `VolumePanel.tsx` (新, DraggableDialog 仿 DisplayPanel): 三条 range 滑条 + 百分比显示; App.tsx 页签栏「显示设置」左侧加 🔊 音量 按钮并挂载面板。
- 验证: verifier/v144 (tests.ts 13 项纯函数断言: 默认/主音量对两路/歌曲只影响音乐/音效只影响音效/静音/上下限钳制/取整; check.mjs 22 项源码接线断言)。
- 回归适配: v101 check (直连 destination 断言 1 处 → 2 处: v144 新增音乐总线 ensureMusicBus)。
- 回归: `npx tsc -b --force` + v1-v143 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v145 — 锁定间距修复 (放置/拖动) + 间距面板实时更新
- 需求: ① 锁定间距对拖动/放置生效 (参考 osu!lazer CircularDistanceSnapGrid: 以前件结束位置为圆心、期望距离为半径的圆投影);
        ② 间距面板 (SelectionInfoPanel) 在拖动物件/预览放置时实时更新。
- 修复 (EditorCanvas.tsx):
  - snapPlacement 原用 `(o.endTime ?? o.time)` 找参考件/算间隔拍数 — 滑条 endTime 字段恒 undefined, 长滑条结束时刻被当开始时刻,
    期望距离算错; 现复用 spacing.ts 共享纯函数 distanceLockRef (结束时刻 = hitObjectEndTime, 结束位置按折返奇偶取滑条头/尾)。
  - 锁定间距指示线原从 prev.x/prev.y (滑条头) 画线, 现从参考件结束位置 (滑条尾端) 画。
  - 滑条头部放置原只走 gridSnapAt(snapWithGeo(...)) 完全不经 snapPlacement, 锁定间距不生效; 现 isHead 时走 snapPlacement
    (物件吸附 > 锁定间距 > 网格), 第二个起的控制点维持原规则不走锁定间距。
  - 拖动分支新增锁定间距: 锚 = 被拖首件头, 参考件排除被拖集合, 投影到期望距离圆 (多选整体同 delta);
    顺序 = 物件/几何/间距辅助吸附 < 锁定间距投影 < 网格吸附 (网格最后覆盖, 与 lazer TryMoveBlueprints 一致)。
- 面板实时更新:
  - EditorCanvas 拖动分支原地改坐标不经 emit, React 面板不刷新 — 拖动末尾 `if (d.moved) store.emitSelection();`。
  - store 新增 placementPreview + setPlacementPreview (圆整整数 px, 相同值不重复 emit 防重渲染风暴);
    EditorCanvas onMouseMove 在 圆圈工具/滑条无锚点 且 非拖拽非播放 且 光标在区内 时写 snapPlacement 结果 (所见即所得),
    onMouseLeave 置空; SelectionInfoPanel 无选区时显示预览 Prev 间距 (Next 显示 —)。
- 验证: verifier/v145 (tests.ts 15 项纯函数断言: 单点/滑条折返奇偶/exclude/滑条进行中不作参考/DS 公式/0.25 拍下限/预览圆整;
  check.mjs 28 项源码接线断言, 含 v45 公式与 v55 吸附优先顺序保持)。
- 回归: `npx tsc -b --force` + v1-v144 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v146 — 右侧栏变换面板输入框 (旋转角度/缩放倍率/自定义原点 x/y) 全选输入不失焦
- 根因: Btn/NumIn/TransformPanel 原定义为 Inspector 组件内部的组件, 每次重渲染 (如输入一个数字触发 setState)
  都会生成新的组件类型, React 卸载并重建整个子树 => 输入框 DOM 被替换 => 失焦。
  对照: 左侧栏网格间距输入 (App.tsx GridSpacingInput) 是模块顶层组件 + 局部文本态, 类型稳定故不失焦。
- 修复 (Inspector.tsx):
  - Btn/NumIn 提升为模块顶层组件 (纯 props 驱动, 类型稳定, 重渲染保留 DOM)。
  - NumIn 改局部文本态 (与 GridSpacingInput 同款): 输入过程不用数值覆盖文本 (可全选重输/输小数点/负号),
    合法值实时提交, 失焦还原。
  - TransformPanel 含大量闭包不便提升, 改以普通函数调用 {TransformPanel()} 渲染 (两处调用点),
    不再形成每渲染更换的 JSX 组件边界。
- 验证: verifier/v146 (check.mjs 19 项源码接线断言: 顶层定义位置/局部文本态三要素/函数调用渲染/testid 与旋转缩放原点接线保留)。
- 回归: `npx tsc -b --force` + v1-v145 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v147 — 显示设置新增「note 打击动画」开关 (关 = 命中后残留 800ms 渐隐不放大)
- 需求: 现有「note 点击特效」关 = 命中立即消失; 新增「打击动画」开关 — 关 = 命中后不播放变大动画,
  物件原大小残留 800ms 线性渐隐再消失 (osu!stable 编辑器 compose 界面同款表现)。
- 实现:
  - displaySettings.ts: 新增 hitAnimation (默认 true 维持旧行为, localStorage 持久化, 缺省 true)。
  - lifecycle.ts: 新增 HIT_LINGER=800; alphaAt 在 关打击动画+点击特效开 时按 800ms 线性渐隐;
    isVisibleAt 可见窗口同步延长到 800ms (否则 240ms 后物件被剔除看不到残留)。
    优先级: 点击特效关 = 立即消失 (判定在前), 打击动画仅在点击特效开时有意义; 滑条不受打击动画开关影响。
  - renderer.ts: hitFade (命中放大系数) 受 hitAnimation 门控, 关 = 不放大 (放大公式 1+hitFade*0.4 不变)。
  - DisplayPanel.tsx: 新开关行「note 打击动画 (Hit Animation)」, 排在点击特效之后。
- 验证: verifier/v147 (tests.ts 16 项纯函数断言: 默认 240ms 淡出/800ms 残留渐隐三点采样/可见窗口边界/
  滑条不受影响/点击特效优先级/还原; check.mjs 15 项源码接线断言)。
- 回归适配: v132 check (开关行数 5 → 6)。
- 回归: `npx tsc -b --force` + v1-v146 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v148 — 滑条 SV 修复: 红线不再重置 SV + 路径末端延长到 pixelLength (对照 lazer 源码)
- 现象: 本编辑器拉的滑条末节点恰好在滑条尾, 同一 .osu 在 osu!stable 中更长 (末节点明显早于尾)。
- 对照 lazer 源码确认两个问题:
  1. SV 被红线重置 (parser.timingAt 遇红线 green=null): lazer ControlPointInfo 中 TimingPoint 与
     DifficultyPoint (SliderVelocity) 分表独立二分查找, 红线【不】清除 SV。导致红线后所有滑条 SV 错误回退 1.0,
     放置长度吸附/endTime/tick 全部与 stable 不一致。
     注意 timingAt 的 green 清零是【采样语义】(stable 红/绿线都携带 sampleSet/volume, 最后一条线生效),
     hitsound 解析依赖, 保持不变; 故新增 svPointAt (只跟踪绿线) 供 SV 查询:
     parser.sliderVelocityAt/svMultiplierAt、patternLibrary.pxPerBeatAt/svAt、duplicate 局部 svAt 全部改用它。
  2. SliderPath 只截短不延长: lazer SliderPath.calculateLength 在 ExpectedDistance > 几何全长时
     沿末端切线线性延长 (例外: 路径末两点重合则不延长, stable 同款)。本编辑器此前 clamp,
     pixelLength > 几何长度的滑条 (stable 放置吸附向上取整/手改 length 都会产生) 显示偏短。
     修复: buildEvenSpacing 末端延长 (重合端点例外在 raw 上判定 — 重采样去重会抹掉重合点)。
- 回归适配 (旧断言编码的正是被修复的旧行为):
  - v69 tests: "不复制绿线 => 目标区 SV 1" 前提在修正语义下需显式 SV 复位绿线, 补 green(1600,-100)。
  - v75 tests: 未截断贝塞尔/截断弧两节原用 length=150(>几何) 与哨兵 100000, 改用 sliderGeometryLength 几何全长。
  - v141 tests: pathOf 原用哨兵 expectedLength=100000, 改用 sliderGeometryLength (不截短不延长)。
- 验证: verifier/v148 (tests.ts 17 项纯函数断言: svPointAt 红线不清除/边界/速度公式; 末端延长直线+折线/
  重合例外/截短不变/等长不动作; check.mjs 12 项源码接线断言)。
- 回归: `npx tsc -b --force` + v1-v147 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v149 — 锁定间距: 滑条拉满控件宽度 + 上限 10x + 间距随当前 SV (lazer DurationToDistance)
- 需求: ① 锁定间距滑条拉长, 滑条+输入框+文本填满控件宽度; ② 上限 3x → 10x; ③ 间距与当前 SV 挂钩, 对齐 lazer。
- 实现:
  - spacing.ts 新增 distanceSnapPxPerBeat(bm, refTime) = DS * 100 * SliderMultiplier * SV(refTime)
    (lazer EditorBeatmap.DurationToDistance 同源: distance = 100 * SM * SV * 拍数, 参考时刻 = 前件结束时刻);
    distanceLockDistance (放置/拖动期望距离) 与 spacingMultiplier (间距面板单位) 共用该基准, 自洽 1.00x;
    拍长按参考时刻红线 (lazer referenceTime), 0.25 拍下限保留 (v145)。
  - App.tsx 控件: label w-full + range flex-1 min-w-0 (原 w-16), 输入框 w-14 shrink-0; range/number max 3→10,
    数字输入钳制 0.1..10; 提示文案说明 1x 随 SV 变化。
- 回归适配 (旧断言编码旧单位 DS*100*拍数):
  - v45 tests: 间距节期望值除以 SM(1.4) (1.00x→0.714x 等), 注释说明。
  - v45 check: 倍率公式断言 → distanceSnapPxPerBeat(bm, fromEndTime) * beats。
  - v145 check: 期望距离/倍率公式断言 → distanceSnapPxPerBeat 版。
- 验证: verifier/v149 (tests.ts 10 项纯函数断言: SM/SV/叠加/参考时刻拍长/下限/面板单位/边界;
  check.mjs 13 项源码接线断言)。
- 回归: `npx tsc -b --force` + v1-v148 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v150 — altruism v1 hitcircle 偏小 (固有尺寸渲染) + 播放中无法点击皮肤面板
- 需求: ① 皮肤 altruism v1 (hitcircle.png 150px) 的 hitcircle 显示偏小; ② 播放音乐时无法点击皮肤窗口中的任意皮肤。
- 实现:
  - ① lazer LegacyMainCirclePiece: hitcircle 族贴图 AutoSize + WithMaximumSize(OBJECT_DIMENSIONS*2=256),
    按贴图像素 ÷ ScaleAdjust 固有尺寸显示, 不拉伸进 2r 盒子 (旧逻辑把 150px 贴图压回 128 盒子显得偏小)。
    skin.ts: INTRINSIC_SIZE_KEYS 集合 (hitcircle/overlay + sliderstart/endcircle 族 + sliderb) 在
    applySkinFromDir 登记固有宽度进 skinSpriteWidth; 新增 hitcircleSpriteWidth(img) = min(固有宽度, 256),
    未登记回退 128 (= 盒子, 默认皮肤/程序化回退行为不变)。
    renderer.ts: drawCircle (含命中缩放 scale) / drawSlider 头尾 / drawPendingSlider 头部改用固有尺寸;
    EditorCanvas 放置预览 (circle/slider 起点) 同步固有尺寸。
  - ② 根因: SkinListPanel 的 Row 是组件内定义组件 — 播放中 EditorCanvas 每帧 emitPlayback → App 60fps
    重渲染 → Row 组件类型每次渲染都变 → React 每帧重挂载按钮 → mousedown 后 mouseup 落在被卸载节点上,
    click 永不触发 (暂停时不重渲染所以能点)。修复: Row 提升为模块级组件, current/busy/onChoose 走 props。
- 回归适配: v131 check — sliderb 登记断言从 `key === 'sliderb'` 改为 INTRINSIC_SIZE_KEYS.has(key) 形式,
  并断言集合仍含 sliderb。
- 验证: verifier/v150 (tests.ts 8 项纯函数断言: 回退 128/150px/@2x ScaleAdjust/overlay 120/封顶 256/
  绘制尺寸换算; check.mjs 24 项源码接线断言)。
- 回归: `npx tsc -b --force` + v1-v149 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v151 — 左侧栏控件大小/布局调整
- 需求: 常用按钮放大, 不常用缩小: ① 曲库/皮肤半宽并排一行; ② 选择/单点/滑条/转盘扩一倍, 一行一个;
  ③ 网格吸附按钮与网格类型下拉各缩一半放一行; ④ 网格间距与旋转放一行。
- 实现 (App.tsx 左侧栏, 纯布局):
  - 曲库/皮肤包入 `flex gap-1.5`, 各 `flex-1 min-w-0`。
  - 工具按钮容器 `grid grid-cols-2` → `flex flex-col`, 按钮 `w-full text-left` (原半宽 px-2)。
  - 网格吸附按钮 + 类型下拉包入 `flex gap-1.5`, 各 `flex-1 min-w-0`; 间距与旋转合并为一个 flex 行
    (旋转输入 data-grid-input="rotation" 等行为属性不变)。
- 验证: verifier/v151 (check.mjs 17 项源码结构断言; 纯布局无纯函数 tests.ts)。
- 回归: `npx tsc -b --force` + v1-v150 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v152 — timing/song setup 页签上下时间轴不随播放滚动
- 需求: timing 与 song setup 页签中, 上/下时间轴在歌曲播放时不滚动。
- 根因: 播放位置推进 (store.currentTime = store.positionMs()) 只在 EditorCanvas 的 rAF 循环里做,
  而 EditorCanvas 仅 edit 页签挂载; 其他页签里 currentTime 冻结, 时间轴虽有自有 rAF 重绘但读的是旧值
  (positionMs 内的 hitsound 排程/滑条循环音在这些页签同样不走)。
- 实现: 全页签常驻的 TopTimeline rAF 循环开头兜底推进 — 每帧 store.tickClock() (暂停中相位跟踪,
  与 EditorCanvas 一致) + 播放中 store.currentTime = store.positionMs() + 播完自停;
  edit 页签与 EditorCanvas 双泵推进同值, 幂等无害 (排程器/循环音均为游标式, 二次调用自然跳过)。
- 验证: verifier/v152 (check.mjs 12 项源码接线断言: 泵存在/播完自停/时间轴全页签常驻/EditorCanvas 原泵保留)。
- 回归: `npx tsc -b --force` + v1-v151 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v153 — 快捷键 V: 跳转到最后一个物件的时间位置
- 需求: 按 V 跳转到最后一个物件的时间位置。
- 实现 (App.tsx 键盘处理, 无修饰键块内, 与 Q/W/E/R/J/K 同块): `store.seek(Math.max(...bm.hitObjects.map(o => o.time)))`
  (取最大 time, 不假定 hitObjects 有序); 无谱面/无物件不动作; 输入框聚焦与曲库/皮肤面板打开时守卫不触发 (既有);
  右栏快捷键帮助列表补 "V 跳到最后一个物件" 条目。
- 验证: verifier/v153 (check.mjs 6 项源码接线断言)。
- 回归: `npx tsc -b --force` + v1-v152 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v154 — 点击重叠物件优先选中离当前时间最近者
- 需求: 点击重叠的物件时, 优先选中离当前时间最近的物件。
- 根因: EditorCanvas hitTest 倒序遍历返回首个命中 — 重叠时恒选"数组靠后 (= 绘制上层)"的物件, 与当前时间无关。
- 实现: 新增纯函数 src/osu/hitPick.ts pickTimeNearestHit(hits, currentTime) — |time - currentTime| 最小者胜,
  时间差相同取数组靠后者 (上层, 与旧同刻堆叠行为一致); hitTest 改为正序收集全部命中后走挑选,
  命中几何 (滑条路径点 r / 转盘中心 170 / 单点 r*1.1) 与可见性过滤 (isVisibleAt) 不变。
- 验证: verifier/v154 (tests.ts 7 项纯函数断言: 空/单命中/近者优先/等距取上层/同刻堆叠/三重叠;
  check.mjs 11 项源码接线断言)。
- 回归: `npx tsc -b --force` + v1-v153 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v155**: 下方时间轴重构为 osu!stable 样式 + 书签。红/绿线=全高 timing 竖线; 蓝线=[Editor] Bookmarks (parser 解析/序列化条件写出, Ctrl+B 当前位置添加, Ctrl+Shift+B 删除 500ms 阈值内最近书签, store.addBookmark/removeBookmarkNear 带 undo); kiai 绿线区间橙色填充; 黄线=PreviewTime; 物件粉线改粉点 (arc); 左侧新增当前时间+百分比块 (data-bottom-time), 原右侧时间 span 删除。tests.ts 4 组 Bookmarks 解析/序列化 round-trip 纯函数测试 + check.mjs 源码断言。
- **v156**: 原生顶层 Timing 菜单 (仿 osu!stable, 无死菜单项全接线)。节拍类型 radio (2/4~7/4, 勾选当前生效红线拍号)、节拍器 checkbox (store.metronome + tickMetronome lookahead 250ms, 首拍 hitwhistle 全量/其余 hitnormal 七成, 走 hitsound 总线计并发)、添加红线 Ctrl+P / 绿线 Ctrl+Shift+P、重置当前区间、删除Timing区间 Ctrl+I、重新对齐当前区间 (snapTimeToRedBeat 按 beatSnap)、Timing设置 F6 (→timing 页签)、全部重新对齐、整体平移所有物件时间 (模块级 ShiftAllDialog, 见 v150 教训)、重新计算滑条长度 (resnapSliderLength)、删除所有Timing区间、设为预览点。渲染进程经 timing-menu-state 上报勾选状态 (值变化才发)。tests.ts 测 activePointAt/snapTimeToRedBeat/metronomeBeats + check.mjs 断言 bridge/preload/main/路由全链。**适配**: v101 出声点计数 2→3 (节拍器新增 ensureHitBus+trackVoice 一处)。
- **v157**: timing 窗口 All/红线/绿线页签过滤 (i 保持全局索引, updateTp/滚动定位不受影响) + 绿线行首 checkbox 多选 (与上时间轴药丸选区共享 store.selectedGreenLines) + 批量编辑栏 (SV/音效集/序号/音量/kiai 即时应用到所有选中线, 一次 undo) + 删除所选。store 新增 toggleGreenLineSelected/updateGreenLinesAt。check.mjs 纯源码断言。
- 回归: `npx tsc -b --force` + v1-v157 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v158**: 下方时间轴进一步对齐 osu!stable — 新增每拍节拍刻度 (底部短刻度, 小节首拍按 meter 加长加亮, 绘制于 kiai 橙区之上/timing 线之下), 移除原 5 秒刻度与数字标签; 播放头改白色 2px 竖线并去掉粉色已过区域填充; 物件粉点加亮至 0.9/半径 3。新增 ↑/↓ 跳到前/后一条书签 (App.tsx, Ctrl+↑/↓ 的选区逐 px 移动不受影响), 快捷键帮助补条目。**适配**: v155 粉点透明度断言 0.7→0.9。
- 回归: `npx tsc -b --force` + v1-v158 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v159**: 下方时间轴 stable 布局精调 — 新增水平中线 (全宽 1px); 物件粉点半径 1 且落在中线上; 红/绿 timing 线只画上半 (0~mid); 书签蓝线只画下半 (mid~height); 预览点黄线全高; kiai 橙区改半高 (上半, 不再占满)。**适配**: v158 粉点半径断言 3→1 (落中线), 节拍刻度层序断言针串随注释改名更新。
- 回归: `npx tsc -b --force` + v1-v159 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v160**: 滑条长度始终 ≤ 末控制点位置 (几何全长), 对齐 lazer 编辑器规则 (本地源码): SliderPlacementBlueprint.updateSlider / SliderPathExtensions.SnapTo — ExpectedDistance = FindSnappedDistance(Path.CalculatedDistance), 吸附源即几何全长; ComposerDistanceSnapProvider.FindSnappedDistance 超 1ms 行程退一格 (GetBeatLengthAtTime = beatLength/divisor, 与本工程 tick 回退等价)。改动: ① snapSliderLength 末尾硬钳 — 1ms 容差内保留 tick 数意图但返回值 floor 到几何全长 (round 会回超); ② placementLength 锁定间距分支原 Math.round 直接向上入 (可超几何近半拍, 触发 v148 末端切线延长), 现超 1ms 退一拍 + min(..., geoCap=floor(geo)); 非锁定分支同样 min(..., geoCap); 20px 下限让位于几何钳制 (几何 <20 时取几何)。渲染端 v148 末端切线延长保留 (lazer calculateLength 对旧谱面 pixelLength>path 的 stable 兼容, 末两点重合不延长)。**适配**: v26 (174.9→174, 下限 tick 超几何改钳几何), v82/v83/v95 (锁定 160→退一拍 100, 长度 0→1px, 源码断言随新写法), v117 (边缘提示文案被并行任务更新, 断言跟随)。
- 回归: `npx tsc -b --force` + v1-v160 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v161**: 下方时间轴微调 — 红/绿/蓝/黄线统一 1px (原 2px); kiai 橙区垂直居中于中线 (y=mid/2 高=mid, 中心恰在中线上)。白色播放头 2px、中线 1px 不动。**适配**: v155 黄线断言 2→1px; v159 红/绿/蓝/黄线宽断言 2→1px + kiai 位置断言 0→mid/2。
- 回归: `npx tsc -b --force` + v1-v161 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v162**: 上方时间轴同刻物件按文件顺序从下往上堆叠 (level 0 = 文件靠前 = 最下)。timelineHit.ts 新增纯函数 stackInfo (按 time 分组计数) / stackLayout (count>1 时半径随件数缩小 — 2 件 23/3 件 18/下限 4, 层距 ≤10px, 最下贴行底); timelineMarkerHit/timelineBarHit 加可选 py+geom 参数 — geom 仅对堆叠件返回 {y,rad} 走 2D 命中, 非堆叠 undefined 保持旧 x-only/全行 y 行为 (向后兼容, 旧 7 参调用不变)。渲染 drawTimelineObject 按堆叠 y/rad; 命中 4 处 (markerHit/滑条尾端/barHit x3 单击兜底+mousedown+右键) 全部跟随堆叠位置。**适配**: v50/v79 (阈值断言改按件半径 or+3, markerHit 调用签名), v83/v127 (drawTimelineObject 参数 cy,RAD→lay.yOf/lay.rad), v142 (markerHit 调用签名)。
- 回归: `npx tsc -b --force` + v1-v162 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v163**: 左侧栏"网格中心"下方新增「▣ 限制物件在游玩区内」开关 (data-grid-input="limit-playfield"), 默认开启 = 既有行为。store.limitToPlayfield + setLimitToPlayfield; snapToGrid 加可选第 6 参 clampToPlayfield (默认 true 保持旧行为, false 时跳过 PW/PH 钳制)。EditorCanvas 四处接线: ① gridSnapAt 传开关 (网格吸附随之放开); ② 放置锁定间距分支关闭后不钳制; ③ 拖动钳制 x/y 随开关; ④ 放置预览门控 inside || !limitToPlayfield (关闭后区外也显示幻影/预览)。tests.ts: snapToGrid 默认钳制/不钳制/区内不变/none 原样 共 8 断言。**适配**: v145 (放置预览区外置空断言改 (inside || !limitToPlayfield))。
- 回归: `npx tsc -b --force` + v1-v163 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v164**: 修复曲库窗口在搜索框内按下鼠标拖选文本、移出窗口松开时误关闭。根因: 遮罩裸用 onClick={onClose}, mousedown 在输入框/mouseup 在遮罩时 click 事件落到共同祖先(遮罩)触发关闭。改为 backdropDownRef 记录 mousedown 落点, mouseup 时要求"按下+松开都在遮罩本体"(e.target === e.currentTarget)才关闭, 反向拖动(遮罩按下/窗内松开)同样不关。✕ 按钮关闭不受影响。纯源码断言 (无纯函数改动)。
- 回归: `npx tsc -b --force` + v1-v164 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v165**: 批量复制窗口打开且旋转锚点勾选「自定义」时, 画布上的自定义锚点标记始终显示 — 点击他处取消选中不再消失。EditorCanvas originMarkerVisible 条件放宽为 `自定义模式 && (有选区 || conversionDialog === 'duplicate')`; 绘制与命中拖拽共用该函数, 无选区时锚点仍可拖动 (回写 store.customOrigin 供弹窗使用)。普通旋转的自定义锚点 (无窗口时) 仍需选区, 旧行为不变。纯源码断言 (无纯函数改动)。
- 回归: `npx tsc -b --force` + v1-v165 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v166**: 批量复制弹窗与左侧栏变换(选区)原点数据分离。store 新增 dupOriginMode (默认 selection) / dupCustomOrigin (默认游玩区中心) / setDupOriginMode / setDupCustomOrigin (取整) / currentDupOrigin(); DuplicateDialog 三模式 radio 与锚点坐标输入改读写 dup 套, computeDuplicate 原点随之; EditorCanvas originMarkerVisible 改为弹窗打开时看 dupOriginMode==='custom' (v165 的"取消选中不消失"语义保留), 新增 activeCustomOrigin() 路由 (弹窗打开 = dupCustomOrigin), 标记绘制/命中/拖拽写入全部走它, 拖拽经 setO 路由写 dup/普通原点。Inspector 仍用自己的 originMode/customOrigin, 互不影响。**适配**: v34 (命中改 activeCustomOrigin), v65 (弹窗断言改 dup 套), v91 (拖拽改 setO 路由), v165 (originMarkerVisible 新三元)。
- 回归: `npx tsc -b --force` + v1-v166 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v167**: 移植 lazer (Version 20260706) osu!standard 星数计算, 游玩区左下角谱面信息结尾追加 `· ★x.xx`。新模块 `src/osu/starRating.ts` (入口, 对应 OsuDifficultyCalculator.cs CreateDifficultyAttributes 主流程) + `src/osu/starrating/`: diffUtils.ts (DiffUtils.cs), preprocessing.ts (OsuDifficultyHitObject.cs / DifficultyHitObject.cs / SliderEventGenerator.cs / Slider.cs 的 Velocity/TickDistance/nested 生成), evaluators.ts (SnapAim/Agility/FlowAim/Speed/Rhythm/Reading Evaluator), skills.ts (Aim=VariableLengthStrainSkill, Speed/Reading=HarmonicSkill)。无 mod 简化 (clockRate=1): 不算 Flashlight (flashlightRating=0, SumCognitionDifficulty(reading,0)=reading), 不算 LegacyScoreSimulator 相关 attributes; aim/speed/reading Rating、CountTopWeighted*、GetDifficultSliders 等中间量按源码全算并导出 computeStarRatingAttributes 供对账。复用工程 sliderVelocityAt (与 lazer 100*sm/GetPrecisionAdjustedBeatLength 同公式; 差异: lazer 钳 SV 到 [0.1,10] 且经 float 精度调整, 工程未钳制, 常规谱面无差异) 与 stacking.ts computeStackOffsets (= lazer StackedPosition) 及 sliderPath 缓存。显示: store 新增 starRating/setStarRating (emitSelection, UI 状态不入 undo); App.tsx 以 getDataVersion() 驱动 useEffect + setTimeout 200ms 防抖异步重算 (clearTimeout 清理), 算完前显示上次结果。测试不变量: 空谱面=0, 单圆圈=0 (lazer 首个物件不产生难度物件对), 双圆圈小正值 (0.01~0.5), 同节奏远跳>近跳, 滑条/折返/转盘无 NaN, 200 物件 200bpm 密集谱面∈[1.5,8] (实测 4.88), 同排布 BPM 翻倍星数>1.3x (实测 2.79→4.91)。
- 回归: `npx tsc -b --force` + v1-v167 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v168**: 显示设置新增「背景图亮度」数值滑条 (0-100%, 默认 35 = 旧固定 globalAlpha 0.35, 默认表现与之前完全一致)。displaySettings.ts: DisplaySettings 加 bgBrightness (读取/写入均钳制 0-100 取整), 新增 BoolDisplayKey 类型 (布尔开关键) + setDisplayNumber; store.setDisplayNumber 转发 + emitSelection; DisplayPanel 开关行下方加滑条行 (样式仿 VolumePanel); EditorCanvas 背景渲染 alpha = bgBrightness/100 (旧 0.35 移除)。**适配**: v132 (setDisplayFlag 签名 keyof DisplaySettings → BoolDisplayKey)。
- 回归: `npx tsc -b --force` + v1-v168 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v169**: 游玩区左下角谱面信息拆成两段: 上段 = `CSx ARy · N 物件 · ★s.ss` (whitespace-nowrap, 避免长曲名/难度名把统计/星数顶出视野), 下段 = 艺术家-歌曲名[难度名] 保留原 bottom-2 left-2 位置, [⚪ 未保存] 指示器与 [已保存] 反馈仍在名称前 (data-dirty-indicator/data-save-message 不变), 容器 flex flex-col gap-1 + max-w-[36rem] 截断上限保留。**适配**: v110/v111 (bottom-2 left-2 单行断言 → 两段容器)。
- 回归: `npx tsc -b --force` + v1-v169 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v170**: 修复皮肤 skin.ini [Fonts] HitCirclePrefix 被忽略导致的圈内数字不显示 (Saraune Leaves: HitCirclePrefix=blank, default-N.png 是 1x1 透明占位, 真实数字在 blank-N@2x.png)。skin.ts 新增 parseSkinIniFonts (段边界到下一 [Section], 键大小写不敏感, 非法值 null); applySkinFromDir 数字加载改为 前缀→default-N 回退链 (loadOne 并入), Skin 加 hitCircleOverlap 字段; renderer drawNumber 支持 HitCircleOverlap 字距 (步进 = 字宽 - overlap, ini 1x 逻辑像素, @2x 按 ScaleAdjust 折算), 未定义时保持旧 33/35 字距。
- 回归: `npx tsc -b --force` + v1-v170 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v171**: 重叠命中时已选物件优先 — 拖动/右键已选中物件不再被 v154"离当前时间最近"逻辑重选到重叠的未选中物件。hitTest 收集全部命中后先筛已选子集 (selHits), 非空则在已选子集内挑时间最近, 空则维持 v154 全命中时间最近; mousedown (拖动/选中) 与右键删除两处调用点共用, 一处修复全生效。**适配**: v154 (返回值断言改已选优先版)。
- 回归: `npx tsc -b --force` + v1-v171 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v172**: 皮肤窗口 (SkinListPanel) 打开时滚动到当前选中皮肤并尽量居中。当前行加 data-skin-current 标记, 列表容器挂 listRef, skins/current 加载完成后 querySelector + scrollIntoView({block:'center'}) (列表太短或行贴边时自动贴边, 不会过卷)。纯源码断言 (无纯函数改动)。
- 回归: `npx tsc -b --force` + v1-v172 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v173**: 修复"数字即圈"皮肤圈内数字/圈显示过小 (a(No Number): default-N = 160x160 整圈贴图, hitcircle/overlay = 1x1 占位, 旧逻辑把所有数字压到固定 52/128 盒子高)。对齐 lazer LegacySpriteText (FontUsage size=1 + glyph scale=1/ScaleAdjust = 贴图自然尺寸): drawNumber 签名改收 128 盒子 (box=2r), 每字形高 = box × 贴图逻辑高/128, 宽按宽高比, 各自垂直居中; 经典 35x52 数字结果与旧固定高度完全相同, HitCircleOverlap 分支保留 (overlap 换算盒子单位)。两处调用点 (单点/滑条头) 同改。**适配**: v18 (52/128 断言改固有尺寸公式), v48 (box 变量检查限定 drawFollowPoints 函数体)。
- 回归: `npx tsc -b --force` + v1-v173 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v174**: 圈内数字补上 stable/lazer 的 0.8x 统一缩放 — v173 只移植了 LegacySpriteText 的自然尺寸, 漏了 OsuLegacySkinTransformer.HitCircleText 的 `hitcircle_text_scale = 0.8f` (注释原话: stable applies a blanket 0.8x scale to hitcircle fonts)。修正后: "数字即圈"皮肤 (default-N = 160x160) 160×0.8 = 128 正好一圈大小, 与 stable/lazer 一致; overlap 字距同样乘 0.8。lazer 另有 MaxSizePerGlyph=OBJECT_DIMENSIONS*2/0.8=320 的超大字形裁剪, 极端情况未实现 (已注释留档)。**适配**: v173 (heights 断言补 × TEXT_SCALE)。
- 回归: `npx tsc -b --force` + v1-v174 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v175**: 滑条球 (sliderb) 保持贴图固有宽高比 + 沿路径切线旋转 — 皮肤 "kongehund mapping 2.0" 的 sliderb@2x.png 是 1500x236 宽幅技巧贴图 (品红圆环 + 贯穿横线, 模拟 stable 球随路径旋转的轨迹线效果), 旧代码压进方形盒子 → 球环被拉成竖椭圆。修正: 新增 drawSpriteRect (带旋转矩形绘制), 球宽取 skinSpriteWidth 登记固有宽度、球高取贴图实际高度 / ScaleAdjust, 高 >384 时等比缩小 (lazer MAX_FOLLOW_CIRCLE_AREA_SIZE = OBJECT_DIMENSIONS*3, lazer 为居中裁剪此处从简), 旋转角取球位置前后 ±1.5px 的路径切线。lazer 出处: LegacySliderBall.cs (AutoSize = 贴图逻辑尺寸, 父级带 Rotation, 注释 "undo rotation on layers which should not be rotated" 证明球随方向旋转)。**适配**: v131 (sbW 宽度 cap 断言 → natW/natH 分开 + drawSpriteRect 断言, 固有宽度与 384 上限语义保留)。
- 回归: `npx tsc -b --force` + v1-v175 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v176**: 修复 v175 回归 — 滑条球对几乎所有皮肤偏大一圈。原因: v175 改按固有宽高比绘制时丢掉了 v131 `size*(sbW/128)` 中的 `size/128` CS 缩放因子, 球不再随物件缩放。lazer 出处: DrawableSliderBall.cs — ball (SkinnableDrawable) 无 RelativeSizeAxes 保持贴图固有逻辑尺寸, 但整体位于 DrawableSlider 内随 HitObject.Scale (= CS 缩放) 缩放。修正: drawSpriteRect 宽/高均乘 csK = size/128。v175 的宽高比/切线旋转/384 上限语义不变。**适配**: v175、v131 (drawSpriteRect 调用签名断言补 csK)。
- 回归: `npx tsc -b --force` + v1-v176 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v177**: spinner 转盘转速对齐 osu!lazer — v125 把 ambient 误作恒定 12.5°/s 且完全没有主动旋转, 转盘看起来几乎静止。lazer 实际有两层旋转: ① ambient (DefaultSpinnerDisc.cs updateStateTransforms): 从 preempt/2 前起, 在 (preempt+duration) 内共转 25*duration/2000 度; ② 转盘期间主动旋转 = RotationTracker 输入驱动, autoplay 下为 0.05 rad/ms ≈ 477.46 SPM (OsuAutoGenerator.cs 注释 "0.05 rad/ms, or ~477 RPM, as per stable")。编辑器无输入, 转盘期间按 0.05 rad/ms 模拟, 结束后保持最终角度。spinnerAmbientRotation 加 durationMs 参 (ambient 速率与 clamp 都依赖 duration)。**适配**: v125 (check.mjs 签名/速率/调用处断言, tests.ts ambient 断言)。
- 回归: `npx tsc -b --force` + v1-v177 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v178**: 滑条表现对齐 osu!lazer 两处 — ① 滑条头被点击后头圈消失: 编辑器按 autoplay 于 dt=0 命中, 头圈/overlay/数字经 sliderHeadHitState 门控 (lazer DrawableHitCircle.UpdateHitStateTransforms: 无打击动画 FadeOut(60ms); 开「打击动画」时同单点 240ms 放大 1.4x 爆炸淡出; 关「note点击特效」立即消失)。② slider tick 不再一次性全显示: sliderTickState 渐进出现 (lazer DrawableSliderTick + DrawableOsuHitObject.InitialLifetimeOffset=TimePreempt — 各自在 自身时间-preempt 出现, FadeIn(ANIM_DURATION=150ms) + ScaleTo(0.5→1, 600ms, OutElasticHalf)); 球经过后 150ms 淡出为既有语义保留。outElasticHalf 公式逐字取自 osu-framework DefaultEasingFunction.cs (elastic_const=2π/0.3, const2=0.075)。**适配**: v150 (尾部 cw→ecw, 头 cw 含 hs.scale)、v173 (drawNumber 第二调用点 r*2→size*hs.scale)。
- 回归: `npx tsc -b --force` + v1-v178 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v179**: 滚轮 seek 修复 — ① 游玩区滚轮原被 `if (!store.playing)` 屏蔽, 播放中无法滚轮改时间, 已解除; ② 三处滚轮 (游玩区/上时间轴/底部时间轴) 统一走 seekByBeats (v45 移植的 lazer EditorClock.seek 语义: 向前/后跳一个 1/beatSnap 网格点, 处理红线边界), 替换掉上时间轴不吸附的 ±step (播放中连续时间落点在网格外) 与底部时间轴固定 len/40 步进 (与细分无关)。Ctrl+滚轮缩放 TimelineZoom 保留。seekByBeats 行为由 v45 测试覆盖, v179 仅做接线断言。
- 回归: `npx tsc -b --force` + v1-v179 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。
- **v180**: 转盘放置逻辑对齐 osu!lazer SpinnerPlacementBlueprint — 旧实现左键直接放置且终点固定 +4 拍; lazer 为两段式: 左键提交起点 (BeginPlacement commitStart, 吸附当前细分网格) → 放置中终点实时跟随编辑器当前时间 (updateEndTimeFromCurrent: EndTime = max(StartTime + 起点处一拍, SnapTime(当前时间)), 滚动时间轴/播放即拉长) → 右键完成 (EndPlacement); 放置中左键无效, 预览 SpinnerPiece alpha 0.5。实现: store.pendingSpinner (起点 ms, null=未放置); sliderPath.spinnerPlacementEnd 纯函数; renderer.drawPendingSpinner (alpha 0.5 复用 drawSpinner); EditorCanvas 左键/右键分支 + 渲染预览; App 工具切换(快捷键+按钮)/Esc 取消放置。
- 回归: `npx tsc -b --force` + v1-v180 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v181 界面 emoji 图标 → lucide-react
- App.tsx / DraggableDialog / FirstRunWizard / PatternPanel / SkinListPanel / SkinPicker / SongLibrary / Timelines / TimingPanel / UnsavedDialog / Inspector 共 11 文件: 🔊👁📁🎨📏🔒🔓◎▣⊞🧲⚙📦📈↩↪★✕✓🎵⚠⏮▶⏸⏹⏭↺↻⇋⇅ 全部换成 lucide 组件; ⚪脏标记 → CSS 圆点 span; 帮助文本 ↑/↓ 键盘提示保留。
- 新增 AGENTS.md: 界面图标一律 lucide-react, 禁用 emoji/Unicode 符号图标。
- check.mjs: 扫 src 全库无 emoji/符号图标残留 (剥注释, 白名单文本箭头) + 各文件 lucide 接入断言 + AGENTS.md 规范断言。
- 适配旧断言: v15 (🎨皮肤→Palette) / v90 (🧲⚙→Magnet/Settings2) / v97 (⊞→Grid3x3) / v108 (📁🎨↩↪◎→组件名) / v109 (◎→Crosshair) / v124 (⚪→CSS圆点) / v151 (⊞锚点→Grid3x3) / v164 (✕→X) / v167 (★→Star) / v169 (星数锚点→toFixed(2))。
- 回归: `npx tsc -b --force` + v1-v181 全部 check 全绿 (v60 除外 — 另一并行任务处理中, 见 v113 条目)。

## v182 帧率适配显示器刷新率
- electron/main.cjs: `app.commandLine.appendSwitch("disable-frame-rate-limit")` (app ready 前) — 解除 Chromium 默认 60fps 帧率上限, rAF 按显示器 vsync 触发 (144Hz/165Hz 不再锁 60)。渲染循环本来就是 rAF 驱动, 无需改渲染代码。
- check.mjs: 断言开关存在且在 whenReady 前 / 未 disableHardwareAcceleration / 渲染循环为 rAF。
- 回归: v1-v182 全绿 (v60 除外)。

## v183 缩圈命中贴边渐隐 (对齐 osu!stable)
- src/osu/renderer.ts drawApproach 加 pinAfterHit 参数: 「打击动画」关 (= stable 编辑器暂留模式, 点击特效开) 时, 单点命中后缩圈不再消失, 固定贴在圈边 (最终大小 = 2r 盒子), 随本体按 HIT_LINGER 800ms 整体渐隐 (透明度继承 caller globalAlpha); 打击动画开 / 点击特效关 / 滑条维持 lazer 行为 (命中即消失)。
- 回归: `npx tsc -b --force` + v1-v183 全绿 (v60 除外)。

## v184 谱面信息移到页签栏 (song setup 左侧居中)
- src/App.tsx: 游玩区左下角的两段谱面信息移到页签栏 — compose/timing 页签后接一个 flex-1 居中容器, 其右为 song setup 页签 (单独渲染), 再右为音量/显示设置; 无谱面时 flex-1 占位保持右侧按钮靠右。两个 Label: 左 = 名称 (艺术家-歌曲名[难度名], max-w-28rem 截断, 未保存指示器/保存反馈随行), 右 = 数据 (CS/AR/物件数/★星数)。data-dirty-indicator / data-save-message 属性不变。
- 适配旧断言: v28 (song setup 锚点 → setTab('setup')) / v81 (max-w-36rem → 28rem) / v110 / v111 (左下角 → 页签栏容器与锚点) / v124 (pill 截取范围) / v169 (两段 → 名称左/数据右, 顺序断言反转)。
- 回归: `npx tsc -b --force` + v1-v184 全绿 (v60 除外)。

## v185 自动备份谱面
- server/backupCore.mjs (新, ESM 纯逻辑): 备份文件夹 = `艺术家_歌曲名` (非法字符剔除, 兜底 Unknown Artist/Title); 备份文件 = 原谱面文件名(去 .osu) + `_YYYYMMDD_HHmmss.osu`; performBackup: 内容与上次备份相同 → 不新建, 把上次备份重命名为最新时间 (同秒重名跳过 rename); 不同谱面独立文件夹。
- electron/main.cjs: BACKUP_ROOT = exe 同目录/backup_beatmaps (isPackaged; dev 回退 app/backup_beatmaps); IPC `backup-beatmap` / `open-backup-folder` (shell.openPath, 无备份时报"尚无备份"); 文件菜单新增「查看备份」→ menu-cmd `open-backups`; main() 动态 import backupCore。
- electron/preload.cjs + src/osu/electronBridge.ts: 暴露 backupBeatmap / openBackupFolder, ElectronMenuCommand 加 open-backups。
- src/osu/store.ts: backupNow(trigger, content?) — 仅 Electron; save() 成功后 `void this.backupNow('save', r.text)`; openBackupFolder()。失败静默不打断编辑。
- src/App.tsx: setInterval 10 分钟 `store.backupNow('auto')`; 菜单命令 open-backups → store.openBackupFolder()。
- .gitignore: backup_beatmaps/。
- check.mjs: backupCore 真临时目录单测 (created/renamed/同秒/内容变化/独立文件夹) + 全链路接线断言。
- 回归: `npx tsc -b --force` + node --check main/preload + v1-v185 全绿 (v60 除外)。

## v186 song setup 移到谱面信息左边
- src/App.tsx: 页签栏顺序改为 compose / timing / song setup → 谱面信息容器 (flex-1 居中) → 音量/显示设置; song setup 与 compose/timing 重新并排, 谱面信息在其右侧居中。
- 适配旧断言: v184 (顺序反转 + 截取边界) / v111 (左右关系断言) / v124 (pill 截取上界改 data-volume-panel-btn)。
- 回归: `npx tsc -b --force` + v1-v186 全绿 (v60 除外)。

## v187 撤销 v182 帧率开关 (帧率暴跌修复)
- electron/main.cjs: 移除 `disable-frame-rate-limit` — 实测部分机器上该开关让 Chromium 合成器非节流连发, rAF 每秒数百次触发全量 React 重渲染, CPU 打满界面卡顿。原生 rAF 本身跟随显示器 vsync (高刷屏自动高帧率), 无需开关。
- verifier/v182/check.mjs 改写为撤销断言 (开关调用不存在 / rAF 循环确认)。
- 回归: v1-v187 全绿 (v60 除外)。

## v188 滑条"头尾异色"定位 + 时间轴 ±2ms 堆叠 + 转盘放置幻影
- 定位结论: 游玩区"粉色滑条头+蓝色滑条尾"不是染色 bug — 谱面 7157 粉圈与 7158 蓝滑条同坐标 (188,17)、相差 1ms (Aspire 式叠放), 游玩区按 stable/lazer 规则早物件画在上层, 粉圈盖住蓝滑条头; 上方时间轴按文件序画, 蓝滑条头反而盖住粉圈, 两处都"正确"但表现不一致。
- src/osu/timelineHit.ts: stackInfo 同刻判定从精确相等放宽为排序后相邻 ≤2ms 链式归组 (STACK_EPS=2), 组内 level 仍按文件顺序 — 1ms 偏移的叠放对现在在时间轴上也上下堆叠可辨认, 命中几何同步跟随 (stackGeomOf 不变)。
- src/components/Timelines.tsx: 放置转盘时上方时间轴画虚线幻影连体条 (tool='spinner' && pendingSpinner!==null, 终点 = spinnerPlacementEnd 落盘规则, 与滑条幻影同款 drawTimelineObject)。
- 适配: verifier/v162/check.mjs 旧断言 `counts.get(o.time)` → `STACK_EPS = 2` (纯函数行为不变)。
- 回归: v1-v188 全绿 (v60 除外)。

## v189 时间轴堆叠/绘制序修订 (撤销 v188 的 ±2ms)
- src/osu/timelineHit.ts: stackInfo 恢复精确 0ms 同刻分组 (撤销 v188 的 STACK_EPS=2 链式归组); stackLayout 堆叠 ≥2 件不再缩小半径 (rad 恒为 rad0, 仅压缩层距, 仍不出行界)。
- src/components/Timelines.tsx: 物件按时间倒序绘制 (晚物件先画, 早物件压上层, 与游玩区/stable 一致) — Aspire 式 1ms 偏移叠放中早物件不再被晚物件头圆盖住; 同刻组内稳定排序保持文件顺序。
- 适配: v162/tests.ts stackLayout 数值更新 (不缩半径后的 rad/yOf), v162/check.mjs 恢复 counts.get 断言; v188 堆叠相关断言改为"精确同刻"语义 (转盘幻影断言保留)。
- 目测: 自建谱面 (2000ms 粉圈 + 2001ms 蓝滑条同坐标 / 5000ms 三件同刻) — 粉圈压蓝滑条头上层; 同刻三件 rad=24 不缩小。
- 回归: v1-v189 全绿 (v60 除外)。

## v190 粉药丸 (音量胶囊) 全收缩成点修复
- 原因: v189 物件改倒序绘制后 samplePills 按 x 降序收集, pillLayout 依赖升序输入, 除首个外全部误判重叠 → 稀疏物件也只显示圆点。
- src/components/Timelines.tsx: 药丸在 pillLayout 前按 x 升序排序 (物件倒序绘制保持不变)。
- 回归: v1-v190 全绿 (v60 除外)。

## v191 工具按钮加 Lucide 图标
- src/App.tsx: 选择/单点/滑条/转盘 4 按钮文本前分别加 MousePointer2/Circle/Spline/Disc 图标 (遵循 AGENTS.md 禁用 emoji 图标规范)。
- 回归: v1-v191 全绿 (v60 除外)。

## v192 快捷键镜像/旋转围绕游玩区中心
- src/App.tsx: Ctrl+,/. 旋转90° 与 Ctrl+H/J 水平/垂直镜像 4 个快捷键改传 'playfield' 原点 (256,192), 对齐 osu!stable; Inspector 面板按钮仍用界面所选原点 (选区/游玩区/自定义)。帮助文本与 Inspector 提示同步更新。
- 适配: verifier/v17/check.mjs、verifier/v75/check.mjs 快捷键断言更新为带 'playfield' 参数。
- 回归: v1-v192 全绿 (v60 除外)。

## v193 滚轮 seek 对齐 lazer (播放中滚动卡顿修复)
- 参考 lazer: Editor.OnScroll (Editor.cs:740) 刻度累积 + Editor.cs:1254 seek 播放分支 (amount = divisor × BPM/120) + EditorClock.seek (EditorClock.cs:99, 播放中 ×(1+250/(int)BeatLength), snapped=false, 立即硬 seek) + TrackBass.Seek (不 stop/start, 直接 ChannelSetPosition)。
- src/osu/seekSnapping.ts: 新增 wheelSteps (增量累积到 120px 一刻度才触发, 反向折返, deltaMode 归一 — 触摸板精密滚动不再每事件都 seek) 与 playingWheelStepMs (播放中步长 = BeatLength × BPM/120 × (1+250/(int)BeatLength), 墙钟基准 500ms, 不吸附)。
- src/osu/store.ts: 新增 wheelSeek (三处滚轮入口共享累积器; 暂停仍走 seekByBeats 吸附) 与 seekWhilePlaying (播放中不 pause/play: 即时重建源 4ms 锚定, 音乐总线 ~8ms 淡出淡入防咔哒, hitsound voices 不动, tempo 节点走 schedule 重定位)。
- 三处 onWheel (EditorCanvas/上时间轴/下时间轴) 收敛到 store.wheelSeek; 上时间轴 Ctrl+滚轮缩放保留。
- 适配: verifier/v179/check.mjs 滚轮断言改为 wheelSeek 入口 (暂停网格吸附语义不变, 断言 wheelSeek 内部仍走 seekByBeats)。
- 回归: v1-v193 全绿 (v60 除外)。

## v194 参考 Bpm-Measurer 优化频谱显示
- 参考 本机 Bpm-Measurer 项目 (components/Visualizer.tsx + utils/audioUtils.ts): FFT_SIZE=1024、Hann 窗、-80dB 地板、分段色带 黑→紫(0.25)→红(0.5)→黄(0.75)→白(1)。
- src/osu/waveformData.ts: SPECTRO_FRAME 2048→1024 (瞬态时间分辨率 46ms→23ms @44.1k, 鼓点竖纹更锐利; v106 窗口居中保持, scratch/LRU 随之 1024); spectroColor 从 7 锚点 Audition 风 RAMP 改为 Bpm-Measurer 分段线性式 (中高强度更饱满, 旧 RAMP 数组删除)。
- 波形不动: v105 Audition 风绿色填充 + 半透明底是用户指定, 保留 (Bpm-Measurer 波形仅描边且 stride 抽稀, 不如现有实现)。
- 截图对比 (verifier/v194-shot.mjs, 用后已清理): 频谱鼓点竖纹明显更锐利, 整体更亮更饱满; 波形无变化。
- 适配: verifier/v103 (SPECTRO_FRAME 断言 2048→1024; 色带锚点断言改分段式; T7 单调性允许 ≤2 段间回落 — 分段 [0.25,0.5) 内 b 128→0 与 r 128→255 对冲; T9 峰值 bin 容差 2→4 — 1024 帧 binHz 变粗, 低频对数 bin max 池化摊峰); v106 无需改 (getSpectrogramColor 注释措辞误触其 getSpectrogram 删除断言, 注释改写规避)。
- 回归: v1-v194 全绿 (v60 除外)。

## v195 缩圈命中后反弹 (关「打击动画」暂留模式)
- 需求: 关 note 打击动画后, 缩圈缩到圈边不能就此停住, 要以缩小差不多的速度向外反弹一点再停下 (对齐 stable 编辑器观感)。
- src/osu/lifecycle.ts: 新增常量 `APPROACH_BOUNCE = 0.1` (初版 0.2, 用户要求停住 1.1) 与纯函数 `approachBounceScale(dt, preempt)` — 反弹速度 = 缩圈速度 (每 ms 3/preempt 个盒子), 反弹持续 APPROACH_BOUNCE×preempt/3 ms (AR10≈15ms), 之后固定 1.1x; dt<0 clamp 到 1。
- src/osu/renderer.ts: drawApproach 的 pinAfterHit 分支 (v183 暂留贴边) 从固定 `size` 改为 `size × approachBounceScale(dt, preempt)`; 非暂留模式 (打击动画开/点击特效关/滑条) 不变, 命中即消失。
- DisplayPanel.tsx: hitAnimation 描述补「缩圈缩到圈边后向外反弹一点再停住」。
- 目测 (verifier/v195-shot.mjs, 用后已清理): 单物件谱面三帧截图 — 命中前缩圈 1.8x → 反弹半程 → 停住后随本体渐隐 (圈略大于 note 边)。
- 适配: verifier/v183/check.mjs 贴边断言改为 pin = size × approachBounceScale。
- 回归: v1-v195 全绿 (v60 除外)。

## v196 paste 取整 round → floor (粘贴时刻与底部时间戳显示一致)
- 现象: [EX] 谱面把 15186 的绿线复制到显示为 0:55.749 的位置, 新绿线落在 55750 而非 55749。
- 根因: 节拍吸附经红线 1665 (142BPM, 422.535211267606ms/拍) 走 128 拍得 currentTime=55749.507; 底部时间戳 fmt 用 **floor** 显示 (0:55.749), 而 store.paste 用 **Math.round** 取整 → 55750, 显示与落点差 1ms; 且 55749 已有目标绿线时 round 后不等, 覆盖判定 (v102) 失效变成新增错位线。
- 修复 (store.ts paste): 物件 time/endTime 与绿线 time 三条取整路径统一 Math.round → **Math.floor**, 粘贴时刻 == 显示时刻 (WYSIWYG)。
- 安全性: 放置路径仍是 round (snapPlacementTime), round(f) ≥ floor(f) 恒成立 → 同一 currentTime 下放置的物件不会早于粘贴的绿线, timingAt 不会取到前一条 SV (v102/v113 的 SV 取错方向不可能复现); v113 的同刻相等语义 (物件绿线同路径取整) 保持。
- 适配: verifier/v113/check.mjs 取整断言 round → floor (v113/tests.ts 的 paste(10000.4)→10000 两种取整结果相同, 无需改)。
- 验证: verifier/v196 (tests: 55749.507 复现布景粘贴落 55749 且覆盖既有线不新增 / 同刻滑条+绿线 floor 后仍严格相等且 SV=2.0 / round≥floor 恒等; check: 三路径 floor 断言 + fmt floor 前提断言)。
- 回归: v1-v196 全绿 (v60 除外)。

## v197 播放性能优化 (大谱面卡顿: 4299 物件 / 1447 timing 点的 Crystal Gravity [Gravisphere Crisis])
- 诊断: CDP Profiler 采样播放 8:08~8:15 段 7s — 优化前 >20ms 帧占 34.2% (中位 16.7/p95 25ms), 热点: 上时间轴 draw 18.8%、hitObjectDuration+hitObjectEndTime 18% (每帧每滑条 sliderVelocityAt 全表双线性扫 1447 点)、canvas 原生 arc/fill/fillRect ~19%。
- 修复 ① lifecycle.ts: 新增滑条时长**帧级 memo** — `sliderDurationMemo(points, mult, o)`: 键=物件引用 (校验 time/length/slides), timing 内容指纹 (长度+逐点 time/beatLength 折叠) 失效; `beginLifecycleFrame()` 由 store.tickClock 在每帧渲染前调用推进帧号, 指纹每帧最多算一次 (任何 timing/物件修改都会触发重绘=新帧, 不会读陈旧值)。hitObjectDuration 与 renderer.objectEndAt 都改走 memo (objectEndAt 语义不变: 内部同公式)。
- 修复 ② Timelines.tsx 上时间轴物件循环: drawList 本就按时间升序 (parser/store 全程维护), 改倒序索引遍历, 删掉每帧 `[...drawList].sort()` (4299 物件每帧 nlogn 排序+数组分配)。v189 倒序绘制语义不变; 窗口外跳过用 continue 不用 break (长滑条/转盘起点在窗口左外但身体仍可见)。
- 复测同段: >20ms 帧降到 2.1%, 中位 12.5ms / p95 16.7ms; 上时间轴 draw 18.8%→0.7%, 时长计算 18%→1%; 主线程出现 22.6% idle。残余大头是 canvas 原生光栅 (~26%, 真实绘制开销) 与 React dev 模式开销 (打包 prod 更低), 暂不值得继续动。
- 适配: v189/v190 (倒序断言改倒序索引遍历), v69 (objectEndAt 断言改 sliderDurationMemo 路径)。
- 验证: verifier/v197 (tests: memo 值与非 memo 一致/同帧缓存/跨帧 timing 指纹失效/同帧物件 time-length-slides 变化失效/hitObjectDuration+endTime 语义不变; check: 四处接线断言)。
- 回归: v1-v197 全绿 (v60 除外)。

## v198 播放中滚轮 seek 不再补播被滚过区间的 hitsound (用户反馈: 滚轮扫过的物件音效全补响)
- 根因: seekWhilePlaying 里 scheduler.resync() 只跳过未排程的旧事件, 但 lookahead 250ms 内**已 schedule 进 WebAudio** 的 voice 不会被取消 (v193 当时刻意绕开), 每滚一格就爆发一段旧区间音效。
- 修复 (store.ts seekWhilePlaying): resync 前 `stopAllHitVoices()` (drain 全部 voice 并 stop, 含预排程未发声的) — 对齐 lazer seek 期间静音采样的行为; v193 的"不停 voice"断言已反转适配。
- 验证: verifier/v198 (check: seekWhilePlaying 内 stopAllHitVoices 先于 resync + stopAllHitVoices drain 定义)。
- 回归: 全绿 (v60 除外; v193 断言适配)。

## v199 滑条折返箭头画在头/尾圈之下 (用户反馈: reverse arrow 应在 hitcircle 下面)
- renderer.ts drawSlider: 折返箭头绘制段整体移到滑条头圈/尾端圈**之前** (层级对齐 lazer DrawableSliderRepeat 压在圈下); `const size = r * 2` 声明随之上移。sliderRepeatAlpha 显示时机逻辑不变。
- 验证: verifier/v199 (check: 箭头段位置在头圈/尾圈之前 + size 声明先于使用)。
- 回归: 全绿 (v60 除外)。

## v200 暂留模式命中后 hitcircle 本体变白 (用户反馈: 打击动画关的暂留模式下, 原版被击那刻本体变色)
- renderer.ts drawCircle: 暂留条件收敛为局部 `linger = hitExplosion && !hitAnimation`; linger 且 dt>=0 时 hitcircle 染色由 combo 色改 `'#ffffff'` (stable 同款: 已打过的 note 本体变白, 与缩圈贴边渐隐共存); overlay/数字不变; drawApproach 的 pinAfterHit 参数复用同一 linger 变量。
- 适配: v12/v150 (hitcircle 染色变量 color → bodyColor), v183 (pinAfterHit 内联条件 → linger 变量)。
- 验证: verifier/v200 (check: linger 条件 + bodyColor 分支 + drawApproach 复用)。
- 回归: 全绿 (v60 除外)。

## v201 combo 颜色顺序对齐 lazer (用户反馈: combo color 与原版相反)
- 根因: computeCombos 从 0 开始编号且忽略 comboSkip — 但 stable/lazer 的 `ComboIndexWithOffsets` 首物件 = 1 (lazer EditorBeatmapSkin 注释: "the actual effective first combo colour ... is the one with index 1, not 0"), 即原版首个 combo 实际用 [Colours] 下标 1 (Combo2), 本实现整体偏了一位。
- 修复 (renderer.ts computeCombos, 对齐 lazer OsuHitObject.UpdateComboInformation): 返回 { combo, comboWithOffset, index } —
  - combo = ComboIndex (首 combo=1, newCombo +1, 不含跳色位) → 皮肤 combo 色用 (lazer SkinComboColourLookup 用 ComboIndex);
  - comboWithOffset = ComboIndexWithOffsets (newCombo 时 += 1 + comboSkip) → 谱面 [Colours] 用 (lazer LegacyBeatmapSkin.GetComboColour);
  - spinner 永不开始新 combo; 首物件与 spinner 后首个非 spinner 物件强制 new combo; 显示数字 index 语义不变。
- 消费方: renderPlayfield / Timelines 上时间轴按 skinColors 开关分别取 ci.combo / ci.comboWithOffset; 放置预览颜色 = 下一 new combo 索引, 无物件时 = 1。
- 适配: v31 (时间轴染色断言), v44 (预览 combo 期望值 0-based → 1-based, index 不变)。
- 验证: verifier/v201 (tests: 首 combo=1 / comboSkip 只进 WithOffsets / spinner 不开新 combo + spinner 后强制 / 首物件为 spinner 边界; check: 三处消费方断言)。
- 回归: 全绿 (v60 除外)。

## v202 上时间轴 new combo 圆圈去掉加粗描边 (用户反馈: NC 特别加粗边框看着怪)
- Timelines.tsx: newCombo 物件不再用 '#ffffff' + 3.5px 加粗描边 (lazer/stable 时间轴 NC 无特殊粗环, lazer TimelineHitObjectBlueprint 仅按 combo 色填充), 统一为普通 rgba(255,255,255,0.55)/2.5px; 仅选中态保留黄环 4px。
- 验证: verifier/v202 (check: NC 特亮/加粗分支已删, 选中粗环保留)。
- 回归: 全绿 (v60 除外)。

## v203 暂留模式滑条头暂留 (用户反馈: 打击动画关时滑条头被打到不会像一般 note 一样暂留)
- 根因: sliderHeadHitState 暂留分支是 60ms 淡出 (lazer 无打击动画 FadeOut(60)), 而单点在 v147 起是原大小 HIT_LINGER(800ms) 渐隐 — 头圈闪没, 单点暂留, 表现不一致。
- 修复 (renderer.ts): sliderHeadHitState 暂留分支改 `1 - dt/HIT_LINGER` (与单点一致); 暂留命中后 sliderstartcircle 本体同 v200 单点变白 (`headColor`); 打击动画开 (240ms 爆炸) / 点击特效关 (即消失) 分支不变。
- 适配: v178 (60ms 断言 → HIT_LINGER), v150 (sliderstartcircle 染色变量 color → headColor)。
- 验证: verifier/v203 (tests: 暂留 400ms alpha=0.5 不放大 / HIT_LINGER 后消失 / 打击动画开与点击特效关分支不变; check: 接线断言)。
- 回归: 全绿 (v60 除外)。

## v204 slidertick 出现时机对齐 lazer SliderTick (用户反馈: sliderpoint 渐显逻辑与 stable 不一致)
- 查证: lazer `SliderTick.ApplyDefaultsToSelf` — tick 的 TimePreempt **不是**整段 AR preempt, 而是 `(tickTime - spanStart)/2 + offset`, offset = spanIndex>0 ? 200 (注释明说是 stable 的偏移, 避免 repeat 段 tick 出现太晚) : preempt×0.66。之前 v178 实现用整段 preempt, 首段 tick 出现过早 (几乎随滑条淡入全程可见), 与 stable 观感不符。
- 修复: renderer.ts 新增 `sliderTickPreempt(tickTime, spanStart, spanIndex, preempt)` (lazer 公式原样), sliderTickState 签名加 spanStart/spanIndex; hitSounds.ts `SliderTickPoint` 加 `spanIndex` 字段 (排布循环的 s 直接写入, 渲染端 spanStart = o.time + spanIndex*span)。淡入 150ms / 弹入 600ms OutElasticHalf / 球过后 150ms 淡出不变。
- 适配: v178 tests/check (tick 段改新签名, 数值断言改按公式算 showAt)。
- 验证: verifier/v204 (tests: 首段 offset=0.66×preempt / 后续 span offset=200 且 span 开始前出现 / 与旧逻辑差异边界 / 状态机边界; check: 公式 + 接线断言)。
- 回归: 全绿 (v60 除外)。

## v205 上时间轴折返箭头与 note 圆等大 (用户反馈: 折返图标太小)
- Timelines.tsx drawTimelineObject: reversearrow 绘制盒子 rad*1.3 → rad*2 (与头/尾圆直径一致; 游玩区 reversearrow 盒子也是 2r)。
- 适配: v98 (箭头尺寸断言 rad*1.3 → rad*2)。
- 验证: verifier/v205 (check: 尺寸断言 + 旧值已删)。
- 回归: 全绿 (v60 除外)。

## v206 滑条放置: 双击已存在末点 = 置红不结束 (用户反馈: 双击稍快就结束放置而不生成红节点) [已被 v208 取代]
- 根因: mousedown 里 `e.detail === 2` 直接 finishSlider, 且排在末点切红逻辑之前 — 双击末点时第二击 (detail=2) 先把滑条结束了; React onDoubleClick 又会再补一次 finish。
- 修复 (EditorCanvas.tsx):
  - detail===2 分支前置判定: 命中已存在末点 (8px 内) 且该末点**不是**本次双击第一击刚放的 (`lastPushRef` 记 idx+时间, 500ms 内同 idx 视为刚放) → `redAnchor = true` + return, 不结束;
  - 第一击刚放的末点 (双击空白) 保持原行为: 第二击 finishSlider 结束放置;
  - `dblRedSkipRef` 吞掉紧随的 React onDoubleClick finish;
  - 四处放点路径 (头 push / mousedown 直推 / window mouseup 提交 / canvas onMouseUp 提交) 都记 lastPushRef。
- 验证: verifier/v206 (check: 置红路径/justPlaced 判定/onDoubleClick 吞掉/4 处 lastPushRef)。
- 回归: 全绿 (v60 除外)。

## v207 滑条节点放置预览幻影吸附网格/辅助线 (用户反馈: 节点放置模式下预览节点不吸附)
- 根因: 控制点落点在 mousedown 里走 v56 吸附公式 (物件吸附+辅助线 snapWithGeo > 网格 gridSnapAt), 但预览幻影 (画布光标 + store.pendingCursor 上时间轴幻影点) 一直用原始未吸附坐标 — 预览与落点不一致。
- 修复 (EditorCanvas.tsx): 吸附公式收敛为 `snapSliderCtrlPoint(p)` (内部同一公式); mousedown 两处落点路径 (直推/候选提交 sp0) 与两处预览 (onMouseMove pendingCursor、renderPlayfield 幻影光标) 全部共用 — 幻影节点 = 点击落点, 所见即所放。头部幽灵 (pendingSlider 为空时) 维持原始光标 + snapPlacement 不变。
- 适配: v145 (控制点公式断言改 snapSliderCtrlPoint), v15 (renderPlayfield cursor 断言容注释行), v84 (snapWithGeo 计数 8 → 直接 6 + 共享 1)。
- 验证: verifier/v207 (check: 共享函数定义/公式内容/pendingCursor 与画布光标接线/落点两处同公式)。
- 回归: 全绿 (v60 除外)。

## v208 滑条放置: 双击 = 末点置红, 永不结束放置 (stable 语义; v206 修正方向错了, 用户复测仍未修复)
- v206 的误判: 以为用户是"双击已存在的末点", 保留了"末点是本次双击第一击刚放的则照常 finish"的 justPlaced 例外 — 但用户的实际操作是 stable 习惯: **在任意位置双击放红节点** (第一击放点, 第二击置红), 恰好命中 justPlaced 例外 → 依旧结束放置。
- 修复 (EditorCanvas.tsx, 取代 v206):
  - `e.detail >= 2` 且命中末点 (8px) → `redAnchor = true` + return, 不再有任何 finish 分支; 双击空白处 = 第一击放点 + 第二击置红 (stable 快速放红锚点操作);
  - 结束放置入口: 右键 (onContextMenu finishSlider, 保留) / 单击头部闭环 (收紧为 detail===1);
  - 无待点时 detail>=2 直接吞掉 — 否则双击头部闭环后第二击会在原地新起一条滑条;
  - dblRedSkipRef 吞 React onDoubleClick finish 保留; lastPushRef/justPlaced 全部移除。
- 适配: verifier/v206/check.mjs 改为转发 v208 (标注已取代); v118 (插点断言间距 600→700, 注释变长所致, 语义不变)。
- 验证: verifier/v208 (check: 吞空双击/置红路径/无 justPlaced+lastPushRef/双击分支无 finishSlider()/单击闭环保留/右键结束保留)。
- 回归: 全绿 (v60 除外)。

## v209 Electron 原生「编辑」菜单 (stable 同款) + 旋转/缩放独立窗口
- 需求: exe 菜单栏补「编辑」菜单 (撤消/重做/剪切/复制/粘贴/删除/全选/仿制/反选/翻转×2/旋转90°×2/旋转.../缩放.../清除音效×2/重置combo组颜色/重置休息时段/前移/后移); 选中相关项无选区时置灰; 仿制 = 打开批量复制窗口; 旋转/缩放 = 打开独立窗口 (功能复制自左侧栏, 左侧栏保留)。
- main.cjs: 「编辑」菜单插在「文件」与 Timing 之间; accelerator 全部 registerAccelerator:false (仅显示快捷键, 不全局截获 — 否则 Ctrl+C/V/X/A/Z/Y 会破坏输入框编辑; 实际按键仍走 App.tsx keydown); 置灰状态经 ipc "edit-menu-state" 上报 {hasMap, hasSelection, hasClipboard} 后 buildMenu 重建。
- store.ts 新方法: selectAllObjects / cut (copy+deleteSelected, 一次 undo) / hasClipboard / nudgeSelectedBySnap (J/K 逻辑下沉, App 快捷键与菜单共用) / clearHitSounds('selected'|'all', hitSound+hitSampleRaw+edgeSoundsRaw+edgeSetsRaw 清零) / resetComboFlags (清全部 newCombo+comboSkip) / resetBreaks (删 rawSections.Events 的 2,/Break, 行, 注释保留, 无 break 不动作); transformDialog 字段 + open/close (无选区不开)。
- 撤销体系: Snapshot 增 rawSections (resetBreaks 改 [Events] 原文需可撤销); copy() 末尾补 emitSelection (复制后「粘贴」置灰态即时刷新)。
- electronBridge/preload: ElectronMenuCommand 增 21 个 edit-* 命令 + menuEditState 通道。
- electronMenu.ts: edit-* 命令分发; 旋转90°/镜像与快捷键同语义 (围绕游玩区中心, v192); 仿制无选区忽略。
- App.tsx: 新增快捷键 Ctrl+X 剪切 / Ctrl+A 全选 / Ctrl+D 批量复制 / Ctrl+Shift+R 旋转窗口 / Ctrl+Shift+S 缩放窗口 (后两者判定在 Ctrl+S 之前, 原 Ctrl+S 无 shift 守卫); J/K 改调 nudgeSelectedBySnap; edit-menu-state 值变化才上报; 挂载 TransformDialog。timingAt import 清理 (不再直接使用)。
- TransformDialog.tsx (新): DraggableDialog, 原点三选+自定义坐标 (与左侧栏同一 store.originMode/customOrigin), 旋转 = 角度+逆/顺时针, 缩放 = 倍率+应用; 窗口保持打开可连续应用。
- Electron 冒烟: 17 个 accelerator 字符串 (含 CmdOrCtrl+,/. registerAccelerator:false) buildFromTemplate + setApplicationMenu 通过。
- 验证: verifier/v209 (tests: 全选/剪切一次 undo/hasClipboard/吸附移动/清音效 selected+all+undo/重置 NC/重置 breaks+undo+无 break 不动作/窗口开关; check: 上述接线断言)。
- 回归: 全绿 (v60 除外)。

## v210 编辑菜单: 「仿制 (批量复制)...」改名「批量复制...」+ 新增「对称...」窗口
- 需求: 菜单项改名; 新增「对称...」(无快捷键, 选中置灰), 打开对称窗口 — 对称轴三选 (选区/中心/自定义), 选区/中心模式选轴向 (竖直线=左右镜像 / 水平线=上下镜像), 自定义模式用两个位置点决定对称轴直线, 两点无法拖到同个位置。
- transform.ts: reflectObjectsAcrossLine 纯函数 (垂足镜像公式 q=p1+d·t, 像=2q−p; 两点重合 len2<1e-9 返回空不动作; 滑条头+全部控制点整体镜像, 转盘不参与 — 复用 transformObjects 约定)。
- store.ts: transformDialog 扩 'symmetry'; symAxisMode/symAxisDir/symP1/symP2 状态 (与自定义原点同款: 画布渲染/拖拽共用); setSymPoint 最小间距 4px (过近沿拖拽方向钳制, 完全重合取 +x 顶开); symAxisLine() 按模式换算线上两点 (选区模式无有效选区/只选转盘返回 null); reflectSelected() (lockNotes/空选区/只选转盘守卫, 一次 undo)。
- EditorCanvas.tsx: 对称窗口打开即画虚线对称轴预览 (紫色 #c586ff, 与橙色原点/青色网格中心区分; 延长 1200px 覆盖区外); 自定义模式画两个端点标记; 端点命中/拖拽 (symPointDragRef, 与自定义原点同级吸附: 物件/辅助线取更近者 + 网格吸附), mouseup 清理。
- TransformDialog.tsx: 对称模式 UI — 轴模式 radio / 轴向 radio (非自定义) / 两点坐标输入 + 拖拽提示 (自定义) / 应用对称按钮; 窗口保持打开可连续应用。
- main.cjs/electronBridge/electronMenu: 「批量复制...」改名, 「对称...」菜单项 + edit-open-symmetry 命令。
- 适配旧断言: v209 (菜单项文案 + transformDialog 类型加 symmetry); v84 (snapWithGeo 计数 6→7, 对称轴端点拖拽新增一处)。
- 验证: verifier/v210 (tests: 竖直/水平/斜线镜像、滑条整体镜像、转盘不变、重合守卫、最小间距钳制、三模式换算、undo 恢复、lockNotes; check: 接线断言)。
- 回归: 全绿 (v60 除外); tsc + vite build 通过。

## v211 锁定间距: 移除 0.25 拍下限 (对齐 lazer; 修复亚 0.25 拍间隔间距不随时间缩小)
- 用户复现: 间隔 <0.25 拍 (1/8、1/16 密排) 放置时, 锁定间距恒为 0.25 拍距离, 不随间隔缩小 — 与 lazer 不符。
- lazer 依据: `CircularDistanceSnapGrid.GetSnappedPosition` fixedTime 分支 = `DurationToDistance(fixedTime − StartTime) × DSmultiplier`, `ComposerDistanceSnapProvider.DurationToDistance` = `duration/beatLength × 100×SV×SM` (GetBeatLengthAtTime 与 GetBeatSnapDistance 的 BeatDivisor 相互抵消), **无任何下限**; 间隔 0 → 距离 0 (叠在前件末端)。
- 修复 (spacing.ts distanceLockDistance): `Math.max(0.25, beats)` → `Math.max(0, beats)`; 负间隔钳 0 (不出负距离/反向)。放置 (snapPlacement) 与拖拽 (EditorCanvas v145/v149 两处) 共用该函数, 一并生效。
- 适配: v145 tests/check (0.2拍 30→24, 负间隔 30→0, 下限断言改 0); v149 tests/check (0.2拍 25→20, 同上)。
- 验证: verifier/v211 (tests: 1/8 拍=17.5px/1/16 拍=8.75px/间隔0=0/负间隔钳0/4 拍=560px 不变; check: 下限删除 + EditorCanvas 两处共用入口不变)。
- 回归: 全绿 (v60 除外); tsc 通过。

## v212 Electron 菜单栏新增「作图」菜单 (多边形生成 / 滑条转连打 / 合并滑条)
- 需求: exe 菜单栏添加「作图」菜单, 3 项: 多边形生成... / 滑条转连打... / 合并滑条。
- main.cjs: 菜单插在「编辑」与 Timing 之间; accelerator 带 registerAccelerator:false (仅显示, 不截获按键, 与编辑菜单同); 置灰规则: 多边形生成按 hasMap, 转连打按 hasSlider (选中含滑条), 合并按 selMulti (选中≥2); edit-menu-state 接收扩字段。
- electronBridge.ts: ElectronMenuCommand 增 compose-polygon/compose-stream/compose-merge; ElectronEditMenuState 扩 hasSlider/selMulti。
- electronMenu.ts: compose-polygon → openConversion('polygon') (无需选区); compose-stream → 选中含滑条才 openConversion('stream'); compose-merge → sel.length<2 忽略, 否则 computeMerge(bm, sel, beatSnap) 非 null 时 applyConversion (与 Inspector onMerge 同一逻辑, 直接应用无弹窗)。
- App.tsx: edit-menu-state 上报扩 hasSlider (bm.hitObjects.some(o => selected.has(o.id) && o.type==='slider')) / selMulti (selCount>=2), 去重 key 五段。
- 验证: verifier/v212 (纯 check 接线断言; 功能本体 polygon/stream/merge 各有历史 verifier 覆盖)。
- 回归: 全绿 (v60 除外); tsc 通过。

## v213 上方时间轴: 选中滑条头/折返点/尾节点, 单独加 hitsound (对齐 osu!stable)
- 需求: stable 中可在上方时间轴选中滑条某个节点, W/E/R 只对该节点加 Whistle/Finish/Clap。数据层 (edgeSoundsRaw/edgeSetsRaw 解析/写回/复制/反转/拆分) 与播放端 (hitSounds.ts nodeSounds 逐 edge) 本就保真, 缺的只是 per-edge 编辑交互。
- 新模块 src/osu/edgeSounds.ts (纯函数): parseEdgeSounds (raw 缺省/段缺失回落 hitSound, 与播放端同语义) / setEdgeSoundBit (materialize 时先按当前有效值填满全段 — 只改目标端点, 其余端点听感不变) / toggleEdgesHitSound (三态: 未全有则全置位) / setEdgeSoundBitAll (物件级位同步所有段) / resizeEdgeStrings (slides 变化同步 edge 串段数)。
- timelineHit.ts: 新增 timelineNodeHit (只命中滑条节点 k=1..slides, 返回 {id, edge}; 头圆不走此路); timelineMarkerHit 不动。
- store.ts: selectedEdges: Map<objId, Set<edge>> (节点宿主滑条保留在 selected 中 — J/K/删除等物件级操作照常); selectEdges (additive 同物件加选/减选) / clearEdgeSelection / isEdgeSelected / toggleEdgeHitSound (一次 undo); select/toggleSelect/clearSelection/selectGreenLines/selectWithGreens/deleteSelected 同步清 edge 选区; setSelectedHitSoundBit 扩展: edge 串已 materialize 的滑条全段同步置/清位 (stable: 整条选中时音效作用到所有节点, 否则显式段盖掉回落导致快捷键静默失效)。
- Timelines.tsx: mousedown 优先级 = 拖尾把手 (8px) → hitTestNode (折返点/尾端圆 → selectEdges, 无拖拽) → hitTestMarker (头/物件级) → 连体条 → 绿线药丸 → 框选; 拖尾把手单击未拖动 → 选中尾节点 (finishMarkerDrag tail 分支); 拖尾改 slides 后 resizeEdgeStrings + 丢弃超范围节点选区 (顺手修了 edge 串长度与 slides 脱节的隐患); drawTimelineObject 增 edgeSel (选中节点黄环, 节点选区存在时整条不再高亮) / edgeSounds (节点圆内侧顶部 hitsound 色点: Whistle 绿/Finish 红/Clap 蓝, 避开下方 sample 药丸)。
- App.tsx: W/E/R 经 hs() 路由 — selectedEdges 非空走 toggleEdgeHitSound, 否则物件级; Q (newCombo) 保持物件级。
- 适配: v24 (W/E/R 断言改 hs() 路由形式)。
- 验证: verifier/v213 (tests: 回落/materialize/三态/全段同步/段数截断补长/节点命中含头不命中与近者胜; check: 上述接线断言)。
- 回归: 全绿 (v60 除外); tsc 通过。

## v214 全局禁用 UI 文本选择 (框选经过按钮/面板文字不再误选文本)
- 问题: 框选/拖拽经过顶栏「音量」「显示设置」等 UI 文本时, 浏览器进入原生文本选择态, 干扰框选交互。
- 修复 (src/index.css): body 全局 user-select: none; input/textarea/contenteditable 保持 user-select: text (输入编辑不受影响)。工程内大部分组件本就有 select-none, 此处兜底全局。
- 验证: verifier/v214 (check: CSS 规则断言); vite build 通过; 回归全绿 (v60 除外)。

## v215 暂留模式 (关打击动画) 滑条头/尾圈同单点淡出, 不随滑条身一起消失
- 问题: 关「note 打击动画」(点击特效开, 即暂留模式) 时, 滑条头/尾圈随滑条身一起消失 (身体 240ms 淡出后整体剔除), 不像单点那样命中后原大小 800ms 渐隐。
- lifecycle.ts: isVisibleAt 暂留窗口 (hitExplosion 开 + hitAnimation 关 → HIT_LINGER 800ms) 从单点扩到滑条 — 头/尾圈残留期不被 240ms 窗口剔除; alphaAt 不动 (滑条身仍按「滑条渐出」开关 240ms/立即消失)。
- renderer.ts: 新增 sliderTailLingerAlpha(dtEnd) 纯函数 (暂留模式下结束时刻 = 尾圈命中, 800ms 线性渐隐, 非暂留/未结束 null); renderPlayfield 暂留滑条 alpha<=0 不剔除, drawSlider 新增 nodeLinger 参数;
  - 头圈: 暂留模式命中后 (dt>=0) 独立 alpha (sliderHeadHitState, 不再乘滑条身 alpha — 短滑条身先没头圈继续渐隐), 缩圈同单点贴边 (pinAfterHit, v183 语义), 本体变白 (沿用 v203);
  - 尾圈: 暂留模式结束后独立 alpha 0.5×渐隐 + 变白 (同单点 v200), 不随滑条身淡出; 其他模式 (打击动画开/点击特效关) 行为完全不变。
- 适配: v147 (滑条可见窗口断言改结束+800ms + isVisibleAt 源码断言适配), v144 (drawApproach 调用点 2→4)。
- 验证: verifier/v215 (tests: 尾圈渐隐曲线/非暂留 null/头暂留回归/滑条窗口延长与边界; check: 接线断言)。
- 回归: 全绿 (v60 除外); tsc 通过。

## v216 播放中滚轮 seek 音质修复 — 总线 dip 改 per-source 交叉淡变
- 问题: 播放中滚轮 seek 后音乐听起来破碎/发闷 (类低码率/削频); 暂停再播放正常。
- 根因: seekWhilePlaying 每个滚轮步进都对共享 musicBus 增益 setTargetAtTime(0, τ=1.5ms) 瞬时拉零再恢复; 滚轮连击 = 全轨反复静音, 且下一次 cancelScheduledValues 会截断恢复斜坡使增益长时间偏低。暂停→播放路径不动总线增益, 故正常。
- 修复 (store.ts):
  - 新增 sourceGain (每条常速 source 独立增益) / tempoGain (变速支路独立增益);
  - seekWhilePlaying: 移除总线 dip — 旧 source 经其 sourceGain ~12ms 淡出后 stop(now+50ms), 新 source 经新 sourceGain 从 0 起 ~10ms 淡入 (交叉淡变); 变速支路 dip 只作用 tempoGain (恢复目标 1, 非 musicGain);
  - play(): 常速 source 同样经 sourceGain (启动 ~10ms 淡入防咔哒); stopSource 释放 sourceGain; ensureTempoNode 接线改 node→analyser→tempoGain→音乐总线; setAudio 换歌清空 tempoGain。
- 适配: v193 (总线 dip 断言 → 交叉淡变断言), v144 (source/tempoNode 直连总线断言 → 经中间增益)。
- 验证: verifier/v216 (字段/交叉淡变/变速支路/播放接线/释放/既有语义回归断言)。
- 回归: v101/v122/v144/v193/v198/v215/v216 全绿; tsc 通过。

## v217 全局等比缩放 — 窗口变小时四周控件与中间区一起等比缩小
- 问题: 原布局「四周 shrink-0 固定 (左右栏 w-56/页签栏/上下时间轴) + 中间 flex-1 弹性」, 窗口分辨率变小时只挤压中间游玩区, 四周控件不变小。
- 方案 (App.tsx + src/osu/uiZoom.ts): 最外层套 zoom 容器 — zoom = clamp(min(窗口宽/2560, 窗口高/1440), 0.6, 1), resize 监听更新; 外层 h-screen w-screen 不缩放, 内层布局尺寸 = 100/zoom vw/vh, 经 zoom 缩放后恰好填满窗口。单一系数 X/Y 等比不变形; 不等比余量由 flex-1 中间区吸收 (不留白)。
- canvas 适配 (修正「上时间轴物件圆不缩小/游玩区与上下时间轴间距比例变化」): CSS zoom 下 getBoundingClientRect/clientX 是视觉 px, canvas 内固定 px 绘制 (RAD=24 物件圆/药丸/RESERVED 面板预留) 必须在布局 px 空间 — uiZoom.ts 提供 zoomRect (布局空间 rect) / zoomClientX/Y (事件坐标转换) / zoomDpr (= dpr×zoom, backing = 屏幕物理像素不糊); EditorCanvas 与 Timelines 全部改走该约定, 手柄命中容差按视觉 px 基准换算, __osuToClient 乘 zoom 回视觉坐标 (CDP 兼容)。
- 验证: verifier/v217 (共享模块/容器/两 canvas 组件适配断言); tsc + vite build 通过。

## v218 滑条长度按当前节拍细分的 1/2 对齐 (如 1/4 -> 1/8)
- 需求: 放置滑条时 (游玩区与上方时间轴), 滑条长度始终按当前节拍细分的 1/2 对齐; 仅当 当前细分×2 存在于配置 (BEAT_SNAP_OPTIONS = 1/2/3/4/6/8/12/16) 时才用 ×2, 否则退回当前细分 (1/12 -> 1/12, 1/16 -> 1/16)。滑条节点仍随编辑实时改动, 不参与对齐。
- 实现: 吸附细分只在 snapSliderLength 内换算一次, 游玩区放置 (finishSlider/finishFreehand -> placementLength)、上方时间轴放置预览 (pendingSliderTimeline -> placementLength)、节点编辑重吸附 (resnapSliderLength) 全部共用; 放置时刻 snapPlacementTime 仍按当前细分 (beatSnap), 控制点位置不参与对齐。
- 验证: verifier/v218。

## v219 滑条长度对齐补漏 (亚 tick + 游玩区预览截断)
- 问题①: 长度低于 1/2 细分 (几何不足 1 个长度细分 tick) 的滑条在上方时间轴中仍没对齐 — placementLength 亚 tick 分支受 20px 下限 / geoCap 钳制, 时间轴预览/落盘退化为不对齐的 floor(几何)。
- 修复①: snapSliderLength 对齐到 1 tick, 允许超几何全长; 亚 tick 分支去掉 20px/geoCap 钳制。
- 问题②: 游玩区域中正放置的预览滑条长度完全没对齐。
- 修复②: drawPendingSlider 滑条身按 placementLength 吸附后长度截断 (truncatePathAtLength), 与 finishSlider 落盘/时间轴预览同一规则; 控制点/连线不截断, 仍随光标实时走。
- 验证: verifier/v219。

## v220 右下角 FPS 帧数显示 — 悬浮于其他所有控件之上
- 实现 (FpsCounter): 独立 rAF 计帧, 每 500ms 刷新读数; fixed 右下角, z-[100] (高于 v120/v191 的 z-[60] 模态), pointer-events-none 不挡交互; 挂在 App 外层 (v217 zoom 容器之外), 不随 uiZoom 缩放。
- 验证: verifier/v220。

## v222 滑条转连打: 指数变化曲线 + 指数参数 (两位小数, 仅选中指数变化时显示)
- stream.ts: StreamCurve 增 'expo', StreamParams 增 exponent (>0, 默认 2); 权重 w(p) = 1 + (k-1) * p^exp — exp=1 同线性, >1 前慢后快, 0<exp<1 前快后慢, exp 钳制 >=0.01。
- StreamDialog.tsx: 间距曲线下拉框增「指数变化」; 指数输入框 (step 0.01, 写入时四舍五入到两位小数) 仅 params.curve === 'expo' 时渲染; 附带 同线性/前慢后快/前快后慢 提示。
- 验证: verifier/v222。

## v223 游玩区平移/缩放 — 左侧栏开关 + x/y/scale 输入框, 中键拖动
- 需求: 左侧栏添加开关, 开启后支持按住鼠标中键拖动游玩区域; 开关下方是游玩区 x 偏移 / y 偏移 / 缩放倍率 (默认 1.0) 三个输入框, 简写 x/y/scale。
- 实现: store.ts 新增 playfieldPan 字段; playfieldTransform = 适配变换上叠加偏移 (osu px, 不随用户倍率放大) 与缩放倍率, 等价 translate(ox,oy) scale(base) translate(panX,panY) scale(s); 渲染/命中/toOsu/__osuToClient 共用。关闭时退回默认适配视图 (已设值保留, 不写入谱面)。
- 验证: verifier/v223; 同步更新 v210/v217 适配。

## v224 游玩区平移控件布局调整
- 需求: x/y 两个输入框平分一行; scale 改名「缩放」并移到「游玩区平移」按钮同一行, 按钮宽度缩为之前一半左右, 缩放放按钮后面。
- 实现 (App.tsx): 开关按钮半宽 (flex-1) 与「缩放」输入框同一行; x/y 两个 PanNumInput grow 平分下一行。
- 验证: verifier/v224。

## v225 文本补偿缩放 — 小窗口下文本不再随控件同比例缩得过小 (方案A)
- 问题: v217 全局等比缩放用单一 zoom 系数, 窗口变小时文本与控件一起线性缩小 (zoom=0.6 时 12px 文本视觉仅 7.2px), 不可读。
- 方案: 控件尺寸仍按 uiZoom 线性缩, 文本按更缓的 sqrt 曲线缩 — textZoom = clamp(√uiZoom, 0.8, 1) (uiZoom.ts), 布局空间补偿系数 textZoomComp = textZoom/uiZoom。
- 实现: App.tsx zoom 容器挂 ui-zoom-root 类 + 注入 CSS 变量 --fs-comp (随 useUiZoom resize 重渲染更新); index.css 容器兜底字号 calc(16px × --fs-comp) + text-xs..text-3xl 及 text-[9/10/11px] 覆盖 (calc(原值 × --fs-comp), 特异度 0,2,0 压过 tailwind 单类), line-height 保持原值防裁剪。
- 适配: v217 (import 断言放宽 — 同排新增 textZoomComp)。
- 验证: verifier/v225 (补偿函数/变量挂载/CSS 覆盖断言); tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v226 播放中滚轮 seek 音质再修复 — v216 交叉淡变改回硬切换 (2ms 防爆音斜坡)
- 问题 (用户反馈): 播放时滚滚轮音乐仍降质; 播放时用鼠标点时间轴不复现。
- 根因: v216 的 ~10-20ms 交叉淡变单次 seek 不可闻, 但滚轮连击时链式重叠 — 任意瞬间 2~4 份"同曲不同进度"同时发声 (播放中滚轮步长 ~0.5s/格), 听感 = 持续双重曝光/响度抽动 = 降质; 时间轴点击 seek 走 pause/play 零重叠硬切, 故干净。
- 修复 (store.ts seekWhilePlaying): 统一切换时刻 startW = now+3ms — 旧源经 sourceGain 2ms 线性斜降到 0、startW+10ms 停止 (非 v216 的 50ms 长尾); 新源 startW 启动、2ms 斜升到 1; 重叠窗 ~2ms 仅防爆音咔哒, 听感 = 即时跳位 (对齐 stable/lazer)。变速支路 tempoGain dip 缩为贴紧切换点的单次 ~5ms 短窗 (不再"立即拉零+延迟恢复")。
- 适配: v216 (交叉淡变形状断言废止, 保留接线/总线断言), v193 (锚定改 ≤4ms, 淡变断言改硬切换)。
- 验证: verifier/v226; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v227 红线重置滑条 SV 为 1.0x (stable 语义; 推翻 v148 的 lazer 语义)
- 用户反馈: 遇到紅線不會重製成1.0x滑條速度。
- 考据: stable 行为 = 红线重置 SV ("不重置"只是 2020 社区提案/lazer 改动, ppy/osu#10267); v148 曾按 lazer ControlPointInfo 分表语义改为不重置, 本编辑器对齐 stable, 复原重置语义。
- 实现: parser.svPointAt 红线清零 (p.uninherited → green = null); duplicate.ts 局部 svAt 同步 (红线 sv=1); patternLibrary 两查询点共用 svPointAt 自动获得新语义。timingAt 采样语义 (红线清零 green 供 hitsound) 不变。
- 适配: v148 (SV 断言全部反转为重置语义, 滑条路径末端延长断言保留), v149 (distanceLockDistance 红线后期望值 400→200)。
- 验证: verifier/v227 (源码结构) + v148 tests.ts (行为数值); tsc 通过。

## v228 物件/节点拖拽移出画布不中断
- 用户反馈: 拖住物件不放開時即使游標滑到UI區域回來playfield一樣會拖著物件。
- 根因: onMouseLeave 对物件拖拽 (dragRef)/节点拖拽 (nodeDragRef)/节点整体拖动 (nodesMoveDragRef) 没有豁免, 光标一出画布就调 onMouseUp 终止拖拽 (v50/v74 只豁免了缩放/旋转/手绘)。
- 实现 (EditorCanvas.tsx): ① onMouseLeave 豁免三个拖拽 ref; ② window mousemove: 拖拽激活且事件目标不在画布上时复用 onMouseMove 拖拽分支继续跟随 (位移按 mousedown 快照重算, 幂等); ③ window mouseup: 三者其一仍在则走 onMouseUp 同一收尾 (commit/undo/切红; 画布内松开时 React onMouseUp 已清 ref, no-op)。
- 适配: v74 (onMouseLeave 条件断言放宽)。
- 验证: verifier/v228; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v229 游玩区平移功能支持 Alt+滚轮缩放
- 需求: 游玩区平移改成支持 alt+鼠标滚轮缩放大小。lazer 语义考据: 时间轴 Alt+滚轮 = 缩放 (ZoomableScrollContainer.OnScroll), 游玩区纯 Alt+滚轮在 lazer 空闲, 可安全占用。
- 实现 (EditorCanvas.tsx onWheel): 仅 playfieldPanEnabled 时生效; 每刻度 ×1.1 (Math.pow(1.1, -dy/100), 滚轮上 = 放大), 钳 0.1..10 (同左侧栏缩放输入框); 以光标为焦点 — panX/panY 同步补偿 (s0-s1)*p, 光标下内容不动; deltaMode 归一化与 wheelSteps 同款; Alt 分支 return, 不再触发 wheelSeek, 非 Alt 保持 v193 seek。
- 验证: verifier/v229; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v230 滑条转连打指数曲线修复 — 段末采样 (指数越大变化越集中尾部)
- 问题 (用户反馈+截图): 指数变化没效果 — 按数量 4 / 变化到 5% / 指数 10 时 4 个单点几乎等距。
- 根因: 权重采样在段中点 p=(j+0.5)/(n-1) 恒 <1, 高指数时 w=1+(k-1)p^exp ≈1 全程平坦 (末段也只采到 p=5/6, (5/6)^10≈0.16, 远不到 k=0.05), 指数越大反而越平坦。
- 修复 (stream.ts streamFractions): expo 曲线采样点改段末 (j+1)/(n-1) — 末段间距恰 = endPercent% (端点语义, 与「变化到 %」字面一致), 指数越大变化越集中在尾部; linear/bell/bellInv 保持段中点采样不变。截图场景 (n=4, k=0.05, exp=10) 分布从 [35.2%,35.1%,29.7%] 变为 [49.2%,48.4%,2.5%]。
- 适配: v222 (weight 调用断言更新)。
- 验证: verifier/v230 (行为数值: 端点语义/指数单调性/exp=1 线性剖面 + linear/bell 中点采样回归); tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v233 滑条点拖拽死区 4px → 1 格 (与 hitcircle 一致)
- 用户反馈: 滑條點移動有死區, 要過一定值才會移動, 不像 hitcircle 有 1 格位置移動就會反應。
- 实现 (EditorCanvas.tsx): nodeDragRef (单节点) 与 nodesMoveDragRef (整体拖动) 的 moved 阈值 `Math.hypot(...) <= 4` → `Math.abs(dx)+Math.abs(dy) <= 1` (同物件拖拽 dragRef 表达式); 未移动时 mouseup 仍视为点击 (Ctrl 切红/白点切红语义保留)。v66 手绘滑条候选阈值 (<=4px) 非节点拖拽, 不变。
- 验证: verifier/v233; tsc 通过; v117/v118/v119 回归绿。

## v234 操作提示迁移至右侧栏 Inspector
- 需求: ① 按住 Alt 的滑条节点控制提示移到右侧栏; ② 开启游玩区平移后「按住中键拖动游玩区、Alt+滚轮缩放游玩区」说明也写到右侧栏。
- 实现: 删 EditorCanvas 画布内 fillText 提示 (原 v117); Inspector.tsx 新增 HintsBlock — select 工具+非播放+未进节点层+选中有滑条时显示节点控制文案, playfieldPanEnabled 时显示平移/缩放说明; 单选与多选/未选中分支均渲染。
- 适配: v117 (画布提示文案/条件断言改写为 Inspector 侧)。
- 验证: verifier/v234; tsc 通过。

## v231 滑条控制点样式: 默认 stable 方格 (显示设置可切 lazer 圆点)
- 需求: 滑条控制点改成默认 stable 滑条点 (红/白色小方格), 支持在显示设置里切滑条点类型 (stable/lazer)。
- 实现: displaySettings 新增 `sliderPointStyle: 'stable'|'lazer'` (默认 stable, 白名单解析, 配套新增 StrDisplayKey/setDisplayString 字符串型持久化通道); DisplayPanel 加「滑条控制点样式」下拉; renderer 新增 drawControlPointHandle 统一入口 — stable = fillRect/strokeRect 实心方格 (~8 屏幕像素宽: g 带 dpr×zoom×scale 总变换, getTransform 反算 osu 单位边长 10/k, 描边 1 屏幕像素; 初版 osu 单位 5/14 实测偏差, 按用户截图两轮校准), lazer = 原圆点, 红白/#222 描边语义不变; stable 模式下控制点连线同步改 1 屏幕像素 (lazer 保持 2 osu 单位); drawSelectionDecor 控制点循环与 drawPendingSlider (含幻影尾点) 3 个调用点全走该入口。
- 适配: v76 (幻影尾点断言改 drawControlPointHandle 调用), v132 (DisplayPanel 行计数 6→8)。
- 验证: verifier/v231; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v232 物件选中效果: 默认 stable hitcircleselect (显示设置可切 lazer 描边)
- 需求: 物件选中效果改成默认 stable 效果 (仅在单点、滑条头、滑条尾显示皮肤中的 hitcircleselect.png, 滑条不描边), 支持在显示设置里切选中效果类型 (stable/lazer)。
- 实现: skin 加载 `hitcircleselect.png` (@2x 走既有 fileVariants+skinScaleAdjust 通道), 无图时程序化回退 (drawHitcircleSelect: 256px 浅蓝 #99ccff 圆角方框, arcTo); displaySettings 新增 `selectionStyle: 'stable'|'lazer'` (默认 stable); DisplayPanel 加「物件选中效果」下拉; renderer drawSelectionDecor 分支 — lazer = 原描边环/虚线环全保留, stable = 滑条不描边, 改在滑条头/滑条尾 (路径终点) 与其他物件中心画 hitcircleselect (drawSelectionBox, 与 hitcircle 族同公式: 边长 = 圈直径 2r × 贴图固有宽/128, 与圆圈一样大, hitcircleselect 已入 INTRINSIC_SIZE_KEYS; 初版 r*2.2 盒子偏小已修正); 控制点连线与手柄两模式都保留 (样式由 v231 控制)。
- 验证: verifier/v232; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v235 吸附到物件总开关 (左侧栏, 默认开启)
- 需求: 左侧栏「网格中心」按钮下方加一个控制吸附到物件的开关, 控制所有吸附到物件上的行为, 默认开启。
- 实现: store.objectSnapEnabled (默认 true) + setObjectSnapEnabled; EditorCanvas 四处拦截 — snapWithGeo 入口 (放置/拖拽/节点拖拽的物件点 + 几何辅助 + 间距辅助线吸附总入口), geoSnap/geoDistSnap 入口 (物件拖拽时几何/间距修正回调直连), snapDragDelta 调用处 (拖拽整体校正); 关闭后仅余网格吸附。App.tsx 网格中心区块后加「吸附到物件」按钮 (Target 图标, 青色高亮 = 开)。
- 验证: verifier/v235; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v236 对称滑条 (Inspector + 作图菜单「对称滑条...」)
- 需求: 选中单个滑条时, 右侧栏与 exe 作图菜单加「对称滑条」入口; 弹窗支持将选中滑条所有节点做 轴对称/中心对称/中心旋转n次/方向平移n次, 拼到原滑条头/尾(可选)并预览; 节点编辑后预览实时跟随; 自定义对称轴/对称中心/旋转中心/旋转角/平移向量与向量增量; 仿批量复制的每份节点大小缩放增量。
- 实现: 新纯函数模块 src/osu/convert/symSlider.ts (computeSymSlider(bm,o,params)); 新弹窗 src/components/convert/SymSliderDialog.tsx (仿 DuplicateDialog: DraggableDialog + loadParams 持久化 + setConversionPreview 预览, 节点内容签名作 useMemo 依赖以响应就地节点编辑)。
  - 变换 (二轮修正后): axis = 直线镜像, 轴向三选 v/h/custom (删选区/中心 — 拼接对齐后轴位置被平移覆盖), v/h 轴过拼接锚点 (仅方向有效), custom = axisP1/axisP2 两点直线 (画布紫色端点+虚线可拖, v210 同款); point = 绕拼接锚点 180° (对称中心配置删除, 拼接对齐后等价); rotate = 第 i 份绕旋转中心转 i×rotateDeg (中心三选+可拖圈保留); translate = 第 i 份位移 i·(dx,dy) + i(i-1)/2·(ddx,ddy) (缩放锚点三选保留); 缩放 1+i×scalePerCopy (axis/point 锚点=拼接点)。axis/point 份节点反转 (镜像翻手性)。
  - 拼接 (链式对齐平移, 整数偏移): 拼尾 = 份1首→原滑条尾, 份i首→份i-1末; 拼头 = [份1..份n, 原] 序列, 份n末→原头, 份i末→份i+1首; 对齐后接缝恒重合走红锚点去重; none = 独立副本不平移。length = 几何总长, 拼尾 endTime += duration×(份数+1), 拼头 time -= duration×(份数+1)。
  - 自定义锚点画布圈: point/rotate/translate 锚点选自定义时画布渲染青色圈可拖拽 (store.symSliderAnchorView + symSliderAnchorDragHandler, dupVector 同款非响应式模式; mousedown 命中 12px 同自定义原点, 拖拽吃物件/辅助线吸附无网格), Dialog 回写 customX/customY (1 位小数)。
  - 接线: store.conversionDialog 加 'symSlider'; Inspector 单选滑条转换区按钮; electronBridge 命令 compose-sym-slider + editState 加 selSingleSlider (App.tsx 上报, main.cjs 置灰); main.cjs 作图菜单「对称滑条...」。
- 适配: v36/v64/v65 (conversionDialog 联合类型正则加可选组, 断言语义不变), v84 (snapWithGeo 调用点计数 7→9, 锚点圈+轴点拖拽各增 1 处), v210/v223 (mouseup 重置行加 symAxisPointDragRef)。
- 验证: verifier/v236 (102 项断言); tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v237 圆弧转贝塞尔误差驱动减点
- 需求: 滑条「圆弧→贝塞尔」尽量生成更少控制点 (用户确认: 误差驱动自动最少段)。
- 实现 (src/osu/convert/bezierPath.ts circleToBezier): 固定 90° 分块 → 误差驱动 — ARC_BEZIER_ERR=0.2 (osu px), unitArcBezierErr (单位弧 64 采样最大径向误差) + maxArcAngleForErr (二分 40 次), thetaMax = clamp(误差≤0.2px 最大角, 90°, 180°), chunks = ceil(|total|/thetaMax); k 公式/带符号 step/共线退化不变。
- 效果: 小半径大弧减段 (r=30 的 150° 弧 2 段→1 段, 减段弧误差 ≤0.2px); 大半径弧受 90° 下钳与旧实现逐点一致 (v41 Crystalia 用例不受影响)。
- 适配: v41 (旧 90° 分块表达式断言改 thetaMax)。
- 验证: verifier/v237 (减点实证/段数单调/误差阈值/端点精确/共线退化); tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v238 批量复制间隔 (拍) 改节拍分数下拉 (v239 取代为 a×1/b)
- 需求: 批量复制的间隔 (拍) 改成 1/2、1/4、1/8、1/16 等形式, 而不是 0.25 拍。
- 实现 (DuplicateDialog.tsx): DraftNum 小数输入 → select 下拉 (v239 起进一步改为 a×1/b, 见下); 内部 params.intervalBeats 仍存数字拍, computeDuplicate/时间换算/持久化格式不变; DOM 钩子 data-conv="intervalBeats" 不变。
- 适配: v65 (五个参数输入断言中 intervalBeats 改 select 形式); v239 起本验证器断言更新为 BEAT_DENOMS 形态。
- 验证: verifier/v238; tsc 通过。

## v239 批量复制间隔 = a × 1/b 拍 (a,b 均为整数)
- 需求: 间隔 (拍) 应该是 a*1/b 拍 (a,b 均为整数), v238 只有 1/b, 补充分子 a 的设置。
- 实现 (DuplicateDialog.tsx): INTERVALS 下拉 → BEAT_DENOMS 分母表 [1,2,3,4,6,8,12,16] + splitBeat 分解 (数字拍 → 首个使 v*b 为整数且 >=1 的分母; 遗留小数回退 a=v,b=1, 用户改 a 取整后收敛); UI = DraftNum(a, min 1) +「× 1 /」+ select(b); 回写 intervalBeats = a/b (数字拍, 持久化/计算不变)。
- 验证: verifier/v239; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v240 直线滑条新增白点切换为圆弧
- 需求: 给已有的直线滑条新增白色控制点时滑条类型应切换为圆弧 (此前新增后仍为直线)。
- 实现 (EditorCanvas.tsx 节点层插入处): 插入前记 wasLinear, insertSliderPoint + applySliderPoints 后若仍为 'L' 且恰 3 点 (头+新点+尾) 则 curveType='P' (stable 同款); 仅插入路径升级 — resolveSliderCurveType 的 L 保持语义不动, 拖动/删除已有折线 (L 3 点) 节点不变形。
- 适配: v26 (插入后 resnap 断言放宽为含中间升级步骤的同序匹配)。
- 验证: verifier/v240; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v241 放置态: 放置工具下 Q/W/E/R 预设下次放下物件的 NC/音效
- 需求: 放置物件前按 Q 能将下次放下的物件设置为 new combo; W/E/R 也能为下次放置的物件增加音效。
- 实现: store.placeNewCombo/placeHitSound + toggle 方法 (默认关; **NC 仅一次 — 放置一个物件后自动复位, W/E/R 音效位放置后保持**); App.tsx 快捷键按 store.tool 分流 — 放置工具 (circle/slider/spinner) → 放置态, select 工具 → 选中物件/时间轴节点 (v213) 原语义; EditorCanvas 四处放置点 (circle/finishSlider/finishFreehandSlider/finishSpinner) 读放置态并在放置后复位 NC — **slider/spinner 原硬编码 newCombo:true 移除, 统一由放置态决定 (行为变化: 放滑条/转盘默认不再自动 NC, 需要时按 Q)**; 左栏工具区放置工具激活时显示放置态指示行 (NC/口哨/Finish/拍手 高亮)。
- 验证: verifier/v241; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v242 转换窗口关闭时保存参数
- 需求: 批量复制等窗口应该在关闭时保存其值, 而不是仅在应用时保存。
- 实现 (src/components/DraggableDialog.tsx): 新增 useSaveParamsOnClose(key, params) — ref 跟随最新值, 卸载 cleanup 落盘 (应用/取消/X 关窗统一覆盖); 五个转换弹窗全部接线 (duplicate/stream/split/polygon/symSlider); 应用按钮的即时 saveParams 保留 (双写无害)。
- 验证: verifier/v242; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v243 对称滑条圆弧 (P) 源先转贝塞尔
- 需求: 使用对称滑条时, 如果当前所选滑条是圆弧滑条, 需要转成贝塞尔, 否则滑条形状不一致。
- 实现 (src/osu/convert/symSlider.ts computeSymSlider): curveType='P' 时先 sliderToBezierSegments+segmentsToPoints 展开为贝塞尔节点 (v237 误差驱动减点, 误差 ≤0.2px), workType='B' 参与变换/拼接 — 否则拼接结果恒 'B', 原弧段被当普通贝塞尔控制点 (三点一段折线/二次曲线), 与原圆弧形状不一致; join='none' 独立副本 curveType 也用 workType (随转换变 'B'), length 按 workType 几何重算; L/B 源不受影响, 原对象不被改。
- 验证: verifier/v243 (副本/拼接 curveType + 几何一致性采样 ≤1px + 拼接全长 ≈2× 弧长 + 时长翻倍 + L/B 源不变); tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v244 放置态指示移到右侧栏顶部且始终显示
- 需求: 将放置态 Q/W/E/R 预设下次放置物件的 UI 移到右侧栏顶部且始终显示。
- 实现 (src/App.tsx): 左栏工具区的 v241 放置态指示行 (仅放置工具时条件显示) 移除, 同款指示块 (NC(Q)/口哨(W)/Finish(E)/拍手(R) 高亮逻辑不变) 改挂右侧栏 <Inspector /> 之前 (border-b 分隔), 不再按 store.tool 条件渲染 — select 工具下也可见。
- 适配: v241 (指示位置断言注释更新为右栏顶部, 断言本身不变)。
- 验证: verifier/v244; tsc 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v245 全选/播放性能优化 (CDP 实测驱动)
- 需求: 2000 物件全选达到 60 帧; 1000 绿线播放达到至少 240 帧。
- profile (verifier/v245/profile.mjs, 无头 Edge + CPU Profiler, 合成 2000 物件/1000 绿线谱面):
  基线 A=2.8fps (帧忙 337ms — 逐物件选中装饰的软件光栅占满), B=60fps (帧忙 11.3ms —
  emitPlayback 每帧全量 React 重渲 + 两时间轴全量重绘 + svPoints 每帧排序 + measureText 每药丸每帧)。
- 优化 (A): renderer.ts 选中装饰离屏层缓存 drawSelectionLayer (键 = 数据版本+选区签名+变换矩阵+画布尺寸+
  样式开关+皮肤序号; 帧内 1 次 drawImage; v40 不可见选中物件画装饰语义保留; 视觉差异: 装饰整体盖在物件上层);
  followPointPairs 按谱面缓存; EditorCanvas currentQuads (选中框包围盒)/computeCombos 帧级 memo;
  网格/背景/边框静态层缓存 (staticLayerRef)。
- 优化 (B): store.emitPlaybackFrame 逐帧独立通道 + usePlaybackFrame (仅 TimingPanel 订阅; emitPlayback
  保留给脏标记/弹窗/菜单等低频轻量刷新); Timelines 上时间轴红/绿线同色合批一次 fill、节拍 tick 按级合批、
  药丸 measureText 缓存 (measureCached)、svPoints/stackInfo/computeCombos 帧级 memo;
  BottomTimeline 静态层缓存 (kiai/刻度/红绿线/书签/粉点全入层, 只播放头逐帧画; 粉点 arc 改 2px 方块)。
- 实测结果 (GPU 无头 Edge): A 2.8fps→240fps (rAF 上限, 帧忙 0.25ms), B 60fps→240fps (帧忙 0.26ms)。
  运行: node verifier/v245/profile.mjs (需 7100 dev server; PROFILE_SW=1 软件渲染对照)。
- 适配: v40 (装饰统一层构建) / v56, v61, v78, v117, v119, v152, v158, v159, v161, v162, v190 (源码断言跟随新形态)。
- 验证: verifier/v245; tsc -b 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。
## v246 普通谱面跑不满帧率修复 (波形合批 + backing 取整 + 层裁剪)
- 需求: v245 后全选/播放场景帧数明显提高, 但打开任意谱面都跑不到 240 帧。
- 根因 1 (波形面板, 最大头): drawWave 逐列 fillRect (3757 列/帧 × 240fps ≈ 90 万次/秒; CDP fillRect 探针
  实测为全部画布操作第一位, 分辨率越高列越多; 波形面板默认开启 → 任意谱面受害)。修复: 列汇成单 Path 一次 fill。
- 根因 2 (backing 分数尺寸): 三处画布 `c.width !== r.width * dpr` 整数比分数恒真 → 每帧重建位图
  (uiZoom×devicePixelRatio 几乎恒为分数, 非 2560×1440 窗口或 125%/150% 缩放必中)。
  修复: uiZoom.ts fitCanvas (round + 返回 sx/sy 精确变换系数), 主画布/上/下时间轴三处统一。
- 根因 3: v245 静态层/选中装饰层整画布尺寸, 大窗口高 dpr 每帧全幅 blit 带宽浪费。
  修复: 静态层裁剪到游玩区设备矩形 (+8px), 选中层裁剪到选区内容包围盒 (路径点 ± 2r+16, 画布外不贴)。
- 附带: 上时间轴物件数字 fillText 位图缓存 fillTextCached (密集谱面 600+ 次/帧字形光栅热点)。
- 实测 (verifier/v245/profile.mjs, 无头 Edge RTX4090 硬件加速, 2K 窗口 dsf1.5):
  C 静止 203.6→239.3fps, D 播放 216.5→237.7fps, A/B 顶满 240;
  场景E 密集播放 (PROFILE_E_INTERVAL): 20/s (≈300BPM 1/4 连打) = 239.5fps, 40/s = 217fps, 100/s ≈ 113fps
  (同屏 ~220 物件缩圈 overdraw 的光栅面积上限, 超真实谱面密度 5 倍, canvas2d 物理上限; 物件本体
  draw call 合成缓存实测无提升已回退)。
  探针: verifier/v246/fillrect-probe.mjs / area-probe.mjs / gpu-probe.mjs / shot.mjs (需 7100 dev server)。
- 适配: v245 (层原点/空标记与贴回偏移断言跟随新形态), v217 (zoomDpr → fitCanvas 断言跟随)。
- 验证: verifier/v246; tsc -b 通过; 全量回归除既有基线失败 (v28/v137/v138/v142) 外全绿。

## v247 exe (Electron) 大窗口掉帧修复 (强制 ANGLE OpenGL 后端)
- 现象: 打包 exe / npx electron 在 2560x1511 最大化窗口下任意谱面仅 ~88fps (frameP95=12.6ms ≈ 3 个
  240Hz vsync), JS 帧忙仅 0.3ms — 与页面内容无关, 是 Chromium 150 默认 D3D11 呈现路径在大窗口下的
  容器级问题。同机 headed Edge 同尺寸 240fps 满帧。
- 诊断 (verifier/v246/electron-npx-probe.mjs, 直起 node_modules electron 二进制免打包快速迭代):
  基线 88fps; 800x600 小窗口 240 满帧 (→ 窗口尺寸相关呈现成本); force-color-profile=srgb 无效 (排除 HDR);
  use-angle=vulkan 34fps 软件光栅不可用; use-angle=d3d11on12 83fps 同默认; **use-angle=gl 240 满帧**。
  GPU feature 对比 (verifier/v246/gpu-compare.mjs): Electron 与 Edge 光栅特性均 enabled, 差异在呈现路径。
- 修复: electron/main.cjs 顶层 `app.commandLine.appendSwitch("use-angle", "gl")` (app ready 前)。
- 进程卫生坑: 便携 exe 是 NSIS 自解压壳, kill 壳不杀真实 App 进程 (解到 %TEMP%); 探针一律直起
  node_modules/electron/dist/electron.exe (杀 PID 即真杀)。
- 验证: verifier/v247; npx electron 实测静止/播放 88→240fps。
## v248 exe 内嵌服务器端口 7100 → 7199
- 7100 是 dev vite 端口, 旧版 exe 优先绑 7100, 与 dev server 同开时 Windows SO_REUSEADDR 语义下
  双 listener 都 LISTENING, exe 可能加载到 dev 代码/端口混乱。7199 为 exe 专用, 被占仍回退随机端口。
- 验证: verifier/v248。
