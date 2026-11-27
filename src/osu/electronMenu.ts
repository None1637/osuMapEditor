// v77: Electron 原生 "文件" 菜单的渲染端 (非 Electron 环境全部无操作)
//  - reportMenuState: store.load 后上报当前谱面 (文件/歌曲文件夹相对路径/难度列表) 给主进程建菜单;
//  - handleMenuCommand: 菜单命令 — save = store.save (与 Ctrl+S 相同), open = 经服务器目录加载指定难度
//    ("打开一个难度" 与 "打开最近的难度" 共用; 目录/文件已删除时静默失败并 console.error, 不打断编辑器)。
import { store } from './store';
import { fetchServerDirs, serverDir } from './serverFs';
import { listDifficulties, loadDifficulty } from './library';
import { createEmptyBeatmap, createNewBeatmapSource } from './newBeatmap'; // v521
import { getElectronAPI, type ElectronMenuCommand } from './electronBridge';
import { getLang, onLangChange, tNow } from '@/i18n'; // v346: 多语言 — 语言上报主进程 (菜单标签重建)
import { editorPrefs } from './editorPrefs'; // v386: 设置菜单 editorPrefs 勾选开关
import { computeMerge } from './convert/merge'; // v212: 作图菜单「合并滑条」
import type { Beatmap } from './parser';
import type { MapSource } from './saveMap';
import { getUiLayout, subscribeUiLayout } from './uiLayout'; // v526

/** 向主进程上报当前谱面状态 (store.load 中调用; 非 Electron 或无来源时尽力而为) */
export async function reportMenuState(bm: Beatmap, source: MapSource | null): Promise<void> {
  const ed = getElectronAPI();
  if (!ed) return;
  const folderRel = source?.dir.serverRel ?? null;
  const root = source?.dir.serverRoot === 'external' ? 'external' as const : undefined;
  const folderAbs = source?.dir.serverAbs ?? null; // v611
  let difficulties: { file: string; label: string }[] = [];
  if (source && folderRel !== null) {
    try {
      const ds = await listDifficulties(source.dir);
      difficulties = ds.map(d => ({ file: d.fileName, label: d.version ? `[${d.version}] ${d.fileName}` : d.fileName }));
    } catch { /* 目录不可读则难度子菜单留空 */ }
  }
  const m = bm.metadata;
  ed.menuState({
    file: source?.fileName ?? null,
    folderRel, root, folderAbs,
    title: `${m.artist || m.artistUnicode} - ${m.title || m.titleUnicode} [${m.version}]`,
    difficulties,
  });
}

/** v120: 向主进程上报脏标记 (关闭窗口拦截用; 非 Electron 无操作) */
export function reportDirtyState(b: boolean): void {
  getElectronAPI()?.dirtyState(b);
}

// v346: 界面语言上报 — 启动时上报一次当前语言, 之后 onLangChange 订阅切换;
// 主进程收到 "menu-lang" 后重建菜单 (buildMenu → onMenuDefinition 推送, MenuBar 自动刷新)
{
  const api = getElectronAPI();
  if (api) {
    api.menuLang(getLang());
    onLangChange(() => api.menuLang(getLang()));
  }
}

// v526: 布局配置中的菜单项覆盖 → 主进程 (当前语言文本 + visible/enabled); 配置/语言变化均重建菜单
{
  const api = getElectronAPI();
  if (api) {
    const report = () => {
      const out: Record<string, { text?: string; visible?: boolean; enabled?: boolean }> = {};
      const lang = getLang();
      for (const [id, o] of Object.entries(getUiLayout().controls)) {
        if (!id.startsWith('menu.')) continue;
        out[id] = { text: o.text?.[lang === 'debug' ? 'en' : lang], visible: o.visible, enabled: o.enabled };
      }
      api.uiMenuOverrides(out);
    };
    report(); subscribeUiLayout(report); onLangChange(report);
  }
}

