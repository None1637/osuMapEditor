// Electron 桥接: preload (electron/preload.cjs) 注入的 window.osuEditor 类型化访问。
// 浏览器 / vite dev 下为 undefined → isElectron() = false, 走现有浏览器行为 (调试直进编辑器)。

export interface ElectronSettings {
  osuPath: string | null;
  songsDir: string | null;
  skinDir: string | null;
  skinName: string | null;
  /** true = 曲库目录未配置或已失效 → 显示首跑向导 */
  firstRun: boolean;
  /** 探测到的默认 osu! 路径 (%LOCALAPPDATA%/osu!), 无则 null */
  suggestedOsuPath: string | null;
}

export interface PickOsuDirResult {
  osuPath: string;
  hasSongs: boolean;
  hasSkins: boolean;
}

export interface SaveSettingsResult {
  songsDir: string;
  skinDir: string | null;
  skinName: string | null;
}

export interface ElectronAPI {
  isElectron: true;
  getSettings(): Promise<ElectronSettings>;
  pickOsuDir(defaultPath?: string | null): Promise<PickOsuDirResult | null>;
  listSkinDirs(osuPath: string): Promise<string[]>;
  saveSettings(cfg: { osuPath: string; skinName: string | null }): Promise<SaveSettingsResult>;
  onOpenSetup(cb: () => void): void;
  /** v77: 上报当前谱面状态给原生 "文件" 菜单 */
  menuState(state: ElectronMenuState): void;
  /** v77: 订阅原生菜单命令; 返回退订函数 */
  onMenuCommand(cb: (cmd: ElectronMenuCommand) => void): () => void;
  /** v94: 最近难度列表 (新条目置顶; 启动时取 [0] 恢复上次谱面) */
  getRecents(): Promise<ElectronRecentEntry[]>;
  /** v120: 上报未保存改动状态 (主进程据此拦截窗口关闭) */
  dirtyState(b: boolean): void;
  /** v120: 订阅主进程的关闭请求 (窗口关闭被拦截时触发, 渲染端弹保存/废弃提示); 返回退订函数 */
  onCloseRequest(cb: () => void): () => void;
  /** v120: 确认关闭 (保存/废弃后调用, 主进程真正关窗) */
  confirmClose(): void;
  /** v156: 上报 Timing 菜单勾选状态 (节拍类型 radio = 当前生效红线拍号; 节拍器 checkbox) */
  menuTimingState(state: { meter: number | null; metronome: boolean }): void;
  /** v185: 谱面备份 (主进程写 exe 同目录 backup_beatmaps/<艺术家_歌曲名>/<原名_时间戳>.osu) */
  backupBeatmap(payload: { artist: string; title: string; origFile: string; content: string }): Promise<{ ok: boolean; action?: string; folder?: string; file?: string; error?: string }>;
  /** v185: 打开当前谱面的备份文件夹 */
  openBackupFolder(info: { artist: string; title: string }): Promise<{ ok: boolean; error?: string }>;
  /** v209: 上报编辑菜单置灰状态 (有谱面/有选中/剪贴板有内容; 值变化才发) */
  menuEditState(state: ElectronEditMenuState): void;
}

/** v94: 最近难度条目 (主进程 settings.json recents) */
export interface ElectronRecentEntry {
  folderRel: string;
  file: string;
  label?: string;
}

/** v77: 渲染端 -> 主进程的菜单状态 (folderRel = Songs 内相对路径; 非服务器来源为 null) */
export interface ElectronMenuState {
  file: string | null;
  folderRel: string | null;
  title: string;
  difficulties: { file: string; label: string }[];
}

/** v77: 主进程 -> 渲染端的菜单命令; v156: Timing 菜单命令组 */
export type ElectronMenuCommand =
  | { type: 'save' }
  | { type: 'open'; folderRel: string; file: string }
  | { type: 'timing-set-meter'; meter: number }
  | { type: 'timing-toggle-metronome' }
  | { type: 'timing-add-red' }
  | { type: 'timing-add-green' }
  | { type: 'timing-reset-current' }
  | { type: 'timing-delete-current' }
  | { type: 'timing-resnap-current' }
  | { type: 'timing-resnap-all' }
  | { type: 'timing-open-settings' }
  | { type: 'timing-shift-all' }
  | { type: 'timing-recalc-sliders' }
  | { type: 'timing-delete-all' }
  | { type: 'timing-set-preview' }
  | { type: 'open-backups' } // v185: 文件菜单「查看备份」
  // ---- v209: 编辑菜单 (stable 同款; 快捷键仅显示, 实际按键仍走 App.tsx keydown) ----
  | { type: 'edit-undo' }
  | { type: 'edit-redo' }
  | { type: 'edit-cut' }
  | { type: 'edit-copy' }
  | { type: 'edit-paste' }
  | { type: 'edit-delete' }
  | { type: 'edit-select-all' }
  | { type: 'edit-duplicate' } // 仿制 → 打开批量复制窗口
  | { type: 'edit-reverse' }
  | { type: 'edit-flip-h' }
  | { type: 'edit-flip-v' }
  | { type: 'edit-rot-cw' }
  | { type: 'edit-rot-ccw' }
  | { type: 'edit-open-rotate' } // 打开旋转窗口
  | { type: 'edit-open-scale' } // 打开缩放窗口
  | { type: 'edit-open-symmetry' } // v210: 打开对称窗口 (无快捷键)
  | { type: 'edit-clear-hs-selected' }
  | { type: 'edit-clear-hs-all' }
  | { type: 'edit-reset-combo' }
  | { type: 'edit-reset-breaks' }
  | { type: 'edit-nudge-prev' } // 前移 (J)
  | { type: 'edit-nudge-next' } // 后移 (K)
  // ---- v212: 作图菜单 (stable 同款; 多边形生成/滑条转连打 = 打开参数窗口, 合并滑条 = 直接应用) ----
  | { type: 'compose-polygon' }
  | { type: 'compose-stream' }
  | { type: 'compose-merge' }
  | { type: 'compose-sym-slider' }; // v236: 对称滑条 (恰好选中 1 个滑条时可用)

/** v209: 渲染端 -> 主进程的编辑菜单置灰状态; v212: 扩 hasSlider/selMulti (作图菜单置灰用) */
export interface ElectronEditMenuState {
  hasMap: boolean;
  hasSelection: boolean;
  hasClipboard: boolean;
  /** 选中物件中含滑条 (「滑条转连打」可用) */
  hasSlider: boolean;
  /** 选中物件 >= 2 (「合并滑条」可用) */
  selMulti: boolean;
  /** v236: 恰好选中 1 个滑条 (「对称滑条」可用) */
  selSingleSlider: boolean;
}

export function getElectronAPI(): ElectronAPI | null {
  if (typeof window === 'undefined') return null; // v120: node 单测环境 (无 window) 一律视为非 Electron
  return (window as unknown as { osuEditor?: ElectronAPI }).osuEditor ?? null;
}

export function isElectron(): boolean {
  return getElectronAPI() !== null;
}

/** ipcMain.handle 抛错时 Electron 会加 "Error invoking remote method ..." 前缀, 剥掉以显示原始信息 */
export function ipcErrorMessage(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
