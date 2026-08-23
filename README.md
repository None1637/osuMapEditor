# osu! 谱面编辑器 (Web / 桌面版)

对标 osu!lazer 的 std 谱面编辑器：React + TypeScript + Vite 实现，可浏览器运行，也可打包为 Windows 独立 exe（Electron）。

## 功能

- 谱面编辑：单点/滑条/转盘放置与选区变换（旋转/镜像/缩放）、锁定间距、网格吸附、节拍吸附
- 曲库浏览：扫描 osu! Songs 目录，按歌曲/难度浏览，点击即载入编辑器（含音频/背景/hitsound）
- 皮肤系统：加载 osu! 皮肤目录贴图与 hitsound 采样
- 时间轴、Timing 面板、谱面元数据（Setup）页签

### 特色功能（部分想法来自Mapping Tools）

- 批量复制：为每份拷贝间加入旋转/缩放/位移
- 网格旋转与中心位置调整
- 在上方时间轴的直接拖动、选择、复制粘贴绿线，双击绿线可编辑
- 按Alt选中滑条节点，将选中的节点一起移动、旋转、缩放
- 选中多个物件时支持合并为滑条
- 辅助线绘制
- pattern库

## 快速开始（桌面 exe，推荐）

从本仓库的 **Releases** 页面下载最新便携版 exe（免安装），双击运行：

1. **首次启动**：配置向导 → 选 osu! 安装目录（自动探测 `%LOCALAPPDATA%/osu!`）→ 选皮肤（可跳过）→ 进入曲库
2. **之后启动**：直接进曲库界面，点难度进入编辑器；配置存 `%APPDATA%/osu! Map Editor/settings.json`
3. 换目录/皮肤：菜单"设置 → 重新配置 osu! 目录与皮肤"，或工具栏"🎨 皮肤"直接换肤

## 开发调试（浏览器模式）

```bash
npm install
启动编辑器.bat        # 或: npm run dev -- --port 7100 --strictPort
```

- 浏览器模式直进编辑界面；曲库/皮肤目录经 File System Access API 授权访问，句柄记 IndexedDB
- 也可在 `local-dirs.json` 填绝对路径（`{ "songsDir": "...", "skinDir": "..." }`），dev 服务器直接读盘、免授权，刷新生效

## 打包 exe

双击 `打包编辑器.bat`（自动装依赖、补 Electron 二进制镜像下载、构建、打包、拷回 `release/`）：

```bash
npm run dist:exe     # 或手动: 产物在 release/
```

项目路径含 `!`/非 ASCII 字符会导致 electron-builder EPERM，需改用纯 ASCII 输出目录再拷回（见 DEVELOPMENT.md §8）：

```bash
npx electron-builder --win portable -c.directories.output="D:/eb-release"
```

国内网络装依赖/打包需镜像：`ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`、`ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"`。

## 架构速览

- `src/osu/` — 核心逻辑（解析/渲染/状态/时钟/皮肤/曲库，纯 TS）
- `src/components/` — React UI（画布/时间轴/曲库/皮肤/向导）
- `server/localFsCore.mjs` — `/api/local-fs/*` 本地文件端点（vite 中间件与 Electron 共用）
- `electron/` — 桌面封装（内嵌 HTTP 服务器 + 原生目录对话框 + settings.json）
- `verifier/` — 验证体系（纯函数单测 + CDP 端到端）

详细开发手册（lazer 对齐资料、验证体系、踩坑记录）：[DEVELOPMENT.md](DEVELOPMENT.md)

## 声明与许可

- 本项目为**非官方粉丝作品**，与 ppy Pty Ltd 无任何关联；"osu!" 为 ppy Pty Ltd 的商标。
- 代码以 [MIT](LICENSE) 发布；部分内容移植自 [ppy/osu](https://github.com/ppy/osu) 与 [ppy/osu-framework](https://github.com/ppy/osu-framework)（MIT），版权声明见 [NOTICE](NOTICE)。
- `public/skin/`、`public/samples/` 内的 osu! 经典皮肤资源版权属 ppy Pty Ltd，仅作缺省回退随附（详见 NOTICE）。