/** 经服务器目录加载指定难度; 成功返回 true。v120: 有未保存改动时先弹保存/废弃提示 (提示确认后重入本函数) */
export async function openServerDifficulty(
  folderRel: string, file: string, root: 'songs' | 'external' = 'songs', folderAbs?: string | null,
): Promise<boolean> {
  if (!store.guardUnsaved(() => { void openServerDifficulty(folderRel, file, root, folderAbs); })) return true;
  try {
    // v611: 文件选择器只返回路径; 确认丢弃/保存旧谱面后才切换外部根, 避免取消后旧谱面写错目录
    if (root === 'external') {
      if (!folderAbs || !(await getElectronAPI()?.useExternalBeatmapDir(folderAbs))) return false;
    }
    const dir = serverDir(root, folderRel, folderAbs || folderRel);
    if (folderAbs) dir.serverAbs = folderAbs;
    const r = await loadDifficulty(dir, file);
    if (!r) return false;
    // 与曲库 openDiff 相同: 记录来源, Ctrl+S 写回该文件
    store.load(r.bm, r.audioUrl, r.bgUrl, r.samples, { dir, fileName: file }, r.audioKey); // v444
    // v611: 不再限制 Songs 目录; 仅在找不到谱面歌曲文件时提示
    if (r.audioMissing) alert(tNow('library.audio_missing', 'Beatmap loaded, but no audio file was found (a synthesized metronome will be used).'));
    return true;
  } catch (e) {
    console.error('菜单打开难度失败:', e);
    return false;
  }
}

/** v521: 参考 lazer — 新建空谱面后进入 Song Setup; 返回 false = 未保存提示尚未确认/取消 */
export async function newBeatmap(onCreated?: () => void): Promise<boolean> {
  if (!store.guardUnsaved(() => { void newBeatmap(onCreated); })) return false;
  const dirs = await fetchServerDirs();
  const source = dirs?.songsDir ? createNewBeatmapSource() : null;
  store.load(createEmptyBeatmap(), null, null, undefined, source, null, true);
  onCreated?.(); //  guardUnsaved 确认后的重入也必须进入 Song Setup
  return true;
}

