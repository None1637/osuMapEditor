// Electron 主进程: 独立窗口 + 内嵌 HTTP 服务器 (静态 dist + /api/local-fs/*)
// 配置存 <userData>/settings.json: { osuPath, songsDir, skinDir }
// 首跑由渲染进程向导驱动 (IPC: get-settings / pick-osu-dir / list-skin-dirs / save-settings)
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const http = require("node:http")
const { spawn } = require("node:child_process")
let win = null
// 端点逻辑与 vite 中间件共用 (ESM 模块, 由 main() 动态 import 后赋值; createServer 闭包请求时才解引用)
let handleLocalFs = null
// v77: 最近难度列表维护 (ESM 纯函数, main() 动态 import)
let pushRecent = null
// v185: 谱面备份核心 (ESM, main() 动态 import)
let backupCore = null
// v185: 备份根目录 = exe 同目录/backup_beatmaps (开发时 = app/backup_beatmaps)
const BACKUP_ROOT = () => path.join(app.isPackaged ? path.dirname(app.getPath("exe")) : path.join(__dirname, ".."), "backup_beatmaps")

// ---------- 设置持久化 ----------
const settingsFile = () => path.join(app.getPath("userData"), "settings.json")

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), "utf-8")) } catch { return {} }
}
function writeSettings(s) {
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2) + "\n", "utf-8")
}
function dirExists(p) {
  try { return !!p && fs.statSync(p).isDirectory() } catch { return false }
}

// ---------- 内嵌服务器 ----------
function makeLocalFsHandler(createLocalFsHandler) {
  return createLocalFsHandler(() => {
    const s = readSettings()
    return {
      songs: dirExists(s.songsDir) ? s.songsDir : null,
      skin: dirExists(s.skinDir) ? s.skinDir : null,
    }
  })
}

// v187: 撤销 v182 的 disable-frame-rate-limit — 实测部分机器上该开关让合成器非节流连发,
// rAF 每秒数百次触发全量 React 重渲染, CPU 打满导致界面帧率暴跌。
// 原生 rAF 本身跟随显示器 vsync (高刷屏自动跑 144/165Hz), 无需开关干预; 保持硬件加速开启即可。
// v247: 强制 ANGLE OpenGL 后端 — Chromium 150 默认 D3D11 呈现路径在 2K 等大窗口下每帧合成/呈现
// 耗时 ~11ms (实测 2560x1511 最大化仅 ~88fps, 与页面内容无关); GL 后端同场景满帧 240fps。
// (实测对比: vulkan 34fps 软件光栅不可用; d3d11on12 与默认 d3d11 同样 83fps; 小窗口下各后端均满帧)
app.commandLine.appendSwitch("use-angle", "gl")
const DIST_DIR = path.join(__dirname, "..", "dist")
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    if (url.pathname.startsWith("/api/local-fs/")) {
      // 收集请求体 (write 端点需要; GET 立即 end)
      const chunks = []
      req.on("data", (c) => chunks.push(c))
      req.on("end", async () => {
        // v323: handler 已异步化 (fs.promises) — 主进程不再被同步磁盘 I/O 占满 (曲库索引风暴期间窗口仍响应)
        const r = await handleLocalFs(req.method ?? "GET", url.pathname, url.searchParams, chunks.length ? Buffer.concat(chunks) : undefined)
        if (!r) { res.writeHead(404); res.end("not found"); return }
        res.writeHead(r.status, { "Content-Type": r.contentType })
        res.end(r.body)
      })
      return
    }
    // 静态文件 (防越界; 未命中回退 index.html)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html"
    const distAbs = path.resolve(DIST_DIR)
    const abs = path.resolve(distAbs, rel)
    let file = abs === distAbs || abs.startsWith(distAbs + path.sep) ? abs : null
    if (file && (!fs.existsSync(file) || !fs.statSync(file).isFile())) file = path.join(distAbs, "index.html")
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" })
    fs.createReadStream(file).pipe(res)
  })
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve(server.address().port))
  })
}

async function startServer() {
  const server = createServer()
  try { return await listen(server, 7199) } // v248: exe 专用固定端口 (7100 是 dev vite 端口, 同开时旧版会劫持/混乱)
  catch { return await listen(server, 0) }  // 被占用则随机端口
}

// ---------- IPC (配置向导用; 原生对话框能拿到绝对路径, 浏览器做不到) ----------
ipcMain.handle("get-settings", () => {
  const s = readSettings()
  const suggested = path.join(process.env.LOCALAPPDATA ?? "", "osu!")
  return {
    osuPath: s.osuPath ?? null,
    songsDir: s.songsDir ?? null,
    skinDir: s.skinDir ?? null,
    skinName: s.skinDir ? path.basename(s.skinDir) : null,
    firstRun: !dirExists(s.songsDir),
    suggestedOsuPath: dirExists(suggested) ? suggested : null,
    hideTitleBar: !!s.hideTitleBar, // v263: 窗口条隐藏开关 (重启生效)
  }
})

