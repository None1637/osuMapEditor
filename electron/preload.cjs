// preload: 把主进程能力以最小面暴露给页面 (contextIsolation 下唯一通道)
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("osuEditor", {
  isElectron: true,
  getSettings: () => ipcRenderer.invoke("get-settings"),
  pickOsuDir: (defaultPath) => ipcRenderer.invoke("pick-osu-dir", defaultPath),
  listSkinDirs: (osuPath) => ipcRenderer.invoke("list-skin-dirs", osuPath),
  saveSettings: (cfg) => ipcRenderer.invoke("save-settings", cfg),
  onOpenSetup: (cb) => { ipcRenderer.on("open-setup", () => cb()) },
  // v77: 原生 "文件" 菜单: 渲染端上报当前谱面状态 / 接收菜单命令 ({type:'save'} | {type:'open', folderRel, file})
  menuState: (state) => ipcRenderer.send("menu-state", state),
  // v94: 最近难度列表 (启动恢复上次谱面用)
  getRecents: () => ipcRenderer.invoke("get-recents"),
  onMenuCommand: (cb) => {
    const listener = (_e, cmd) => cb(cmd)
    ipcRenderer.on("menu-cmd", listener)
    return () => ipcRenderer.removeListener("menu-cmd", listener)
  },
  // v120: 未保存改动 — 渲染端上报脏标记; 主进程拦截窗口关闭并发回 close-request; 渲染端确认后 confirmClose 真正关窗
  dirtyState: (b) => ipcRenderer.send("dirty-state", b),
  onCloseRequest: (cb) => {
    const listener = () => cb()
    ipcRenderer.on("close-request", listener)
    return () => ipcRenderer.removeListener("close-request", listener)
  },
  confirmClose: () => ipcRenderer.send("close-confirmed"),
  // v156: Timing 菜单勾选状态 (节拍类型 radio / 节拍器 checkbox)
  menuTimingState: (s) => ipcRenderer.send("timing-menu-state", s),
  // v185: 谱面备份 (主进程写 exe 同目录 backup_beatmaps; 内容与上次相同则改名去重)
  backupBeatmap: (payload) => ipcRenderer.invoke("backup-beatmap", payload),
  openBackupFolder: (info) => ipcRenderer.invoke("open-backup-folder", info),
  // v209: 编辑菜单置灰状态 (有谱面/有选中/剪贴板有内容)
  menuEditState: (s) => ipcRenderer.send("edit-menu-state", s),
  // v263: 窗口条隐藏开关 (写 settings.json, 重启生效)
  setHideTitleBar: (b) => ipcRenderer.invoke("set-hide-title-bar", b),
})
