# 开发经验手册（osu! 谱面编辑器）

本文档沉淀本项目开发中验证有效的流程、工具与坑，供后续开发复用。新功能请沿用这里的验证体系与参考方法。

## 1. 项目结构速览

- `src/osu/` — 核心逻辑（纯 TS，无 React）：
  - `parser.ts` — .osu v14 解析/序列化、`csToRadius`(54.4−4.48×CS)、`arToPreempt`、`sliderVelocityAt`
  - `renderer.ts` — 游玩区 canvas 渲染（`renderPlayfield`，物件/滑条/缩圈/选中高亮）
  - `sliderPath.ts` — 滑条路径计算（`SliderPath`、`computePendingPath`、`inferSegmentType`）
  - `store.ts` — 编辑器状态（撤销/重做、选择集、pendingSlider、`dataVersion`/`emitSelection` 分离）
  - `transform.ts` — 选区几何变换（旋转/镜像/缩放/框选命中，纯函数）
  - `skin.ts` — 皮肤贴图加载/着色（`tintedSprite` 乘算、`withAlpha`）
  - `clock/` — `AudioClock`（Web Audio 采样级时钟）、`HitSoundScheduler`（250ms lookahead 排程）
  - `library.ts` — 曲库/皮肤目录记忆（会话内 + IndexedDB + 授权恢复 + 诊断）
  - `serverFs.ts` — 服务器直读适配层（HTTP → `FsDirLike`，见 §7）；`serverSkin.ts` — 应用服务器皮肤的共用逻辑；`electronBridge.ts` — Electron preload 桥的类型化访问（见 §8）
- `src/components/` — React UI（EditorCanvas / Timelines / Inspector / SongLibrary / SkinPicker / SkinListPanel / FirstRunWizard / App）
- `server/localFsCore.mjs` — `/api/local-fs/*` 端点共享逻辑（vite 中间件与 Electron 主进程共用）
- `electron/` — Electron 主进程与 preload（见 §8）
- `verifier/` — 验证体系（见 §3），索引在 `verifier/README.md`

## 2. 对齐 lazer 的第一手资料：本地克隆

**需要 ppy/osu 的完整本地克隆。GitHub 网络抓取在本环境不稳定（FetchURL/curl 均失败过），一律查本地这份。**

注意：osu.Framework 是子模块、不在克隆里；框架侧公式（如 `Colour4.Lighten`）需从调用注释/此前记录推断，或按已知公式核对。

已核对过的关键数值（直接引用可省一次源码考古）：

- 物件尺寸：`OBJECT_RADIUS=64`，`Radius=64×Scale`，`Scale=(1−0.7×(CS−5)/5)/2` → 游戏内半径 r = 54.4−4.48×CS；贴图盒子 = 2r，**不做补偿放大**
- 经典皮肤数字：52px 高 / 128 盒子；字距 = 字宽 + HitCircleOverlap(−2)
- 滑条身（`LegacySliderBody.ColourAt`，position 0=最外缘→1=圆心）：总宽 = 2r；shadow_portion = 5/64 ≈ 0.078（外缘阴影）；border_portion = 0.1875（白边）→ 白边外径 1.844r、轨道外径 1.625r；轨道 = (SliderTrackOverride ?? combo色).Opacity(0.7)，径向 Darken(0.1)→Lighten(0.5)
- `Colour4.Lighten/Darken`：`amount ×= 0.5`，`c×(1+0.5a)+a`，clamp 到 [0,1]；Darken(n)=Lighten(−n)
- 跟随圈 = FOLLOW_AREA(2.4)×；命中后 240ms 放大到 1.4×
- 时间轴（`TimelineHitObjectBlueprint`）：circle_size=32px 圆角条、时长物件水平渐变 Lighten(0.4)、repeat tick = circle_size/4、选中黄框
- 滑条段类型推断：段内 1~2 点 L / 3 点 P / 4+ B，红点（重复锚点）强制分段

**方法论**：凡"和 lazer 不一样"的观感问题，先读本地克隆里对应 Drawable/Skinning 源码拿到精确数值，再用 CDP 像素实测核对（见 §4），不要凭感觉调参。

## 3. 验证体系（verifier/）

每个功能批次一个 `verifier/vN/` 目录，运行入口统一：

```bash
cd "Kimi_Agent_osu!编辑器改进 (1)/app"
node verifier/vN/check.mjs        # 纯函数单测 + 源码接线断言（无需浏览器）
node verifier/vN/cdp-*.mjs        # CDP 端到端（需 7100 dev server）
```