// v263: 窗口条隐藏 — 显示设置面板开关写入 settings.json, 下次启动 createWindow 读取生效
ipcMain.handle("set-hide-title-bar", (_e, b) => {
  writeSettings({ ...readSettings(), hideTitleBar: !!b })
  return !!b
})

// v94: 最近难度列表 (渲染端启动时取 recents[0] 自动恢复上次谱面)
ipcMain.handle("get-recents", () => readSettings().recents ?? [])

ipcMain.handle("pick-osu-dir", async (_e, defaultPath) => {
  const r = await dialog.showOpenDialog(win, {
    title: mT("menu.pick_osu_dir"),
    defaultPath: defaultPath || undefined,
    properties: ["openDirectory"],
  })
  if (r.canceled || !r.filePaths.length) return null
  const p = r.filePaths[0]
  return { osuPath: p, hasSongs: dirExists(path.join(p, "Songs")), hasSkins: dirExists(path.join(p, "Skins")) }
})

ipcMain.handle("list-skin-dirs", (_e, osuPath) => {
  const skins = path.join(osuPath, "Skins")
  if (!dirExists(skins)) return []
  return fs.readdirSync(skins, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()
})

ipcMain.handle("save-settings", (_e, { osuPath, skinName }) => {
  const songsDir = path.join(osuPath, "Songs")
  if (!dirExists(songsDir)) throw new Error(mT("menu.songs_dir_missing", { path: songsDir }))
  const skinDir = skinName ? path.join(osuPath, "Skins", skinName) : null
  if (skinDir && !dirExists(skinDir)) throw new Error(mT("menu.skin_dir_missing", { path: skinDir }))
  writeSettings({ ...readSettings(), osuPath, songsDir, skinDir })
  return { songsDir, skinDir, skinName }
})

// ---------- 窗口 ----------
// v120: 未保存改动拦截 — 渲染端经 "dirty-state" 上报; 关窗时若有脏改动则拦下并回发 "close-request",
// 渲染端弹保存/废弃提示, 确认后 "close-confirmed" 才真正关窗
let isDirty = false
ipcMain.on("dirty-state", (_e, b) => { isDirty = !!b }) // v123: 不再重建菜单 (指示器移入应用内顶栏)
ipcMain.on("close-confirmed", () => { isDirty = false; win?.close() })

// v338: 崩溃日志 — 远程用户反馈白屏但本地无法复现, 需要现场数据。
//   渲染端 window error/unhandledrejection 经 "renderer-error" 上报; 渲染进程崩溃/无响应在此直接落盘。
//   日志写 <userData>/crash.log (追加, 截断单条 4KB; 文件超 1MB 时重开), 反馈时让用户发此文件。
const crashLogFile = () => path.join(app.getPath("userData"), "crash.log")
function logCrash(kind, payload) {
  try {
    const f = crashLogFile()
    try { if (fs.statSync(f).size > 1024 * 1024) fs.writeFileSync(f, "") } catch { /* 不存在则忽略 */ }
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${kind}: ${String(payload).slice(0, 4096)}\n`, "utf-8")
  } catch { /* 日志失败不影响主流程 */ }
}
ipcMain.on("renderer-error", (_e, payload) => logCrash("renderer-error", payload))

async function createWindow() {
  const port = await startServer()
  // v263: 窗口条隐藏 (显示设置面板开关 → settings.json hideTitleBar, 重启生效) —
  // titleBarStyle hidden 去标题栏但保留原生最小/最大/关闭 (Windows 经 titleBarOverlay 着色贴近应用底色;
  // 页面侧拖拽区 = 页签栏, 见 App.tsx [-webkit-app-region])
  // v279: Windows 上 titleBarStyle:'hidden' (WCO) 会连带隐藏应用菜单栏, 且
  // autoHideMenuBar:false + setMenuBarVisibility(true) 实测均不渲染 → 菜单栏改应用内自绘 (见 v280)
  const frameless = !!readSettings().hideTitleBar
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#101016",
    // v281: 两种标题栏模式统一用应用内自绘菜单条 (MenuBar.tsx) — 原生菜单栏默认隐藏;
    // 原生菜单仍 setApplicationMenu (accelerator 全局快捷键保留, Alt 可临时呼出原生菜单)
    autoHideMenuBar: true,
    ...(frameless ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#101016", symbolColor: "#e8e8f0", height: 32 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.on("close", (e) => {
    if (isDirty && win) {
      e.preventDefault()
      win.webContents.send("close-request")
    }
  })
  // v332: 主进程拦截 Alt 默认行为 — autoHideMenuBar 下 Alt 唤起原生菜单抢焦点 (窗口 blur →
  // altHeldRef 复位, 选中物件/滑条点 Alt 层 hover 高亮按下/松开不刷新); 渲染端 preventDefault (v328)
  // 拦不住 OS 层菜单激活, 必须 before-input-event。菜单 accelerator 无 Alt 组合, 不受影响。
  // v336 (CDP 实测修正): 只 preventDefault keyUp — Windows 菜单激活发生在 Alt 松开,
  //   拦 keyUp 即防抢焦点; 且实测 keyUp 一旦被 preventDefault 就不再下发 DOM,
  //   而 keyDown 放行让页面走原生 DOM keydown 更新 altHeldRef; keyUp 的松开态经
  //   "alt-key" IPC 转发渲染端同步 (v336 初版全拦导致 DOM 完全收不到 Alt, 框选不变色)
  win.webContents.on("before-input-event", (e, input) => {
    if (input.key === "Alt") {
      if (input.type === "keyUp") e.preventDefault() // 菜单激活在松开时发生, 拦之; DOM 收不到 keyUp, 走下方 IPC
      if (!win.isDestroyed()) win.webContents.send("alt-key", input.type !== "keyUp")
    }
  })
  // v338: 渲染进程崩溃/无响应落盘 (白屏现场 — render-process-gone 的 reason: crashed/oom/killed 等)
  win.webContents.on("render-process-gone", (_e, details) => logCrash("render-process-gone", JSON.stringify(details)))
  win.webContents.on("unresponsive", () => logCrash("unresponsive", "webContents 无响应"))
  win.on("closed", () => { win = null })
  win.maximize() // 启动默认最大化
  win.loadURL(`http://127.0.0.1:${port}/`)
}

// ---------- v215: 关于窗口 (菜单栏「关于」→ 版本/声明 + GitHub 源码与 Releases 链接) ----------
const APP_VERSION = require("../package.json").version
let aboutWin = null

function openAboutWindow() {
  if (aboutWin) { aboutWin.focus(); return }
  aboutWin = new BrowserWindow({
    width: 460,
    height: 480,
    resizable: false,
    maximizable: false,
    parent: win ?? undefined,
    backgroundColor: "#101016",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  // 链接一律交给系统浏览器打开, 不在窗口内导航
  aboutWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url)
    return { action: "deny" }
  })
  aboutWin.on("closed", () => { aboutWin = null })
  aboutWin.loadFile(path.join(__dirname, "about.html"), { query: { v: APP_VERSION } })
}

// ---------- v77: 原生 "文件" 菜单 (stable 风格) ----------
// 渲染进程在每次加载谱面后经 "menu-state" 上报: { file, folderRel, title, difficulties: [{file, label}] }
// folderRel = Songs 内相对路径 (serverFs serverDir.serverRel); 非服务器来源 (拖拽导入) 为 null → 文件夹/记事本项禁用
let menuState = null

// v156: Timing 菜单勾选状态 (渲染进程经 "timing-menu-state" 上报, 值变化才发):
//   meter = 当前生效红线拍号 (节拍类型 radio), metronome = 节拍器开关 (checkbox)
let timingState = { meter: null, metronome: false }

// v209: 编辑菜单置灰状态 (渲染进程经 "edit-menu-state" 上报, 值变化才发):
//   hasMap = 已加载谱面, hasSelection = 有选中物件, hasClipboard = 剪贴板有内容
// v212: 扩 hasSlider (选中含滑条) / selMulti (选中 >=2) — 作图菜单置灰用
// v236: 扩 selSingleSlider (恰好选中 1 个滑条) — 作图菜单「对称滑条」置灰用
let editState = { hasMap: false, hasSelection: false, hasClipboard: false, hasSlider: false, selMulti: false, selSingleSlider: false }

ipcMain.on("edit-menu-state", (_e, s) => {
  editState = {
    hasMap: !!s?.hasMap, hasSelection: !!s?.hasSelection, hasClipboard: !!s?.hasClipboard,
    hasSlider: !!s?.hasSlider, selMulti: !!s?.selMulti, selSingleSlider: !!s?.selSingleSlider,
  }
  buildMenu()
})

ipcMain.on("timing-menu-state", (_e, s) => {
  timingState = { meter: s?.meter ?? null, metronome: !!s?.metronome }
  buildMenu()
})

ipcMain.on("menu-state", (_e, state) => {
  menuState = state && state.file ? state : null
  if (menuState && menuState.folderRel) {
    const s = readSettings()
    s.recents = pushRecent(s.recents ?? [], { folderRel: menuState.folderRel, file: menuState.file, label: menuState.title })
    writeSettings(s)
  }
  buildMenu()
})

// v185: 谱面备份 — 写 exe 同目录 backup_beatmaps/<艺术家_歌曲名>/<原名_时间戳>.osu; 内容与上次相同则重命名上次备份为最新时间
ipcMain.handle("backup-beatmap", (_e, p) => {
  try {
    if (!p || typeof p.content !== "string") return { ok: false, error: "no content" }
    const r = backupCore.performBackup({ rootDir: BACKUP_ROOT(), artist: p.artist, title: p.title, origFile: p.origFile, content: p.content })
    return { ok: true, action: r.action, folder: r.folder, file: r.file }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
})

// v185: 文件菜单「查看备份」→ 渲染进程带回艺术家/歌曲名, 主进程开备份文件夹
ipcMain.handle("open-backup-folder", (_e, p) => {
  try {
    const folder = path.join(BACKUP_ROOT(), backupCore.backupFolderName(p && p.artist, p && p.title))
    if (!fs.existsSync(folder)) return { ok: false, error: mT("menu.no_backups") }
    shell.openPath(folder)
    return { ok: true }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
})

// v280: 应用内菜单栏 — Windows 上 titleBarStyle:'hidden' (WCO) 不渲染原生菜单栏 (v279 实测
// autoHideMenuBar:false + setMenuBarVisibility 均无效), 改为把菜单模板序列化推给渲染端自绘
// (VS Code 同款方案); 原生菜单仍 setApplicationMenu 保留 (accelerator 全局生效);
// v281: 非隐藏模式也统一用自绘菜单条, 原生菜单栏由 BrowserWindow autoHideMenuBar 默认隐藏
let menuActions = new Map() // id → 执行函数 (click 闭包或 role 等价实现)
let menuSeq = 0
let lastMenuDef = null
function serializeMenuItems(items) {
  return items.map((it) => {
    if (it.type === "separator") return { type: "separator" }
    const node = { label: it.label ?? "", enabled: it.enabled !== false }
    if (it.type === "radio" || it.type === "checkbox") { node.type = it.type; node.checked = !!it.checked }
    if (it.accelerator) node.accelerator = String(it.accelerator)
    if (it.submenu) {
      node.submenu = serializeMenuItems(it.submenu)
    } else {
      const id = "mi" + (++menuSeq)
      const clickFn = it.click, role = it.role
      menuActions.set(id, () => {
        if (clickFn) clickFn()
        else if (role === "reload") win?.webContents.reload()
        else if (role === "toggleDevTools") win?.webContents.toggleDevTools()
        else if (role === "quit") app.quit()
      })
      node.id = id
    }
    return node
  })
}
// 渲染端挂载时主动拉取 (首次 buildMenu 早于页面加载, send 会丢); 此后每次 buildMenu 主动 push
ipcMain.handle("get-menu-definition", () => lastMenuDef)
ipcMain.on("menu-item-click", (_e, id) => { menuActions.get(id)?.() })
// v286: 自定义改键 — 渲染端 hotkeys.ts 推送 menuId → accelerator 覆盖; 注册项 (save/timing 4 项)
// 真改键 (accelerator 注册生效), 编辑/作图菜单项 registerAccelerator:false 仅显示文字同步
let accelOverrides = {}
ipcMain.on("menu-accelerator-overrides", (_e, map) => { accelOverrides = map || {}; buildMenu() })
const acc = (id, def) => accelOverrides[id] ?? def

// v346: 菜单多语言 — 主进程 CJS 不能 import src/i18n, 内嵌三语标签表 (en 默认 + zh-CN + zh-TW);
// 渲染端经 "menu-lang" 上报当前语言 (electronMenu.ts: 启动一次 + onLangChange 订阅), 收到即 buildMenu 重建,
// 应用内菜单条经现有 onMenuDefinition 推送链路自动刷新
const MENU_LABELS = {
  "menu.file": { en: "File", "zh-CN": "文件", "zh-TW": "檔案" },
  "menu.save": { en: "Save", "zh-CN": "保存", "zh-TW": "儲存" },
  "menu.open_difficulty": { en: "Open a Difficulty", "zh-CN": "打开一个难度", "zh-TW": "開啟一個難度" },
  "menu.no_beatmap": { en: "(no beatmap loaded)", "zh-CN": "(未加载谱面)", "zh-TW": "(未載入譜面)" },
  "menu.open_recent": { en: "Open Recent Difficulty", "zh-CN": "打开最近的难度", "zh-TW": "開啟最近的難度" },
  "menu.none": { en: "(none)", "zh-CN": "(无)", "zh-TW": "(無)" },
  "menu.open_song_folder": { en: "Open Song Folder", "zh-CN": "打开歌曲文件夹", "zh-TW": "開啟歌曲資料夾" },
  "menu.view_backups": { en: "View Backups", "zh-CN": "查看备份", "zh-TW": "檢視備份" },
  "menu.open_osu_in_notepad": { en: "Open .osu File in Notepad", "zh-CN": "在记事本中打开.osu文件", "zh-TW": "在記事本中開啟 .osu 檔案" },
  "menu.edit": { en: "Edit", "zh-CN": "编辑", "zh-TW": "編輯" },
  "menu.undo": { en: "Undo", "zh-CN": "撤消", "zh-TW": "復原" },
  "menu.redo": { en: "Redo", "zh-CN": "重做", "zh-TW": "重做" },
  "menu.cut": { en: "Cut", "zh-CN": "剪切", "zh-TW": "剪下" },
  "menu.copy": { en: "Copy", "zh-CN": "复制", "zh-TW": "複製" },
  "menu.paste": { en: "Paste", "zh-CN": "粘贴", "zh-TW": "貼上" },
  "menu.delete": { en: "Delete", "zh-CN": "删除", "zh-TW": "刪除" },
  "menu.select_all": { en: "Select All", "zh-CN": "全选", "zh-TW": "全選" },
  "menu.duplicate": { en: "Duplicate...", "zh-CN": "批量复制...", "zh-TW": "批次複製..." },
  "menu.reverse": { en: "Reverse Selection", "zh-CN": "反选", "zh-TW": "反轉選取" },
  "menu.flip_h": { en: "Flip Horizontally", "zh-CN": "左右翻转", "zh-TW": "水平翻轉" },
  "menu.flip_v": { en: "Flip Vertically", "zh-CN": "上下翻转", "zh-TW": "垂直翻轉" },
  "menu.rot_cw": { en: "Rotate 90° Clockwise", "zh-CN": "顺时针旋转90°", "zh-TW": "順時針旋轉90°" },
  "menu.rot_ccw": { en: "Rotate 90° Counter-Clockwise", "zh-CN": "逆时针旋转90°", "zh-TW": "逆時針旋轉90°" },
  "menu.rotate": { en: "Rotate...", "zh-CN": "旋转...", "zh-TW": "旋轉..." },
  "menu.scale": { en: "Scale...", "zh-CN": "缩放...", "zh-TW": "縮放..." },
  "menu.symmetry": { en: "Symmetry...", "zh-CN": "对称...", "zh-TW": "對稱..." },
  "menu.clear_hs_selected": { en: "Clear Hit Sounds of Selected Objects", "zh-CN": "清除所选物件的音效", "zh-TW": "清除所選物件的音效" },
  "menu.clear_hs_all": { en: "Clear All Hit Sounds", "zh-CN": "清除所有音效", "zh-TW": "清除所有音效" },
  "menu.reset_combo": { en: "Reset Combo Colours", "zh-CN": "重置combo组的颜色", "zh-TW": "重置combo組的顏色" },
  "menu.reset_breaks": { en: "Reset Breaks", "zh-CN": "重置休息时段", "zh-TW": "重置休息時段" },
  "menu.nudge_prev": { en: "Nudge Backward", "zh-CN": "前移", "zh-TW": "前移" },
  "menu.nudge_next": { en: "Nudge Forward", "zh-CN": "后移", "zh-TW": "後移" },
  "menu.compose": { en: "Compose", "zh-CN": "作图", "zh-TW": "作圖" },
  "menu.polygon": { en: "Create Polygon...", "zh-CN": "多边形生成...", "zh-TW": "多邊形生成..." },
  "menu.stream": { en: "Convert Slider to Stream...", "zh-CN": "滑条转连打...", "zh-TW": "滑條轉連打..." },
  "menu.merge": { en: "Merge Sliders", "zh-CN": "合并滑条", "zh-TW": "合併滑條" },
  "menu.sym_slider": { en: "Symmetrical Slider...", "zh-CN": "对称滑条...", "zh-TW": "對稱滑條..." },
  "menu.meter": { en: "Time Signature", "zh-CN": "节拍类型", "zh-TW": "節拍類型" },
  "menu.meter_common": { en: "4/4 (common)", "zh-CN": "4/4 (普通/四拍子)", "zh-TW": "4/4 (普通/四拍子)" },
  "menu.meter_waltz": { en: "3/4 (waltz)", "zh-CN": "3/4 (华尔兹/三拍子)", "zh-TW": "3/4 (華爾滋/三拍子)" },
  "menu.metronome": { en: "Metronome", "zh-CN": "节拍器", "zh-TW": "節拍器" },
  "menu.add_timing": { en: "Add Timing Point (red line)", "zh-CN": "添加Timing区间 (即红线)", "zh-TW": "新增Timing區間 (即紅線)" },
  "menu.add_inherited": { en: "Add Inherited Timing Point (green line)", "zh-CN": "添加继承区间 (即绿线)", "zh-TW": "新增繼承區間 (即綠線)" },
  "menu.reset_current": { en: "Reset Current Section", "zh-CN": "重置当前区间", "zh-TW": "重置當前區間" },
  "menu.delete_timing": { en: "Delete Timing Point", "zh-CN": "删除Timing区间", "zh-TW": "刪除Timing區間" },
  "menu.resnap_current": { en: "Resnap Current Timing Point", "zh-CN": "重新对齐当前Timing区间", "zh-TW": "重新對齊當前Timing區間" },
  "menu.timing_setup": { en: "Timing Setup...", "zh-CN": "Timing设置...", "zh-TW": "Timing設置..." },
  "menu.resnap_all": { en: "Resnap All Objects", "zh-CN": "全部重新对齐", "zh-TW": "全部重新對齊" },
  "menu.shift_all": { en: "Shift All Objects' Time...", "zh-CN": "整体平移所有物件的时间...", "zh-TW": "整體平移所有物件的時間..." },
  "menu.recalc_sliders": { en: "Recalculate Slider Lengths", "zh-CN": "重新计算滑条长度", "zh-TW": "重新計算滑條長度" },
  "menu.delete_all_timing": { en: "Delete All Timing Points", "zh-CN": "删除所有Timing区间", "zh-TW": "刪除所有Timing區間" },
  "menu.set_preview": { en: "Set Current Position as Preview Point", "zh-CN": "把当前位置设为预览点", "zh-TW": "把當前位置設為預覽點" },
  "menu.settings": { en: "Settings", "zh-CN": "设置", "zh-TW": "設置" },
  "menu.reconfigure": { en: "Reconfigure osu! Folder & Skin", "zh-CN": "重新配置 osu! 目录与皮肤", "zh-TW": "重新配置 osu! 目錄與皮膚" },
  "menu.reload": { en: "Reload", "zh-CN": "刷新", "zh-TW": "重新整理" },
  "menu.devtools": { en: "Developer Tools", "zh-CN": "开发者工具", "zh-TW": "開發者工具" },
  "menu.quit": { en: "Quit", "zh-CN": "退出", "zh-TW": "結束" },
  "menu.about": { en: "About", "zh-CN": "关于", "zh-TW": "關於" },
  "menu.about_app": { en: "About osu! Map Editor (v{v})", "zh-CN": "关于 osu! Map Editor (v{v})", "zh-TW": "關於 osu! Map Editor (v{v})" },
  "menu.pick_osu_dir": { en: "Select osu! install folder (containing Songs / Skins)", "zh-CN": "选择 osu! 安装目录 (含 Songs / Skins 文件夹)", "zh-TW": "選擇 osu! 安裝目錄 (含 Songs / Skins 資料夾)" },
  "menu.songs_dir_missing": { en: "Songs folder does not exist: {path}", "zh-CN": "Songs 目录不存在: {path}", "zh-TW": "Songs 目錄不存在: {path}" },
  "menu.skin_dir_missing": { en: "Skin folder does not exist: {path}", "zh-CN": "皮肤目录不存在: {path}", "zh-TW": "皮膚目錄不存在: {path}" },
  "menu.no_backups": { en: "No backups yet", "zh-CN": "尚无备份", "zh-TW": "尚無備份" },
}
// 渲染端上报前默认 zh-CN (保持既有行为); "debug" 等未识别值同样回退 zh-CN
let menuLang = "zh-CN"
ipcMain.on("menu-lang", (_e, l) => {
  menuLang = l === "en" || l === "zh-TW" ? l : "zh-CN"
  buildMenu()
})
function mT(key, vars) {
  const e = MENU_LABELS[key]
  let s = (e && (e[menuLang] ?? e.en)) ?? key
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
  return s
}

function buildMenu() {
  const songsDir = readSettings().songsDir
  const curFolderAbs = menuState?.folderRel && songsDir ? path.join(songsDir, menuState.folderRel) : null
  const curFileAbs = curFolderAbs && menuState ? path.join(curFolderAbs, menuState.file) : null
  const recents = readSettings().recents ?? []
  const send = (cmd) => win?.webContents.send("menu-cmd", cmd)
  const template = [
    {
      label: mT("menu.file"),
      submenu: [
        { label: mT("menu.save"), accelerator: acc("save", "CmdOrCtrl+S"), enabled: !!menuState, click: () => send({ type: "save" }) },
        { type: "separator" },
        {
          label: mT("menu.open_difficulty"),
          submenu: menuState?.difficulties?.length
            ? menuState.difficulties.map((d) => ({
                label: (d.file === menuState.file ? "✓ " : "") + d.label,
                click: () => send({ type: "open", folderRel: menuState.folderRel, file: d.file }),
              }))
            : [{ label: mT("menu.no_beatmap"), enabled: false }],
        },
        {
          label: mT("menu.open_recent"),
          submenu: recents.length
            ? recents.map((r) => ({
                label: r.label ?? r.file,
                click: () => send({ type: "open", folderRel: r.folderRel, file: r.file }),
              }))
            : [{ label: mT("menu.none"), enabled: false }],
        },
        { type: "separator" },
        {
          label: mT("menu.open_song_folder"),
          enabled: !!curFolderAbs,
          click: () => { if (curFolderAbs) shell.openPath(curFolderAbs) },
        },
        // v185: 打开当前谱面的备份文件夹 (exe 同目录 backup_beatmaps/<艺术家_歌曲名>)
        { label: mT("menu.view_backups"), enabled: !!menuState, click: () => send({ type: "open-backups" }) },
        {
          label: mT("menu.open_osu_in_notepad"),
          enabled: !!curFileAbs,
          click: () => {
            if (!curFileAbs) return
            try { spawn("notepad.exe", [curFileAbs], { detached: true, stdio: "ignore" }).unref() } catch { /* 忽略 */ }
          },
        },
      ],
    },
    // v209: 原生 "编辑" 菜单 (stable 同款; 快捷键 accelerator 仅作显示 registerAccelerator:false,
    // 实际按键仍走渲染进程 App.tsx keydown — 避免全局截获 Ctrl+C/V/X/A/Z/Y 破坏输入框编辑)
    {
      label: mT("menu.edit"),
      submenu: (() => {
        const e = (type, label, accelerator, enabled) => ({
          label, enabled, click: () => send({ type }),
          ...(accelerator ? { accelerator: acc(type, accelerator), registerAccelerator: false } : {}), // v286: acc() 改键后菜单文字同步
        })
        const map = editState.hasMap, sel = editState.hasSelection, clip = editState.hasClipboard
        return [
          e("edit-undo", mT("menu.undo"), "CmdOrCtrl+Z", map),
          e("edit-redo", mT("menu.redo"), "CmdOrCtrl+Y", map),
          { type: "separator" },
          e("edit-cut", mT("menu.cut"), "CmdOrCtrl+X", sel),
          e("edit-copy", mT("menu.copy"), "CmdOrCtrl+C", sel),
          e("edit-paste", mT("menu.paste"), "CmdOrCtrl+V", clip),
          e("edit-delete", mT("menu.delete"), "Delete", sel),
          { type: "separator" },
          e("edit-select-all", mT("menu.select_all"), "CmdOrCtrl+A", map),
          e("edit-duplicate", mT("menu.duplicate"), "CmdOrCtrl+D", sel),
          { type: "separator" },
          e("edit-reverse", mT("menu.reverse"), "CmdOrCtrl+G", sel),
          e("edit-flip-h", mT("menu.flip_h"), "CmdOrCtrl+H", sel),
          e("edit-flip-v", mT("menu.flip_v"), "CmdOrCtrl+J", sel),
          e("edit-rot-cw", mT("menu.rot_cw"), "CmdOrCtrl+.", sel),
          e("edit-rot-ccw", mT("menu.rot_ccw"), "CmdOrCtrl+,", sel),
          e("edit-open-rotate", mT("menu.rotate"), "CmdOrCtrl+Shift+R", sel),
          e("edit-open-scale", mT("menu.scale"), "CmdOrCtrl+Shift+S", sel),
          e("edit-open-symmetry", mT("menu.symmetry"), null, sel), // v210: 无快捷键
          { type: "separator" },
          e("edit-clear-hs-selected", mT("menu.clear_hs_selected"), null, sel),
          e("edit-clear-hs-all", mT("menu.clear_hs_all"), null, map),
          e("edit-reset-combo", mT("menu.reset_combo"), null, map),
          e("edit-reset-breaks", mT("menu.reset_breaks"), null, map),
          { type: "separator" },
          e("edit-nudge-prev", mT("menu.nudge_prev"), "J", sel),
          e("edit-nudge-next", mT("menu.nudge_next"), "K", sel),
        ]
      })(),
    },
    // v212: 原生 "作图" 菜单 (stable 同款; 转连打需选中滑条, 合并需 >=2 选中, 多边形只需已加载谱面)
    {
      label: mT("menu.compose"),
      submenu: (() => {
        const e2 = (type, label, accelerator, enabled) => ({
          label, enabled, click: () => send({ type }),
          ...(accelerator ? { accelerator: acc(type, accelerator), registerAccelerator: false } : {}), // v286: acc() 改键后菜单文字同步
        })
        return [
          e2("compose-polygon", mT("menu.polygon"), "CmdOrCtrl+Shift+D", editState.hasMap),
          e2("compose-stream", mT("menu.stream"), null, editState.hasSlider),
          e2("compose-merge", mT("menu.merge"), null, editState.selMulti),
          e2("compose-sym-slider", mT("menu.sym_slider"), null, editState.selSingleSlider), // v236
        ]
      })(),
    },
    // v156: 原生 Timing 菜单 (stable 同款; 全部命令经 menu-cmd 转发渲染进程执行, 勾选状态由渲染进程上报)
    {
      label: "Timing",
      submenu: [
        {
          label: mT("menu.meter"),
          submenu: [2, 3, 4, 5, 6, 7].map((m) => ({
            label: m === 4 ? mT("menu.meter_common") : m === 3 ? mT("menu.meter_waltz") : `${m}/4`,
            type: "radio",
            checked: timingState.meter === m,
            enabled: !!menuState,
            click: () => send({ type: "timing-set-meter", meter: m }),
          })),
        },
        { label: mT("menu.metronome"), type: "checkbox", checked: timingState.metronome, enabled: !!menuState, click: () => send({ type: "timing-toggle-metronome" }) },
        { type: "separator" },
        { label: mT("menu.add_timing"), accelerator: acc("timing-add-red", "CmdOrCtrl+P"), enabled: !!menuState, click: () => send({ type: "timing-add-red" }) },
        { label: mT("menu.add_inherited"), accelerator: acc("timing-add-green", "CmdOrCtrl+Shift+P"), enabled: !!menuState, click: () => send({ type: "timing-add-green" }) },
        { label: mT("menu.reset_current"), enabled: !!menuState, click: () => send({ type: "timing-reset-current" }) },
        { label: mT("menu.delete_timing"), accelerator: acc("timing-delete-current", "CmdOrCtrl+I"), enabled: !!menuState, click: () => send({ type: "timing-delete-current" }) },
        { label: mT("menu.resnap_current"), enabled: !!menuState, click: () => send({ type: "timing-resnap-current" }) },
        { label: mT("menu.timing_setup"), accelerator: acc("timing-open-settings", "F6"), click: () => send({ type: "timing-open-settings" }) },
        { type: "separator" },
        { label: mT("menu.resnap_all"), enabled: !!menuState, click: () => send({ type: "timing-resnap-all" }) },
        { label: mT("menu.shift_all"), enabled: !!menuState, click: () => send({ type: "timing-shift-all" }) },
        { label: mT("menu.recalc_sliders"), enabled: !!menuState, click: () => send({ type: "timing-recalc-sliders" }) },
        { label: mT("menu.delete_all_timing"), enabled: !!menuState, click: () => send({ type: "timing-delete-all" }) },
        { type: "separator" },
        { label: mT("menu.set_preview"), enabled: !!menuState, click: () => send({ type: "timing-set-preview" }) },
      ],
    },
    {
      label: mT("menu.settings"),
      submenu: [
        { label: mT("menu.reconfigure"), click: () => win?.webContents.send("open-setup") },
        { type: "separator" },
        { role: "reload", label: mT("menu.reload") },
        { role: "toggleDevTools", label: mT("menu.devtools") },
        { type: "separator" },
        { role: "quit", label: mT("menu.quit") },
      ],
    },
    // v215: 关于窗口 (版本/声明 + GitHub 源码与 Releases 链接)
    {
      label: mT("menu.about"),
      submenu: [
        { label: mT("menu.about_app", { v: APP_VERSION }), click: openAboutWindow },
      ],
    },
    // (v123: v121 的菜单栏指示器已移除 — 原生菜单项无法右对齐, 改为应用内顶栏最右侧浮层)
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  // v280: 推送应用内菜单栏定义 (hideTitleBar 模式下渲染端自绘菜单条)
  menuActions.clear()
  lastMenuDef = serializeMenuItems(template)
  win?.webContents.send("menu-definition", lastMenuDef)
}

app.on("window-all-closed", () => app.quit())

// 启动: 先加载共享 ESM 端点模块 (CJS 无顶层 await, 统一在异步入口里做), 再建窗
async function main() {
  const { createLocalFsHandler } = await import("../server/localFsCore.mjs")
  handleLocalFs = makeLocalFsHandler(createLocalFsHandler)
  pushRecent = (await import("../server/recentsCore.mjs")).pushRecent
  backupCore = await import("../server/backupCore.mjs") // v185: 谱面备份
  await app.whenReady()
  buildMenu()
  await createWindow()
}
main().catch(e => { console.error(e); app.quit() })