/** 菜单命令入口 (App.tsx 订阅 onMenuCommand; CDP 经 window.__osuMenuCmd 直接调用) */
export async function handleMenuCommand(cmd: ElectronMenuCommand, onCreated?: () => void) {
  if (cmd.type === 'new') return newBeatmap(onCreated);
  if (cmd.type === 'save') { await store.save(); return; }
  if (cmd.type === 'open') { await openServerDifficulty(cmd.folderRel, cmd.file, cmd.root, cmd.folderAbs); return; }
  // v156: Timing 菜单 (timing-open-settings / timing-shift-all 由 App.tsx 处理 — 涉及页签切换/弹窗 UI)
  switch (cmd.type) {
    case 'timing-add-red': store.timingAddPoint(true); return;
    case 'timing-add-green': store.timingAddPoint(false); return;
    case 'timing-set-meter': store.timingSetMeter(cmd.meter); return;
    case 'timing-toggle-metronome': store.toggleMetronome(); return;
    case 'timing-reset-current': store.timingResetCurrent(); return;
    case 'timing-delete-current': store.timingDeleteCurrent(); return;
    case 'timing-resnap-current': store.timingResnap('current'); return;
    case 'timing-resnap-bookmarks': store.timingResnap('bookmarks'); return; // v355
    case 'timing-hitsound-bookmarks': store.openBookmarkHitSound(); return; // v585
    case 'bookmark-add': store.addBookmark(store.currentTime); return; // v597
    case 'bookmark-remove': store.removeBookmarkNear(store.currentTime); return;
    case 'timing-resnap-all': store.timingResnap('all'); return;
    case 'timing-recalc-sliders': store.timingRecalcSliders(); return;
    case 'timing-delete-all': store.timingDeleteAll(); return;
    case 'timing-set-preview': store.timingSetPreview(); return;
    // ---- v209: 编辑菜单 (置灰由主进程按 edit-menu-state 处理; 变换类与快捷键同语义 — 围绕游玩区中心) ----
    case 'edit-undo': store.undo(); return;
    case 'edit-redo': store.redo(); return;
    case 'edit-cut': store.cut(); return;
    case 'edit-copy': store.copy(); return;
    case 'edit-paste': store.paste(store.currentTime); return;
    case 'edit-delete': store.deleteSelected(); return;
    case 'edit-select-all': store.selectAllObjects(); return;
    case 'edit-duplicate': if (store.selected.size) store.openConversion('duplicate'); return; // 仿制 → 批量复制窗口
    case 'edit-reverse': store.reverseSelected(); return;
    // v304: F08 — 有滑条锚点选区时变换作用于锚点 (原点 = 锚点点集质心 (v516)), 否则物件选区 (游玩区中心)
    case 'edit-flip-h': store.nodeSelectionCount ? store.flipSelectedNodes('h') : store.flipSelected('h', 'playfield'); return;
    case 'edit-flip-v': store.nodeSelectionCount ? store.flipSelectedNodes('v') : store.flipSelected('v', 'playfield'); return;
    case 'edit-rot-cw': store.nodeSelectionCount ? store.rotateSelectedNodes(90) : store.rotateSelected(90, 'playfield'); return;
    case 'edit-rot-ccw': store.nodeSelectionCount ? store.rotateSelectedNodes(-90) : store.rotateSelected(-90, 'playfield'); return;
    case 'edit-open-rotate': store.openTransformDialog('rotate'); return;
    case 'edit-open-scale': store.openTransformDialog('scale'); return;
    case 'edit-open-symmetry': store.openTransformDialog('symmetry'); return; // v210
    case 'edit-clear-hs-selected': store.clearHitSounds('selected'); return;
    case 'edit-clear-hs-all': store.clearHitSounds('all'); return;
    case 'edit-reset-combo': store.resetComboFlags(); return;
    case 'edit-reset-breaks': store.resetBreaks(); return;
    case 'edit-nudge-prev': store.nudgeSelectedBySnap(-1); return;
    case 'edit-nudge-next': store.nudgeSelectedBySnap(1); return;
    // ---- v212: 作图菜单 (与 Inspector 入口同语义) ----
    case 'compose-polygon': store.openConversion('polygon'); return; // 无需选区
    // v386: 设置菜单 — editorPrefs 勾选开关 (翻转后 store.setEditorPref 内部 emitSelection → App.tsx 订阅回报主进程重建勾选)
    case 'settings-toggle-editor-pref': store.setEditorPref(cmd.key, !editorPrefs[cmd.key]); return;
    case 'settings-b4-convert': store.openB4ConvertSettings(); return; // v589
    case 'compose-stream': // 滑条转连打: 需选中滑条
      if (store.beatmap?.hitObjects.some(o => store.selected.has(o.id) && o.type === 'slider')) store.openConversion('stream');
      return;
    case 'compose-merge': { // 合并滑条: 需 >=2 选中; 无参数直接应用 (computeMerge 不满足条件返回 null 不动作, 同 Inspector onMerge)
      const bm = store.beatmap; if (!bm) return;
      const sel = bm.hitObjects.filter(o => store.selected.has(o.id));
      if (sel.length < 2) return;
      const slider = computeMerge(bm, sel, store.beatSnap);
      if (slider) store.applyConversion(sel.map(o => o.id), [slider]);
      return;
    }
    case 'compose-sym-slider': { // v236: 对称滑条 — 恰好选中 1 个滑条时打开参数窗口 (同 Inspector 入口)
      const bm = store.beatmap; if (!bm || store.selected.size !== 1) return;
      const o = bm.hitObjects.find(x => store.selected.has(x.id));
      if (o?.type === 'slider') store.openConversion('symSlider');
      return;
    }
    case 'compose-convert-b4': store.convertAllBSplineSliders(); return; // v387: B4 全图转贝塞尔 (与右侧栏警告条按钮同一 handler)
    case 'compose-convert-bezier-b4': store.convertAllBezierSlidersToB4(); return; // v464: 反向 — 贝塞尔全图转 B4
    default: return;
  }
}

// 调试暴露 (CDP 验证器用)
if (typeof window !== 'undefined') {
  (window as unknown as { __osuMenuCmd: typeof handleMenuCommand }).__osuMenuCmd = handleMenuCommand;
}