惯例：

- `check.mjs` 两部分：① esbuild 打包 `tests.ts` 执行纯函数单测；② 读源码做"接线断言"（关键调用/常量/公式存在且旧代码已删）。接线断言刻意写成字符串/正则匹配，防回归时误删接线。
- **改动渲染/接线后必须跑历史 check.mjs 回归**；若旧断言针对的正是被改实现（如宽度常量），按新实现同步修正旧断言并在 README 注明（v15、v18 均有先例）。
- 每完成一批，在 `verifier/README.md` 追加条目：依据（lazer 文件/公式）、改动点、实测数据、对应源码文件。
- 完成前必跑 `npx tsc -b`。

### CDP 脚本骨架（无头 Edge）

- Edge 路径 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，参数 `--headless=new --remote-debugging-port=<新端口> --user-data-dir=<临时目录> --autoplay-policy=no-user-gesture-required`；每批换一个调试端口（9341/9343…），finally 里 `edge.kill()` + 清理临时 profile。
- 页面里 **`window.__osuStore` 直达 store**：`seek(t)`/`select(ids)`/`beatmap` 可直接调用和修改；TS `private` 字段运行时照常可访问。
- 页面坐标换算（游玩区 canvas）：
  ```js
  const r = c.getBoundingClientRect(), sx = c.width / r.width;
  const scale = Math.min(r.width / 512, r.height / 384);
  const ox = (r.width - 512 * scale) / 2, oy = (r.height - 384 * scale) / 2;
  // osu 坐标 (x,y) → canvas 像素: ((ox + x*scale) * sx, (oy + y*scale) * sx)
  ```
- 像素探针：`getImageData` 后按饱和度/亮度分类计数或测连续段宽，再换算回 osu px 与理论值（r 的倍数）比对。探针位置要选**切线已知的几何点**（如圆弧顶点切线水平 → 垂直扫描线即横截面）。
- 截图存档到 `verifier/runs/vN-*.png` 并**亲自 ReadMediaFile 复核**——像素断言替代不了人眼（粗细、渐变、颜色的观感）。

## 4. 踩过的坑（别再踩）

