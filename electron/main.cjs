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
      req.on("end", () => {
        const r = handleLocalFs(req.method ?? "GET", url.pathname, url.searchParams, chunks.length ? Buffer.concat(chunks) : undefined)
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
  }
})

// v94: 最近难度列表 (渲染端启动时取 recents[0] 自动恢复上次谱面)
ipcMain.handle("get-recents", () => readSettings().recents ?? [])

ipcMain.handle("pick-osu-dir", async (_e, defaultPath) => {
  const r = await dialog.showOpenDialog(win, {
    title: "选择 osu! 安装目录 (含 Songs / Skins 文件夹)",
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
  if (!dirExists(songsDir)) throw new Error("Songs 目录不存在: " + songsDir)
  const skinDir = skinName ? path.join(osuPath, "Skins", skinName) : null
  if (skinDir && !dirExists(skinDir)) throw new Error("皮肤目录不存在: " + skinDir)
  writeSettings({ ...readSettings(), osuPath, songsDir, skinDir })
  return { songsDir, skinDir, skinName }
})

// ---------- 窗口 ----------
// v120: 未保存改动拦截 — 渲染端经 "dirty-state" 上报; 关窗时若有脏改动则拦下并回发 "close-request",
// 渲染端弹保存/废弃提示, 确认后 "close-confirmed" 才真正关窗
let isDirty = false
ipcMain.on("dirty-state", (_e, b) => { isDirty = !!b }) // v123: 不再重建菜单 (指示器移入应用内顶栏)
ipcMain.on("close-confirmed", () => { isDirty = false; win?.close() })

async function createWindow() {
  const port = await startServer()
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#101016",
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
    if (!fs.existsSync(folder)) return { ok: false, error: "尚无备份" }
    shell.openPath(folder)
    return { ok: true }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
})

function buildMenu() {
  const songsDir = readSettings().songsDir
  const curFolderAbs = menuState?.folderRel && songsDir ? path.join(songsDir, menuState.folderRel) : null
  const curFileAbs = curFolderAbs && menuState ? path.join(curFolderAbs, menuState.file) : null
  const recents = readSettings().recents ?? []
  const send = (cmd) => win?.webContents.send("menu-cmd", cmd)
  const menu = Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [
        { label: "保存", accelerator: "CmdOrCtrl+S", enabled: !!menuState, click: () => send({ type: "save" }) },
        { type: "separator" },
        {
          label: "打开一个难度",
          submenu: menuState?.difficulties?.length
            ? menuState.difficulties.map((d) => ({
                label: (d.file === menuState.file ? "✓ " : "") + d.label,
                click: () => send({ type: "open", folderRel: menuState.folderRel, file: d.file }),
              }))
            : [{ label: "(未加载谱面)", enabled: false }],
        },
        {
          label: "打开最近的难度",
          submenu: recents.length
            ? recents.map((r) => ({
                label: r.label ?? r.file,
                click: () => send({ type: "open", folderRel: r.folderRel, file: r.file }),
              }))
            : [{ label: "(无)", enabled: false }],
        },
        { type: "separator" },
        {
          label: "打开歌曲文件夹",
          enabled: !!curFolderAbs,
          click: () => { if (curFolderAbs) shell.openPath(curFolderAbs) },
        },
        // v185: 打开当前谱面的备份文件夹 (exe 同目录 backup_beatmaps/<艺术家_歌曲名>)
        { label: "查看备份", enabled: !!menuState, click: () => send({ type: "open-backups" }) },
        {
          label: "在记事本中打开.osu文件",
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
      label: "编辑",
      submenu: (() => {
        const e = (type, label, accelerator, enabled) => ({
          label, enabled, click: () => send({ type }),
          ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
        })
        const map = editState.hasMap, sel = editState.hasSelection, clip = editState.hasClipboard
        return [
          e("edit-undo", "撤消", "CmdOrCtrl+Z", map),
          e("edit-redo", "重做", "CmdOrCtrl+Y", map),
          { type: "separator" },
          e("edit-cut", "剪切", "CmdOrCtrl+X", sel),
          e("edit-copy", "复制", "CmdOrCtrl+C", sel),
          e("edit-paste", "粘贴", "CmdOrCtrl+V", clip),
          e("edit-delete", "删除", "Delete", sel),
          { type: "separator" },
          e("edit-select-all", "全选", "CmdOrCtrl+A", map),
          e("edit-duplicate", "批量复制...", "CmdOrCtrl+D", sel),
          { type: "separator" },
          e("edit-reverse", "反选", "CmdOrCtrl+G", sel),
          e("edit-flip-h", "左右翻转", "CmdOrCtrl+H", sel),
          e("edit-flip-v", "上下翻转", "CmdOrCtrl+J", sel),
          e("edit-rot-cw", "顺时针旋转90°", "CmdOrCtrl+.", sel),
          e("edit-rot-ccw", "逆时针旋转90°", "CmdOrCtrl+,", sel),
          e("edit-open-rotate", "旋转...", "CmdOrCtrl+Shift+R", sel),
          e("edit-open-scale", "缩放...", "CmdOrCtrl+Shift+S", sel),
          e("edit-open-symmetry", "对称...", null, sel), // v210: 无快捷键
          { type: "separator" },
          e("edit-clear-hs-selected", "清除所选物件的音效", null, sel),
          e("edit-clear-hs-all", "清除所有音效", null, map),
          e("edit-reset-combo", "重置combo组的颜色", null, map),
          e("edit-reset-breaks", "重置休息时段", null, map),
          { type: "separator" },
          e("edit-nudge-prev", "前移", "J", sel),
          e("edit-nudge-next", "后移", "K", sel),
        ]
      })(),
    },
    // v212: 原生 "作图" 菜单 (stable 同款; 转连打需选中滑条, 合并需 >=2 选中, 多边形只需已加载谱面)
    {
      label: "作图",
      submenu: (() => {
        const e2 = (type, label, accelerator, enabled) => ({
          label, enabled, click: () => send({ type }),
          ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
        })
        return [
          e2("compose-polygon", "多边形生成...", "CmdOrCtrl+Shift+D", editState.hasMap),
          e2("compose-stream", "滑条转连打...", null, editState.hasSlider),
          e2("compose-merge", "合并滑条", null, editState.selMulti),
          e2("compose-sym-slider", "对称滑条...", null, editState.selSingleSlider), // v236
        ]
      })(),
    },
    // v156: 原生 Timing 菜单 (stable 同款; 全部命令经 menu-cmd 转发渲染进程执行, 勾选状态由渲染进程上报)
    {
      label: "Timing",
      submenu: [
        {
          label: "节拍类型",
          submenu: [2, 3, 4, 5, 6, 7].map((m) => ({
            label: m === 4 ? "4/4 (普通/四拍子)" : m === 3 ? "3/4 (华尔兹/三拍子)" : `${m}/4`,
            type: "radio",
            checked: timingState.meter === m,
            enabled: !!menuState,
            click: () => send({ type: "timing-set-meter", meter: m }),
          })),
        },
        { label: "节拍器", type: "checkbox", checked: timingState.metronome, enabled: !!menuState, click: () => send({ type: "timing-toggle-metronome" }) },
        { type: "separator" },
        { label: "添加Timing区间 (即红线)", accelerator: "CmdOrCtrl+P", enabled: !!menuState, click: () => send({ type: "timing-add-red" }) },
        { label: "添加继承区间 (即绿线)", accelerator: "CmdOrCtrl+Shift+P", enabled: !!menuState, click: () => send({ type: "timing-add-green" }) },
        { label: "重置当前区间", enabled: !!menuState, click: () => send({ type: "timing-reset-current" }) },
        { label: "删除Timing区间", accelerator: "CmdOrCtrl+I", enabled: !!menuState, click: () => send({ type: "timing-delete-current" }) },
        { label: "重新对齐当前Timing区间", enabled: !!menuState, click: () => send({ type: "timing-resnap-current" }) },
        { label: "Timing设置...", accelerator: "F6", click: () => send({ type: "timing-open-settings" }) },
        { type: "separator" },
        { label: "全部重新对齐", enabled: !!menuState, click: () => send({ type: "timing-resnap-all" }) },
        { label: "整体平移所有物件的时间...", enabled: !!menuState, click: () => send({ type: "timing-shift-all" }) },
        { label: "重新计算滑条长度", enabled: !!menuState, click: () => send({ type: "timing-recalc-sliders" }) },
        { label: "删除所有Timing区间", enabled: !!menuState, click: () => send({ type: "timing-delete-all" }) },
        { type: "separator" },
        { label: "把当前位置设为预览点", enabled: !!menuState, click: () => send({ type: "timing-set-preview" }) },
      ],
    },
    {
      label: "设置",
      submenu: [
        { label: "重新配置 osu! 目录与皮肤", click: () => win?.webContents.send("open-setup") },
        { type: "separator" },
        { role: "reload", label: "刷新" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    // v215: 关于窗口 (版本/声明 + GitHub 源码与 Releases 链接)
    {
      label: "关于",
      submenu: [
        { label: `关于 osu! Map Editor (v${APP_VERSION})`, click: openAboutWindow },
      ],
    },
    // (v123: v121 的菜单栏指示器已移除 — 原生菜单项无法右对齐, 改为应用内顶栏最右侧浮层)
  ])
  Menu.setApplicationMenu(menu)
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