1. **canvas 零长度渐变全透明**：`createLinearGradient(x,y,x,y)`（起止相同）渲染为全透明。单点（无时长物件）画渐变必须特判纯色填充（v18 时间轴 bug）。
2. **测量干扰**：CDP 像素实测前，把同屏其他物件隔离（页面内 `bm.hitObjects = bm.hitObjects.filter(...)` 只留被测物件，再 `seek` 触发重绘），否则缩圈/滑条球/选中高亮会污染探针（v19 首测 3.5r 的教训）。选中态的手柄/高亮同样干扰，测尺寸时 `select([])`。
3. **探针分类阈值**：lighten 后的浅色轨道可能 max 通道顶到 250+，按"彩色=max<250"分类会漏检。用饱和度（max−min>30）判彩色、低饱和高亮度判白。
4. **CDP 脚本里页面代码的 `${}`**：`evalJs` 用模板字符串包裹页面代码，页面代码内再用模板插值会截断外层——页面代码内一律字符串拼接。
5. **两时钟原点差**：Web Audio `ctx.currentTime` 与 `performance.now()` 原点不同（首次 resume 时差可达数秒）。排程时刻必须基于 ctx 锚点线性外推，与相位估计解耦（v17 hitsound 全队列延迟 452ms 的根因）。mock 两时钟同原点的单测**暴露不了**这类 bug，必须真实浏览器 CDP 复现。
6. **事件表重建风暴**：渲染帧数据（选择集等）变更走 `emitSelection`，谱面数据变更才 bump `dataVersion` 重建 hitsound 事件表——两者混用会导致音效叠爆/每帧重建。
7. **vite dev server**：7100 端口常驻一个（按请求读盘，改动自动生效），不要重启；重复启动会因端口占用失败。
8. **物件整体变换**：滑条控制点是绝对坐标，多选变换/拖拽必须头部+全部 curvePoints 一起动，否则拉变形（v17 修复）。
9. **canvas 描边模拟"环+半透明内核"必须离屏合成**：宽描边是从路径中线向两侧铺满的，"先画白边再画半透明内核"会让白边衬在底下把内核洗白；"先画内核再画白边"则白边整条盖住内核。正确做法（v19 滑条身）：离屏 canvas 上整条白边描边 → `destination-out` 镂空内部成环 → `destination-over` 把内核垫进镂空（窄→宽顺序画渐变）→ `destination-out` 半透明把内核区域统一降到目标 alpha。离屏结果按物件 id 缓存，`invalidatePath` 同步失效。
10. **离屏位图必须按主画布变换超采样**：主画布变换是 `dpr × scale`（通常 2~4 倍），离屏按 osu 原生分辨率画再 `drawImage` 放大必出锯齿。取 `g.getTransform().a` 作为超采样倍数（钳制 [1,4]）高分绘制、画回时指定目标宽高缩回，缓存 key 里带上该倍数（v19 锯齿修复）。
11. **IndexedDB schema 演进必须版本化 + contains 守卫**：`openDB` 硬编码版本号 + `onupgradeneeded` 里无条件 `createObjectStore`，遇到"同名老版本库但没有该 store"的用户就是 open 成功、事务 `NotFoundError`、写入静默失败（v20 目录记忆失效的根因）。升版本号触发升级、用 `objectStoreNames.contains` 守卫补建（否则对正常老库重复建 store 抛 `ConstraintError`）。写入类操作做**读回校验**并当场暴露错误，避免"以为存上了实际没存上"。验证手段：OPFS `navigator.storage.getDirectory()` 产的句柄与目录选择器同类，可在无头浏览器里测 IDB 句柄往返。
12. **功能要有几条输入通道，持久化就要覆盖几条**：目录记忆修了选择器通道，用户却从拖拽通道进来（v21 的根因）——`webkitGetAsEntry` 的 entry 无法序列化，拖拽天然丢记忆。现代 API `DataTransferItem.getAsFileSystemHandle()`（Chrome/Edge 86+）对拖拽文件夹返回原生可持久化句柄，优先用它、旧 API 兜底。排查"没记住"类问题先确认用户走的是哪条通道，持久化/日志/恢复三条链路要对每条通道单独核对。
13. **多态 JSX 分支的前置状态要在所有路径上满足**：`{!root ? A : permNeeded ? B : C}` 这种链式三态，若某条数据流只 set 了 `permNeeded` 没 set `root`，B 分支就永远不可达（v22 授权按钮消失）。改 JSX 条件或数据流时，对每个分支列出它依赖的全部 state，逐路径核对。CDP 模拟"待授权"的技巧：IDB 预置 OPFS 句柄 + monkeypatch `FileSystemDirectoryHandle.prototype.queryPermission` 返回 `'prompt'`。
14. **接线断言别写死跨行字面串**：`src.includes('if (r.granted) startScan')` 这类断言，后续批次在中间合法插入一行（v23 插入 `rememberSongsDir`）就假失败——行为没回归，断言先红了。写语义正则（`/if \(r\.granted\) \{[\s\S]*?startScan\(/`），只锚定真正的不变量（v26 回归时发现并修正 v22）。
15. **像素探针打在目标独有特征上**：半透明图层（endcircle 0.5α）会把下层特征（滑条身暗色外缘阴影）透进探针区域，"暗色计数"在有/无目标时几乎一样（v27 箭头探针 2201 vs 2531 的教训）。选目标独占的颜色通道和精确几何点（如箭头纯白尖端 ±0.4r 处），避开圆盘边缘与叠加层。
16. **CDP 交互测试要防"选中态副作用"**：选中滑条后点击其身体会触发节点插入并 resnap 长度（v25/v26 功能），命中/选中类断言前必须 `select([])`，否则测试在不知不觉间改了被测几何（v27 hitTest 测试假失败的根因）。
17. **坐标变换必须单源化，CDP 脚本禁止自带换算公式**：渲染的 osu→屏幕变换一改（v28 加 PAD_Y 上下留白），散落在 8 个 CDP 脚本里的 `min(w/512,h/384)` 复刻公式全部错位。做法：页面侧暴露 `window.__osuToClient(x,y)`（CSS px，给 MouseEvent）和 `window.__osuToCanvas(x,y)`（设备 px，给 getImageData 探针），与渲染共用同一 `viewTransform`；所有 CDP 脚本只调这两个函数。同理，测试前把持久化的 `editor.timelineZoom` 归一化，别假设默认值。
18. **同刻多层标记要错位绘制**：红/绿 timing point 同一时间时，同位置同形状的旗标后画者完全盖住先画者（v28 绿旗盖红旗，像素断言 0 才暴露）。图层有语义的标记（旗标/箭头/徽标）要么纵向错位要么横向偏移，别指望绘制顺序表达优先级。
19. **"拖出画布即结束"与"拖拽中屏蔽外部组件"要分开处理**：onMouseLeave 调 onMouseUp 结束拖拽是旧行为，但屏蔽标志（v30 canvasDragging）若在同一处清除，拖到时间轴上按钮未松开时外部组件照样响应——标志只能由 window 级 mouseup 清除。另外 contextmenu 加"通用删除"这种兜底分支时，要先排除所有手柄类命中（v30 右键滑条头差点变成删整条滑条）：头部手柄命中必须显式 return 空操作。
20. **CDP 页面内脚本三条纪律**：多次 `Runtime.evaluate` 共享全局词法环境，顶层 `const` 重名直接 SyntaxError——一律 IIFE 包裹；hitTest 窗口=渲染可见窗口，交互测试的物件必须先 seek 进可见窗；堆叠同位物件 hitTest 只中一个，被测物件要隔开摆（v30 三个坑各占一次失败）。
21. **异步启动恢复与已挂载面板存在竞态**：exe 启动即打开曲库面板，面板的恢复 effect 先于 App 的 `fetchServerDirs()` 完成 → 读到空记忆、显示"选择目录"空状态；同理，向导保存配置后 `setShowLibrary(true)` 对已挂载面板是空操作，必须 `key` 自增强制重挂载。两条原则：面板的恢复要么自己直接查一遍数据源（SongLibrary 现在会话记忆缺失时自己调 `fetchServerDirs`），要么由父级用 key 重挂载；`setX(true)` 对"已挂载但数据未就绪"的组件没有任何刷新作用。
22. **vite 打包配置是 ESM，内联的 CJS 会炸**：vite.config.ts import 本地 `.cjs` 时，esbuild 把配置打成 ESM 并内联该 CJS，其中 `require("node:fs")` 变成 "Dynamic require is not supported"。共享给 vite 配置的模块必须写 ESM（`.mjs`）；Electron 主进程（CJS）用动态 `import()` 加载它（CJS 无顶层 await，要在异步入口里做）。
23. **electron-builder 对含 `!`/非 ASCII 字符的项目路径 EPERM**：解压 Electron zip 后 rename `win-unpacked.tmp` 失败。与权限无关，用纯 ASCII 短路径输出再拷回：`-c.directories.output="D:/eb-release"`。另外便携 exe 运行时解包到 Temp 并驻留进程，替换 exe 前要先 `Stop-Process` 残留实例，否则 "Device or resource busy"。
24. **bat 两个隐蔽坑**（`打包编辑器.bat` 实踩）：① `EnableDelayedExpansion` 下 `for %%f in (*.exe) do copy "%%f"`，文件名含 `!`（产物 `osu! Map Editor 0.0.0.exe` 就是）会静默拷贝失败、随后清理把暂存产物删掉——build 成功但 release 为空，用 `xcopy "dir\*.exe" dest\`（通配符由 xcopy 自己解析，不经过变量展开）；② cmd 按 ANSI 代码页（GBK）解析 bat，**UTF-8 中文注释会把行解析撕裂**（报 `'stalling' 不是内部或外部命令` 之类错位错误）——bat 内容必须纯 ASCII，文件名可以是中文。

## 5. 渲染着色规则备忘（osu! 标准）

- hitcircle 白底**乘算** combo 色（`tintedSprite`），overlay/数字/箭头原色绘制
- 滑条头尾用 sliderstartcircle/endcircle 乘算 + overlay 原色；滑条球原色 + 跟随圈
- 折返箭头贴图朝右，按切线角旋转
- 皮肤色优先级：sliderBorder / sliderTrackOverride 优先于默认白/combo 色
- **combo 色数据格式不统一**：解析器把谱面 Combo 色存成 `rgb(r,g,b)` 串（parser.ts），内置默认色却是 `#rrggbb`——任何按 hex 解析的混色/透明化工具（如时间轴染色的 hexRgb）必须两种格式都认，否则静默得到近黑颜色（v31 被 v18 CDP 亮度探针抓出）
- hitsound 采样链：物件 hitSample → timing point → [General] SampleSet；回退链：谱面自定义（序号回退）→ 皮肤 → 默认

## 6. 提交前检查清单

- [ ] `npx tsc -b` 通过
- [ ] 新批次 `verifier/vN/check.mjs` 通过；涉及渲染/交互的有对应 CDP 脚本且通过
- [ ] 历史 check.mjs 回归全绿（至少近期 3~4 批 + 皮肤渲染 v12/v13）
- [ ] CDP 截图已 ReadMediaFile 肉眼复核
- [ ] `verifier/README.md` 追加本批条目（依据/改动/实测数据/文件清单）

## 7. 服务器直读本地目录（local-dirs.json，免浏览器授权）

在 `app/local-dirs.json` 填入曲库/皮肤的**绝对路径**后，Vite 中间件（`vite.config.ts` 的 `localFsPlugin`）直接读磁盘，前端经 `/api/local-fs/*` 访问，完全绕开 File System Access API 的浏览器授权，启动即静默恢复：

```json
{ "songsDir": "D:/Games/osu!/Songs", "skinDir": "D:/Games/osu!/Skins/MySkin" }
```

- 留空或文件缺失则该功能自动关闭，回退到浏览器授权模式（选择器/拖拽 + IndexedDB 记忆），两者互斥、服务器配置优先
- 配置每次请求实时重读，改路径**不用重启服务器**，刷新页面即可
- 接口：`GET /api/local-fs/config`（配置）、`GET /api/local-fs/list?root=songs|skin&rel=...`（列目录）、`GET /api/local-fs/file?root=songs|skin&rel=...`（读文件）；只允许访问两个配置根目录之内（拒绝 `..` 越界）
- 前端适配层 `src/osu/serverFs.ts` 把服务器目录包装成与 File System Access 相同的 `FsDirLike` 接口，曲库扫描/皮肤加载/hitsound 收集等上层代码零改动
- `local-dirs.json` 已加入 `.gitignore`（本机路径不入库）
- 该中间件只在 `vite dev` 生效；`vite build` 的纯静态产物无此功能，自动回退浏览器授权模式
- 端点逻辑在 `server/localFsCore.mjs`（ESM），vite 中间件与 Electron 主进程共用，唯一差异是数据源

## 8. 封装为独立 exe（Electron）

- 入口 `electron/main.cjs`：内嵌 HTTP 服务器（静态 `dist/` + `/api/local-fs/*`，优先固定端口 7199（v248，避开 dev vite 的 7100），被占则随机）+ BrowserWindow 加载 `http://127.0.0.1:<port>`（启动即 `maximize()`）；顶层强制 `--use-angle=gl`（v247，Chromium 150 默认 D3D11 呈现路径在大窗口下掉帧）；preload `electron/preload.cjs` 经 contextBridge 暴露 `window.osuEditor`
- exe 的配置存 `<userData>/settings.json`（`{ osuPath, songsDir, skinDir }`），由首跑向导写入；与 dev 的 `local-dirs.json` 互不干扰
- 首跑向导 `src/components/FirstRunWizard.tsx`：`get-settings.firstRun`（曲库目录未配置/失效）→ 原生对话框选 osu! 目录（主进程拿绝对路径）→ `list-skin-dirs` 列出 `<osu>/Skins` 选皮肤 → `save-settings` 持久化（songsDir/skinDir 自动推导）并立即生效；菜单"设置 → 重新配置 osu! 目录与皮肤"可再次打开
- exe 启动即曲库界面（`App.tsx` 中 `showLibrary` 初始值 = `isElectron()`）；dev/浏览器无 preload 注入 → 直进编辑界面（调试不变）。向导完成后用 `libraryKey` 自增重挂载曲库面板强制重新扫描（见 §4 坑 21）
- exe 的"🎨 皮肤"按钮打开 `SkinListPanel`（列出 `<osu>/Skins` 点击即应用并保存）；浏览器/dev 仍用 `SkinPicker`（File System Access 选目录）。应用服务器皮肤的逻辑统一在 `src/osu/serverSkin.ts`（启动恢复/向导/皮肤列表三处共用）
- 打包：双击 `打包编辑器.bat`（依赖检查 + 镜像环境变量 + ASCII 暂存目录 + 拷回 `release/` 一键完成）；手动则为 `npm run dist:exe`（`npm run build` + `electron-builder --win portable`）；本地快速验证 `npm run dev:electron`
- **构建坑**：项目路径含 `!`/非 ASCII 字符时 electron-builder 解压 Electron 后 rename 会 EPERM —— 用纯 ASCII 短路径输出再拷回：`npx electron-builder --win portable -c.directories.output="D:/eb-release"`（见 §4 坑 23）
- 国内网络装依赖/打包需镜像：`ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`、`ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"`；Electron 二进制下载失败时用 `ELECTRON_MIRROR=... node node_modules/electron/install.js` 补装

