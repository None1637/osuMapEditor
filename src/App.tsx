import { useEffect, useState, type CSSProperties } from 'react';
// v181: 图标统一用 Lucide (规范: 界面禁用 emoji 图标, 见 AGENTS.md)
import { Volume2, Eye, FolderOpen, Palette, Ruler, Lock, LockOpen, Crosshair, Box, Magnet, Settings2, Package, AudioWaveform, Star, Undo2, Redo2, Grid3x3, MousePointer2, Circle, Spline, Disc, Move, Target } from 'lucide-react';
import { store, useEditor, type Tool } from '@/osu/store';
import { seekByBeats } from '@/osu/seekSnapping';
import { BEAT_SNAP_OPTIONS } from '@/osu/sliderPath'; // v218: 节拍细分配置项 (与滑条长度吸附同一来源)
import { normalizeRotation, rotationPeriod } from '@/osu/gridSnap';
import { createSampleBeatmap, generateDemoAudio } from '@/osu/sampleBeatmap';
import { EditorCanvas } from '@/components/EditorCanvas';
import { TopTimeline, BottomTimeline, SelectionInfoPanel } from '@/components/Timelines';
import { TimingPage } from '@/components/TimingPanel';
import { SetupPage } from '@/components/SetupPage';
import { Inspector } from '@/components/Inspector';
import { StreamDialog } from '@/components/convert/StreamDialog';
import { GeoSnapPanel } from '@/components/GeoSnapPanel';
import { DisplayPanel } from '@/components/DisplayPanel'; // v132: 显示设置面板
import { VolumePanel } from '@/components/VolumePanel'; // v144: 音量设置面板
import { PatternPanel } from '@/components/PatternPanel';
import { TimingPointDialog } from '@/components/TimingPointDialog';
import { PolygonDialog } from '@/components/convert/PolygonDialog';
import { DuplicateDialog } from '@/components/convert/DuplicateDialog';
import { SymSliderDialog } from '@/components/convert/SymSliderDialog'; // v236: 对称滑条
import { SplitDialog } from '@/components/convert/SplitDialog';
import { SongLibrary } from '@/components/SongLibrary';
import { SkinPicker } from '@/components/SkinPicker';
import { applySkinFromDir } from '@/osu/skin';
import { asDirLike, collectSampleFiles, rememberSongsDir, restoreSkinDir, restoreSongsDir } from '@/osu/library';
import { fetchServerDirs, serverDir } from '@/osu/serverFs';
import { applyServerSkin } from '@/osu/serverSkin';
import { getElectronAPI, isElectron } from '@/osu/electronBridge';
import { handleMenuCommand, openServerDifficulty } from '@/osu/electronMenu';
import { computeStarRating } from '@/osu/starRating'; // v167: 谱面星数 (lazer 移植)
import { FirstRunWizard } from '@/components/FirstRunWizard';
import { SkinListPanel } from '@/components/SkinListPanel';
import { UnsavedDialog } from '@/components/UnsavedDialog'; // v120
import { TransformDialog } from '@/components/TransformDialog'; // v209: 旋转/缩放独立窗口
import { FpsCounter } from '@/components/FpsCounter'; // v220: 右下角帧数显示

// v191: 工具按钮文本前加 Lucide 图标
const TOOLS: { id: Tool; label: string; key: string; icon: typeof MousePointer2 }[] = [
  { id: 'select', label: '选择', key: '1', icon: MousePointer2 },
  { id: 'circle', label: '单点', key: '2', icon: Circle },
  { id: 'slider', label: '滑条', key: '3', icon: Spline },
  { id: 'spinner', label: '转盘', key: '4', icon: Disc },
];

// v223: 游玩区平移/缩放数值输入 — 局部文本态 (同 GridSpacingInput): 未聚焦显示 store 值 (中键拖动时实时刷新),
// 聚焦后编辑原文 (可输负号/小数中间态), 仅有限值提交 (scale 钳 0.1..10), 失焦还原
// v224: grow = 平分父行宽度 (x/y 行); 默认固定宽 (开关行的缩放)
function PanNumInput({ label, value, step, min, max, grow, onCommit }: {
  label: string; value: number; step: number; min?: number; max?: number; grow?: boolean; onCommit: (v: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <span className={`flex items-center gap-0.5 ${grow ? 'flex-1 min-w-0' : 'shrink-0'}`}>
      <span className="text-white/50 shrink-0">{label}</span>
      <input type="number" step={step} data-pan-input={label}
        value={text ?? String(value)}
        onFocus={() => setText(String(value))}
        onBlur={() => setText(null)}
        onChange={e => {
          setText(e.target.value);
          let v = parseFloat(e.target.value);
          if (!isFinite(v)) return;
          if (min !== undefined) v = Math.max(min, v);
          if (max !== undefined) v = Math.min(max, v);
          onCommit(v);
        }}
        className={`${grow ? 'flex-1' : 'w-12'} min-w-0 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-right`} />
    </span>
  );
}

// 网格间距输入: 局部文本态, 输入过程中不钳制 (可自由全选输入 10/20), 仅合法值 (lazer 4..256) 提交, 失焦还原
function GridSpacingInput({ disabled }: { disabled: boolean }) {
  const committed = store.gridSpacing ?? store.beatmap?.editor.gridSize ?? 4;
  const [text, setText] = useState<string | null>(null);
  return (
    <input type="number" min={4} max={256} step={1} disabled={disabled} data-grid-input="spacing"
      value={text ?? String(committed)}
      onChange={e => {
        setText(e.target.value);
        const v = parseInt(e.target.value);
        if (store.beatmap && isFinite(v) && v >= 4 && v <= 256) {
          store.gridSpacing = v;
          store.beatmap.editor.gridSize = v; // lazer: GridLineSpacing 写回 editorBeatmap.GridSize
          store.emit();
        }
      }}
      onBlur={() => setText(null)}
      className="w-12 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-right" />
  );
}

// v156: Timing 菜单「整体平移所有物件的时间...」弹窗 (模块级组件 — 组件内定义会随 60fps 重渲染重挂载吞点击, 见 v150)
function ShiftAllDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('0');
  const ms = parseFloat(text);
  const ok = isFinite(ms) && ms !== 0;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={onClose}>
      <div className="w-72 bg-[#16161d] border border-[#333] rounded-lg p-4 flex flex-col gap-3 text-xs text-white/80"
           onClick={e => e.stopPropagation()} data-shiftall-dialog>
        <div className="text-sm font-semibold text-white">整体平移所有物件的时间</div>
        <label className="flex items-center gap-2">
          偏移 (ms)
          <input type="number" step={1} autoFocus value={text} data-shiftall-input
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && ok) { store.timingShiftAll(ms); onClose(); } if (e.key === 'Escape') onClose(); }}
            className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-right" />
        </label>
        <div className="text-white/40">所有物件的 time/endTime 同步平移 (负值前移)。支持撤销 (Ctrl+Z)。</div>
        <div className="flex justify-end gap-2">
          <button className="px-3 py-1 rounded bg-[#2c2c38] hover:bg-[#3c3c4c]" onClick={onClose}>取消</button>
          <button className="px-3 py-1 rounded bg-[#e6437d] hover:bg-[#f0558e] disabled:opacity-40" disabled={!ok}
            onClick={() => { store.timingShiftAll(ms); onClose(); }}>应用</button>
        </div>
      </div>
    </div>
  );
}

// ---- v217: 全局等比缩放 — 参数与 canvas 适配工具在 @/osu/uiZoom (共享) ----
// 窗口变小时四周控件 (页签栏/左右栏/上下时间轴) 与中间游玩区一起等比缩小,
// 不再只挤压中间 flex-1 区域; zoom 为单一系数, X/Y 永远等比不变形,
// 不等比余量仍由 flex-1 中间区吸收 (不留白)。canvas 组件经 zoomRect/zoomClientX/Y
// 在布局空间绘制与命中, 固定 px 内容随整体一致缩放。
import { useUiZoom, textZoomComp } from '@/osu/uiZoom';

export default function App() {
  useEditor();
  const uiZoom = useUiZoom(); // v217
  const fsComp = textZoomComp(); // v225: 文本补偿系数 (resize 时随 useUiZoom 重渲染更新)
  const [tab, setTab] = useState<'edit' | 'setup' | 'timing'>('edit');
  // exe 环境启动即进曲库界面 (点难度后进入编辑器); dev/浏览器调试直进编辑界面
  const [showLibrary, setShowLibrary] = useState(() => isElectron());
  const [showSkin, setShowSkin] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showShiftAll, setShowShiftAll] = useState(false); // v156: Timing 菜单「整体平移所有物件的时间...」
  // 首跑向导完成后自增, 强制重挂载曲库面板 → 用刚保存的配置重新扫描
  // (面板在向导出现前已挂载, 仅靠 setShowLibrary(true) 不会重跑恢复逻辑)
  const [libraryKey, setLibraryKey] = useState(0);

  // Electron: 首跑 (曲库目录未配置) 显示配置向导; 菜单"重新配置"也可再次打开
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    api.getSettings().then(s => { if (s.firstRun) setShowWizard(true); }).catch(() => { });
    api.onOpenSetup(() => setShowWizard(true));
  }, []);

  // 初始加载谱面: exe 优先恢复上次打开的谱面 (recents[0]), 无记录/加载失败回退演示谱面 + 合成音频
  useEffect(() => {
    if (store.beatmap) return;
    (async () => {
      // v94: exe 启动恢复上次谱面; 成功则直进编辑器 (跳过曲库界面)
      const api = getElectronAPI();
      if (api) {
        try {
          const [r] = await api.getRecents();
          if (r && (await openServerDifficulty(r.folderRel, r.file))) {
            setShowLibrary(false);
            return;
          }
        } catch { /* 目录/文件已删等 → 回退演示谱面 */ }
      }
      if (store.beatmap) return; // 恢复等待期间用户已从曲库加载
      const bm = createSampleBeatmap();
      const audioUrl = generateDemoAudio(bm.timingPoints.filter(t => t.uninherited).map(t => ({ time: t.time, beatLength: t.beatLength })));
      store.load(bm, audioUrl);
    })();
  }, []);

  // v167: 谱面星数 — 谱面数据版本 (getDataVersion) 变化后防抖 200ms 异步重算, 避免大谱面阻塞输入;
  //   计算完成前显示上一次结果 (store.starRating), 无谱面时清空
  const dataVersion = store.getDataVersion();
  useEffect(() => {
    if (!store.beatmap) { store.setStarRating(null); return; }
    const timer = setTimeout(() => {
      try {
        store.setStarRating(store.beatmap ? computeStarRating(store.beatmap) : null);
      } catch {
        store.setStarRating(null); // 异常谱面 (坏滑条等) 不阻塞编辑
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [dataVersion]);

  // 启动时恢复曲库/皮肤目录:
  // 优先 local-dirs.json 服务器直读 (免浏览器授权, 完全静默),
  // 未配置则回退 IndexedDB 记忆 (已授权才应用; 未授权等用户在面板里授权)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const server = await fetchServerDirs();
      if (cancelled) return;
      // ---- 曲库目录: 写入会话记忆, 打开曲库面板时走快速通道立即开扫 ----
      if (server?.songsDir) {
        rememberSongsDir(serverDir('songs', '', server.songsName ?? 'Songs'), null);
      } else {
        const r = await restoreSongsDir();
        if (!cancelled && r?.granted) rememberSongsDir(asDirLike(r.handle), r.handle);
      }
      // ---- 皮肤目录 ----
      if (server?.skinDir) {
        await applyServerSkin(server.skinName ?? 'skin');
        return;
      }
      const r = await restoreSkinDir();
      if (cancelled || !r || !r.granted) return;
      const skin = asDirLike(r.handle);
      await applySkinFromDir(skin, r.handle.name).catch(() => { });
      const samples = await collectSampleFiles(skin).catch(() => new Map<string, File>());
      if (samples.size) await store.applySkinSamples(samples).catch(() => 0);
      if (cancelled) return;
      store.emitPlayback();
    })();
    return () => { cancelled = true; };
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (showLibrary || showSkin) return;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); store.togglePlay(); return; }
      // v209: 编辑菜单同款快捷键 — Ctrl+Shift+R/S 必须在 Ctrl+S 之前判定 (原 Ctrl+S 无 shift 守卫)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); store.openTransformDialog('rotate'); return; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); store.openTransformDialog('scale'); return; }
      // v209: Ctrl+Shift+D 多边形生成 (lazer 同款) 之前先判 Ctrl+D 仿制 → 批量复制窗口
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); if (store.selected.size) store.openConversion('duplicate'); return; }
      // v67: Ctrl+S 保存谱面 (lazer Editor Save; 有来源写回原文件, 无来源下载 .osu)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); store.save(); return; }
      // v155: Ctrl+B 当前位置添加书签 (蓝线); Ctrl+Shift+B 删除离当前位置最近的书签 (500ms 阈值)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (e.shiftKey) store.removeBookmarkNear(store.currentTime); else store.addBookmark(store.currentTime);
        return;
      }
      for (const t of TOOLS) if (e.key === t.key) { store.tool = t.id; store.pendingSlider = []; store.pendingSpinner = null; store.emit(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); store.redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { store.copy(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { store.paste(store.currentTime); return; }
      // v209: 编辑菜单同款 — Ctrl+X 剪切 / Ctrl+A 全选物件
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') { e.preventDefault(); store.cut(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); store.selectAllObjects(); return; }
      // 选区变换 (lazer 同款键位, SelectionBox.cs OnKeyDown): Ctrl+G 反转, Ctrl+,/. 旋转 90° (逆/顺), Ctrl+H 水平镜像, Ctrl+J 垂直镜像
      // v192: 快捷键旋转/镜像始终围绕游玩区中心 (256,192) — 对齐 osu!stable; Inspector 面板按钮仍用界面选的原点
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); store.reverseSelected(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); store.rotateSelected(-90, 'playfield'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); store.rotateSelected(90, 'playfield'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') { e.preventDefault(); store.flipSelected('h', 'playfield'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); store.flipSelected('v', 'playfield'); return; }
      // v64: Ctrl+Shift+D 多边形生成 (lazer 同款快捷键)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); store.openConversion('polygon'); return; }
      // hitsound / newCombo 切换 (lazer/stable 同款, 作用于全部选中物件): Q newCombo, W whistle, E finish, R clap
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        // v213: 时间轴选中了滑条节点 (折返点/尾) 时, W/E/R 只作用于选中节点 (stable per-edge 音效)
        const hs = store.selectedEdges.size > 0 ? (b: number) => store.toggleEdgeHitSound(b) : (b: number) => store.toggleSelectedHitSound(b);
        if (k === 'q') { store.toggleSelectedNewCombo(); return; }
        if (k === 'w') { hs(2); return; }
        if (k === 'e') { hs(4); return; }
        if (k === 'r') { hs(8); return; }
        // v32: J/K 选中物件前移/后移一个当前节拍吸附; v209: 逻辑下沉 store.nudgeSelectedBySnap (编辑菜单 前移/后移 共用)
        if (k === 'j' || k === 'k') {
          store.nudgeSelectedBySnap(k === 'j' ? -1 : 1);
          return;
        }
        // v153: V 跳转到最后一个物件的时间位置 (取最大 time, 不假定 hitObjects 有序)
        if (k === 'v') {
          const bm = store.beatmap; if (!bm || bm.hitObjects.length === 0) return;
          store.seek(Math.max(...bm.hitObjects.map(o => o.time)));
          return;
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { store.deleteSelected(); return; }
      if (e.key === 'Escape') {
        // v117: 节点选区优先退出 (Esc 退出节点层, 再按才清物件选区)
        if (store.selectedNodes.size) { store.clearNodeSelection(); return; }
        store.pendingSlider = []; store.pendingSpinner = null; store.clearSelection(); store.emit(); return; // v180: 一并取消转盘放置
      }
      // v55: Ctrl+方向键 逐 px 移动选中物件 (stable 同款; 有选区时优先, 无选区时 Ctrl+左右仍是跳前/后物件)
      if ((e.ctrlKey || e.metaKey) && store.selected.size) {
        const v = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
        if (v) { e.preventDefault(); store.nudgeSelectedPosition(v[0], v[1]); return; }
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const bm = store.beatmap; if (!bm) return;
        store.pause();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.ctrlKey) { // 跳到前/后一个物件
          const times = bm.hitObjects.map(o => o.time).sort((a, b) => a - b);
          const t = dir < 0 ? [...times].reverse().find(x => x < store.currentTime - 1) : times.find(x => x > store.currentTime + 1);
          if (t !== undefined) store.seek(t);
        } else {
          // v45: 对齐 lazer EditorClock.seek — 按当前节拍吸附步进并落回节拍网格 (Shift = 4 拍)
          store.seek(seekByBeats(bm.timingPoints, store.beatSnap, store.currentTime, dir, e.shiftKey ? 4 : 1));
        }
        return;
      }
      // v158: ↑/↓ 跳到前/后一条书签 (蓝线, [Editor] Bookmarks)
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const bm = store.beatmap; if (!bm) return;
        const marks = [...bm.editor.bookmarks].sort((a, b) => a - b);
        if (!marks.length) return;
        e.preventDefault();
        const t = e.key === 'ArrowUp'
          ? [...marks].reverse().find(b => b < store.currentTime - 1)
          : marks.find(b => b > store.currentTime + 1);
        if (t !== undefined) store.seek(t);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showLibrary, showSkin]);

  // v77: Electron 原生 "文件" 菜单命令 (保存/打开难度); 非 Electron 无操作
  useEffect(() => {
    const ed = getElectronAPI();
    if (!ed) return;
    return ed.onMenuCommand(async (cmd) => {
      // v156: Timing 菜单 — 页签跳转/平移弹窗在 App 层处理, 其余命令走 handleMenuCommand
      if (cmd.type === 'timing-open-settings') { setTab('timing'); return; }
      if (cmd.type === 'timing-shift-all') { setShowShiftAll(true); return; }
      if (cmd.type === 'open-backups') { void store.openBackupFolder(); return; } // v185: 文件菜单「查看备份」
      await handleMenuCommand(cmd);
      if (cmd.type === 'open') setShowLibrary(false);
    });
  }, []);

  // v185: 每 10 分钟自动备份一次 (仅 Electron 生效; 内容与上次备份相同由主进程改名为最新时间去重)
  useEffect(() => {
    const t = setInterval(() => { void store.backupNow('auto'); }, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // v156: Timing 菜单勾选状态上报 (节拍类型 radio = 当前生效红线拍号, 节拍器 checkbox; 值变化才发)
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    let last = '';
    const report = () => {
      const key = `${store.timingMeterAtCurrent()}|${store.metronome}`;
      if (key === last) return;
      last = key;
      api.menuTimingState({ meter: store.timingMeterAtCurrent(), metronome: store.metronome });
    };
    report();
    return store.subscribe(report);
  }, []);

  // v209: 编辑菜单置灰状态上报 (有谱面/有选中/剪贴板有内容; 值变化才发, 主进程据此重建菜单)
  // v212: 扩 hasSlider/selMulti (作图菜单「滑条转连打」「合并滑条」置灰用)
  // v236: 扩 selSingleSlider (作图菜单「对称滑条」置灰用 — 恰好选中 1 个滑条)
  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    let last = '';
    const report = () => {
      const bm = store.beatmap;
      const selCount = store.selected.size;
      const s = {
        hasMap: !!bm,
        hasSelection: selCount > 0,
        hasClipboard: store.hasClipboard(),
        hasSlider: !!bm && bm.hitObjects.some(o => store.selected.has(o.id) && o.type === 'slider'),
        selMulti: selCount >= 2,
        selSingleSlider: selCount === 1 && !!bm && bm.hitObjects.some(o => store.selected.has(o.id) && o.type === 'slider'),
      };
      const key = `${s.hasMap}|${s.hasSelection}|${s.hasClipboard}|${s.hasSlider}|${s.selMulti}|${s.selSingleSlider}`;
      if (key === last) return;
      last = key;
      api.menuEditState(s);
    };
    report();
    return store.subscribe(report);
  }, []);

  // v120: 未保存改动 — Electron 关窗被主进程拦下后弹保存/废弃提示; 浏览器/标签页关闭走 beforeunload 原生提示
  useEffect(() => {
    const ed = getElectronAPI();
    if (ed) return ed.onCloseRequest(() => { store.guardUnsaved(() => ed.confirmClose()); });
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // v141: 废弃「拖文件进窗口打开谱面」(.osz/.osu/补音频背景 + 拖放遮罩) — 用不到; 开谱面走曲库/菜单
  const bm = store.beatmap;

  return (
    // v217: 外层撑满窗口不缩放; 内层布局尺寸 = 视口/zoom, 经 zoom 缩放后恰好填满窗口
    <div className="h-screen w-screen overflow-hidden bg-[#0d0d12] text-white relative">
    <div
      className="ui-zoom-root flex flex-col overflow-hidden relative"
      style={{ zoom: uiZoom, width: `${100 / uiZoom}vw`, height: `${100 / uiZoom}vh`, '--fs-comp': fsComp } as CSSProperties}
    >
      {/* v127: 原 h-12 顶部标题行 (粉色加粗标题文字) 已删除 — 无实际功能 */}

      {/* 页签栏 (stable 风格大页签: compose / timing / song setup) */}
      <div className="flex items-stretch gap-1 px-3 bg-[#101016] border-b border-white/10 shrink-0">
        {([['edit', 'compose'], ['timing', 'timing']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-7 py-2 text-lg tracking-wide transition-colors ${tab === id ? 'bg-[#2563eb] text-white font-bold rounded-t-md mt-1' : 'text-white/45 hover:text-white/80'}`}>
            {label}
          </button>
        ))}
        <button onClick={() => setTab('setup')}
          className={`px-7 py-2 text-lg tracking-wide transition-colors ${tab === 'setup' ? 'bg-[#2563eb] text-white font-bold rounded-t-md mt-1' : 'text-white/45 hover:text-white/80'}`}>
          song setup
        </button>
        {/* v184: 谱面信息从游玩区左下角移到页签栏 — v186: song setup 在谱面信息左边, flex-1 居中尽量靠窗口中间 (所有页签可见);
            仍分两个 Label: 左 = 名称 (艺术家-歌曲名[难度名], 未保存指示器/保存反馈随行), 右 = 谱面数据 (CS/AR/物件数/★星数);
            (原 v111 左下角 / v124 未保存指示器 / v169 两段拆分, 位置属性 data-dirty-indicator/data-save-message 不变) */}
        {bm && (
          <div className="flex-1 flex items-center justify-center gap-2 min-w-0 pointer-events-none">
            <div className={`text-xs bg-black/60 rounded px-2 py-1 truncate min-w-0 max-w-[28rem] ${store.saveMessage ? (store.saveMessage.startsWith('保存失败') ? 'text-red-400' : 'text-emerald-400') : 'text-white/50'}`}
              {...(store.saveMessage ? { 'data-save-message': store.saveMessage } : {})}>
              {store.dirty && <b className="text-white/90" data-dirty-indicator>[<span className="inline-block w-2 h-2 rounded-full bg-white/90 align-middle" /> 未保存] </b>}
              {store.saveMessage && <b>[{store.saveMessage.split(':')[0]}] </b>}
              {bm.metadata.artist} - {bm.metadata.title} [{bm.metadata.version}]
            </div>
            <div className="text-xs bg-black/60 rounded px-2 py-1 text-white/50 whitespace-nowrap shrink-0">
              CS{bm.difficulty.cs} AR{bm.difficulty.ar} · {bm.hitObjects.length} 物件
              {store.starRating !== null && <> · <Star className="inline w-3 h-3 -mt-0.5 fill-current" />{store.starRating.toFixed(2)}</>}{/* v167: 星数 (lazer 移植, 防抖异步重算); v181: ★→lucide Star */}
            </div>
          </div>
        )}
        {!bm && <div className="flex-1" />}
        {/* v132: 显示设置 — 页签栏右侧按钮 (皮肤颜色/滑条轨迹线/缩圈/滑条渐出/点击特效) */}
        {/* v144: 音量设置 — 显示设置左侧按钮 (主音量/歌曲音量/音效音量) */}
        <button onClick={() => store.setVolumePanelOpen(!store.volumePanelOpen)}
          data-volume-panel-btn
          className={`self-center px-3 py-1 rounded text-sm transition-colors ${store.volumePanelOpen ? 'bg-red-500/40 border border-red-400/50' : 'bg-white/10 hover:bg-white/20'}`}
          title="音量设置: 主音量 / 歌曲音量 / 音效音量">
          <Volume2 className="inline-block w-4 h-4 mr-1 -mt-0.5" />音量
        </button>
        <button onClick={() => store.setDisplayPanelOpen(!store.displayPanelOpen)}
          data-display-panel-btn
          className={`self-center px-3 py-1 rounded text-sm transition-colors ${store.displayPanelOpen ? 'bg-red-500/40 border border-red-400/50' : 'bg-white/10 hover:bg-white/20'}`}
          title="显示设置: 皮肤颜色 / 滑条轨迹线 / 缩圈 / 滑条渐出 / note 点击特效 开关">
          <Eye className="inline-block w-4 h-4 mr-1 -mt-0.5" />显示设置
        </button>
      </div>

      {/* v129: 主区 = 相对容器 — edit 页签时 EditorCanvas 铺满底层 (absolute inset-0 z-0),
          上/下时间轴与左右侧栏改半透明浮层 (z-10), 能看到背后游玩的物件;
          浮层列整体 pointer-events-none, 各面板 pointer-events-auto (中央空隙点击直达画布);
          游玩区在画布内预留: 上 93+18=111px / 下 82+10=92px (见 EditorCanvas viewTransform v129; 面板行高改动需同步) */}
      <div className="flex-1 relative min-h-0">
        {tab === 'edit' && (
          <div className="absolute inset-0 z-0"><EditorCanvas /></div>
        )}
        <div className="absolute inset-0 z-10 flex flex-col pointer-events-none">
      {/* 上方大时间轴(附近物件) + 右上角选区间距信息 (v45: 同行; v70: 全部页签显示, 原 UI 排在其下; v129: 半透明浮层) */}
      <div className="shrink-0 border-b border-white/10 flex items-stretch pointer-events-auto">
        {/* v127: WaveformPanel 悬浮窗已废弃 — 波形/频谱默认画在 TopTimeline 背景 (右侧按钮切模式/层级) */}
        <div className="flex-1 min-w-0 relative">
          <TopTimeline />
        </div>
        <SelectionInfoPanel />
      </div>

      {/* v108: 左侧栏 — 原工具栏从「曲库」到「重做」的全部控件 (控件略放大, 功能组间分隔线);
          v109: 层级移到主区域行 (上时间轴之下/下时间轴之上, 与右侧 Inspector 同级), 宽度与右栏一致 w-56;
          v129: 背景半透明 /75 (能看到背后游玩的物件) + pointer-events-auto (浮层列整体 none) */}
      <div className="flex-1 flex min-h-0">
        {/* 左侧栏 */}
        <div className="w-56 shrink-0 bg-[#16161d]/75 border-r border-white/10 overflow-y-auto flex flex-col gap-1.5 px-2 py-2 text-sm pointer-events-auto">
          {/* 文件 (v151: 曲库/皮肤各半宽, 并排一行) */}
          <div className="flex gap-1.5">
            <button onClick={() => setShowLibrary(true)} className="flex-1 min-w-0 text-left px-3 py-1.5 rounded bg-pink-500/30 border border-pink-400/40 hover:bg-pink-500/50" title="浏览 osu! Songs 目录, 选择歌曲与难度"><FolderOpen className="inline-block w-4 h-4 mr-1 -mt-0.5" />曲库</button>
            <button onClick={() => setShowSkin(true)} className="flex-1 min-w-0 text-left px-3 py-1.5 rounded bg-white/10 hover:bg-white/20" title="选择 osu! 皮肤文件夹 (贴图 + hitsound), 会记住选择"><Palette className="inline-block w-4 h-4 mr-1 -mt-0.5" />皮肤</button>
          </div>
          {/* v81: 旧「打开文件」「导出」按钮已删除 (无用: 打开走曲库/拖拽, 保存走 Ctrl+S) */}
          <div className="h-px bg-white/15 mx-1 my-0.5" />
          {/* 工具 (v151: 常用按钮放大 — 一行一个, 整行宽) */}
          <div className="flex flex-col gap-1.5">
            {TOOLS.map(t => (
              <button key={t.id}
                onClick={() => { store.tool = t.id; store.pendingSlider = []; store.pendingSpinner = null; store.emit(); }}
                className={`w-full text-left px-3 py-1.5 rounded ${store.tool === t.id ? 'bg-pink-500 font-bold' : 'bg-white/10 hover:bg-white/20'}`}>
                <t.icon className="inline-block w-4 h-4 mr-1.5 -mt-0.5" />{t.label} <span className="opacity-50 text-xs">{t.key}</span>
              </button>
            ))}
          </div>
          <div className="h-px bg-white/15 mx-1 my-0.5" />
          {/* 节拍吸附 */}
          <label className="flex items-center gap-1.5 text-sm text-white/70 px-1">
            节拍吸附 1/
            <select value={store.beatSnap} onChange={e => { store.beatSnap = parseInt(e.target.value); store.emit(); }}
              className="bg-black/40 border border-white/15 rounded px-1.5 py-1">
              {BEAT_SNAP_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="h-px bg-white/15 mx-1 my-0.5" />
          {/* 锁定间距 */}
          <button onClick={() => { store.distanceLock = !store.distanceLock; store.emit(); }}
            className={`w-full text-left px-3 py-1.5 rounded ${store.distanceLock ? 'bg-cyan-500/40 border border-cyan-400/50' : 'bg-white/10 hover:bg-white/20'}`}
            title="锁定间距 (DistanceSpacing): 新物件与上个物件保持固定距离">
            <Ruler className="inline-block w-4 h-4 mr-1 -mt-0.5" />锁定间距
          </button>
          {/* v45: 锁定间距倍率控制 (DistanceSpacing), 与右上角 Prev/Next 同单位; v149: 上限 10x, 滑条拉满控件宽度 */}
          <label className="w-full flex items-center gap-1.5 text-sm text-white/70 px-1" title="锁定间距倍率 (DistanceSpacing): 1x = 滑条球每拍行进距离 = 100×SliderMultiplier×当前SV px (lazer 同款, 随 SV 变化)">
            <input type="range" min={0.1} max={10} step={0.05} disabled={!bm} data-ds-input="range"
              value={bm?.editor.distanceSpacing ?? 1}
              onChange={e => { if (store.beatmap) { store.beatmap.editor.distanceSpacing = parseFloat(e.target.value); store.emit(); } }}
              className="flex-1 min-w-0 accent-cyan-400" />
            <input type="number" min={0.1} max={10} step={0.05} disabled={!bm} data-ds-input="number"
              value={bm ? Math.round(bm.editor.distanceSpacing * 100) / 100 : 1}
              onChange={e => {
                const v = parseFloat(e.target.value);
                if (store.beatmap && isFinite(v)) { store.beatmap.editor.distanceSpacing = Math.max(0.1, Math.min(10, v)); store.emit(); }
              }}
              className="w-14 shrink-0 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-right" />
            <span className="shrink-0">x</span>
          </label>
          {/* v115: 锁定物件 (stable 「编辑 > Lock Notes」): 开启后无法移动/修改/删除任何已有物件; 放置新物件/粘贴/绿线编辑不受影响 */}
          <button onClick={() => { store.lockNotes = !store.lockNotes; store.emitSelection(); }}
            data-lock-notes="toggle"
            className={`w-full text-left px-3 py-1.5 rounded ${store.lockNotes ? 'bg-amber-500/40 border border-amber-400/50' : 'bg-white/10 hover:bg-white/20'}`}
            title="锁定物件 (Lock Notes): 开启后无法移动/修改/删除任何物件; 放置新物件、绿线编辑不受影响">
            {store.lockNotes
              ? <Lock className="inline-block w-4 h-4 mr-1 -mt-0.5" />
              : <LockOpen className="inline-block w-4 h-4 mr-1 -mt-0.5" />}锁定物件
          </button>
          <div className="h-px bg-white/15 mx-1 my-0.5" />
          {/* v223: 游玩区平移/缩放 — 开启后按住鼠标中键拖动游玩区域; x/y/缩放输入框实时显示并可设定 (视图辅助, 不入谱面)
              v224: 开关半宽 + 缩放同行 (放按钮后); x/y 两个输入框平分下一行 */}
          <div className="flex items-center gap-1.5">
            <button onClick={() => { store.playfieldPanEnabled = !store.playfieldPanEnabled; store.emit(); }}
              data-pan-input="toggle"
              className={`flex-1 min-w-0 text-left px-3 py-1.5 rounded ${store.playfieldPanEnabled ? 'bg-cyan-500/40 border border-cyan-400/50' : 'bg-white/10 hover:bg-white/20'}`}
              title="游玩区平移: 开启后按住鼠标中键拖动游玩区域; x/y = 偏移 (osu px), 缩放 = 倍率 (默认 1.0); 关闭后恢复默认视图 (已设值保留)">
              <Move className="inline-block w-4 h-4 mr-1 -mt-0.5" />游玩区平移
            </button>
            <PanNumInput label="缩放" value={Math.round(store.playfieldScale * 100) / 100} step={0.1} min={0.1} max={10}
              onCommit={v => { store.playfieldScale = v; store.emit(); }} />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-white/70 px-1">
            <PanNumInput label="x" grow value={Math.round(store.playfieldPanX * 10) / 10} step={1}
              onCommit={v => { store.playfieldPanX = v; store.emit(); }} />
            <PanNumInput label="y" grow value={Math.round(store.playfieldPanY * 10) / 10} step={1}
              onCommit={v => { store.playfieldPanY = v; store.emit(); }} />
          </div>
          <div className="h-px bg-white/15 mx-1 my-0.5" />
          {/* v56: 网格吸附 (lazer OsuGridToolboxGroup): 开关 + 类型 + 间距 (写回 GridSize) + 旋转 (圆形禁用);
              v151: 吸附开关与类型下拉各半宽放一行; 间距与旋转放一行 */}
          <div className="flex gap-1.5">
            <button onClick={() => { store.gridSnap = !store.gridSnap; store.emit(); }}
              className={`flex-1 min-w-0 text-left px-3 py-1.5 rounded ${store.gridSnap ? 'bg-cyan-500/40 border border-cyan-400/50' : 'bg-white/10 hover:bg-white/20'}`}
              title="网格吸附 (Grid Snap): 放置/拖拽吸附到位置网格 (优先级: 物件吸附 > 锁定间距 > 网格)">
              <Grid3x3 className="inline-block w-4 h-4 mr-1 -mt-0.5" />网格吸附
            </button>
            <select value={store.gridType} data-grid-input="type"
              onChange={e => {
                store.gridType = e.target.value as 'square' | 'triangle' | 'circle' | 'none'; // v119: none = 无网格
                const period = rotationPeriod(store.gridType); // lazer: 切换类型按周期归一旋转 (正方形 ±45, 三角形 ±30)
                if (period !== null) store.gridRotation = normalizeRotation(store.gridRotation, period);
                store.emit();
              }}
              className="flex-1 min-w-0 bg-black/40 border border-white/15 rounded px-1.5 py-1 text-sm" title="网格类型 (lazer PositionSnapGridType; v119: 无网格 = 显示/吸附全关, 贴近游玩表现)">
              <option value="square">正方形</option>
              <option value="triangle">三角形</option>
              <option value="circle">圆形</option>
              <option value="none">无网格</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-white/70 px-1">
            <span className="flex items-center gap-1" title="网格间距 (lazer GridLineSpacing 4..256, 写回 [Editor] GridSize)">
              间距 <GridSpacingInput disabled={!bm} /> px
            </span>
            <span className="flex-1" />
            <span className="flex items-center gap-1" title="网格旋转 (度; 圆形禁用 — lazer GridLinesRotation.Disabled)">
              旋转
              <input type="number" step={1} disabled={!bm || store.gridType === 'circle' || store.gridType === 'none'} data-grid-input="rotation"
                value={Math.round(store.gridRotation * 10) / 10}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  if (isFinite(v)) { store.gridRotation = Math.max(-180, Math.min(180, v)); store.emit(); }
                }}
                className="w-14 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-right disabled:opacity-30" />
              °
            </span>
          </div>
          {/* v78: 自定义网格中心 (lazer StartPositionX/Y 可配): 开关 + x/y 输入; 画布上青色标记可拖拽 */}
          <button onClick={() => store.setGridOriginCustom(!store.gridOriginCustom)} disabled={!bm}
            data-grid-input="origin-toggle"
            className={`w-full text-left px-3 py-1.5 rounded disabled:opacity-30 ${store.gridOriginCustom ? 'bg-cyan-500/40 border border-cyan-400/50' : 'bg-white/10 hover:bg-white/20'}`}
            title="自定义网格中心: 开启后网格/吸附以指定点为原点 (默认游玩区中心); 画布上的青色标记可拖拽">
            <Crosshair className="inline-block w-4 h-4 mr-1 -mt-0.5" />网格中心
          </button>
          {store.gridOriginCustom && (
            <label className="flex items-center gap-1.5 text-sm text-white/70 px-1" title="网格中心坐标 (osu 像素; 画布拖拽标记同步)">
              <input type="number" step={1} data-grid-input="origin-x" value={store.gridOrigin.x}
                onChange={e => { const v = parseFloat(e.target.value); if (isFinite(v)) store.setGridOrigin({ x: v, y: store.gridOrigin.y }); }}
                className="w-14 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-right" />
              <input type="number" step={1} data-grid-input="origin-y" value={store.gridOrigin.y}
                onChange={e => { const v = parseFloat(e.target.value); if (isFinite(v)) store.setGridOrigin({ x: store.gridOrigin.x, y: v }); }}
                className="w-14 bg-black/40 border border-white/15 rounded px-1 py-0.5 text-right" />
            </label>
          )}
          {/* v235: 吸附到物件总开关 (默认开) — 控制放置/拖拽/节点拖拽的物件中心·滑条尾吸附 + 几何辅助/间距辅助线吸附 */}
          <button onClick={() => store.setObjectSnapEnabled(!store.objectSnapEnabled)} disabled={!bm}
            data-grid-input="object-snap-toggle"
            className={`w-full text-left px-3 py-1.5 rounded disabled:opacity-30 ${store.objectSnapEnabled ? 'bg-cyan-500/40 border border-cyan-400/50' : 'bg-white/10 hover:bg-white/20'}`}
            title="吸附到物件: 放置/拖动时吸附到其他物件的中心与滑条尾 (含几何辅助/间距辅助线吸附); 关闭后只吃网格吸附 (默认开)">
            <Target className="inline-block w-4 h-4 mr-1 -mt-0.5" />吸附到物件
          </button>
          {/* v163: 限制物件在游玩区域内 (默认开 = 既有行为); 关闭后可拖动/放置物件到游玩区外 */}
          <button onClick={() => store.setLimitToPlayfield(!store.limitToPlayfield)} disabled={!bm}
            data-grid-input="limit-playfield"
            className={`w-full text-left px-3 py-1.5 rounded disabled:opacity-30 ${store.limitToPlayfield ? 'bg-cyan-500/40 border border-cyan-400/50' : 'bg-white/10 hover:bg-white/20'}`}
            title="限制物件在游玩区域内: 开启时放置/拖动物件不会超出游玩区 (默认开); 关闭后可摆到游玩区外 (摆形状用)">
            <Box className="inline-block w-4 h-4 mr-1 -mt-0.5" />限制物件在游玩区内
          </button>
          <div className="h-px bg-white/15 mx-1 my-0.5" />
          {/* v84/v90: 辅助线 — 按钮 = 显示/隐藏总开关 (高亮=开); 旁「辅助线配置」开面板 (圆心点/三点圆/直线延伸线 + 显示范围) */}
          <button onClick={() => store.setGeoEnabled(!store.geoEnabled)} disabled={!bm}
            data-geo-input="toggle"
            className={`w-full text-left px-3 py-1.5 rounded disabled:opacity-30 ${store.geoEnabled ? 'bg-red-500/40 border border-red-400/50' : 'bg-white/10 hover:bg-white/20'}`}
            title="辅助线: 显示/隐藏辅助点线 (选中滑条的圆心/三点圆/直线延伸线, 放置与拖拽可吸附)">
            <Magnet className="inline-block w-4 h-4 mr-1 -mt-0.5" />辅助线
          </button>
          <button onClick={() => store.setGeoPanelOpen(!store.geoPanelOpen)} disabled={!bm}
            data-geo-input="panel-toggle"
            className={`w-full text-left px-3 py-1.5 rounded disabled:opacity-30 ${store.geoPanelOpen ? 'bg-red-500/40 border border-red-400/50' : 'bg-white/10 hover:bg-white/20'}`}
            title="辅助线配置: 三种辅助图形开关 + 显示范围">
            <Settings2 className="inline-block w-4 h-4 mr-1 -mt-0.5" />辅助线配置
          </button>
          <div className="h-px bg-white/15 mx-1 my-0.5" />
          {/* v86: pattern 库 — 收藏选中物件为 pattern, 缩略图拖到游玩区落盘 (节拍时序, 跨 BPM 保结构) */}
          <button onClick={() => { store.loadPatternsIfNeeded(); store.setPatternPanelOpen(!store.patternPanelOpen); }} disabled={!bm}
            data-pattern-input="panel-toggle"
            className={`w-full text-left px-3 py-1.5 rounded disabled:opacity-30 ${store.patternPanelOpen ? 'bg-red-500/40 border border-red-400/50' : 'bg-white/10 hover:bg-white/20'}`}
            title="pattern 库: 收藏选中物件, 从窗口拖到游玩区放置 (按节拍间隔记录, 支持 SV/缩放对齐)">
            <Package className="inline-block w-4 h-4 mr-1 -mt-0.5" />pattern
          </button>
          {/* v127: 波形/频谱显示开关 — 画在上方时间轴 (默认背景层, 时间轴右侧按钮切模式/层级); 原悬浮窗 (v103) 已废弃 */}
          <button onClick={() => store.setWavePanelOpen(!store.wavePanelOpen)} disabled={!bm}
            data-wave-input="toggle"
            className={`w-full text-left px-3 py-1.5 rounded disabled:opacity-30 ${store.wavePanelOpen ? 'bg-emerald-500/40 border border-emerald-400/50' : 'bg-white/10 hover:bg-white/20'}`}
            title="波形: 在上方时间轴显示音频波形图/频谱图 (时间轴右侧按钮切换波形/频谱与背景/上层)">
            <AudioWaveform className="inline-block w-4 h-4 mr-1 -mt-0.5" />波形
          </button>
          <div className="h-px bg-white/15 mx-1 my-0.5" />
          {/* 历史 */}
          <div className="flex gap-1.5">
            <button onClick={() => store.undo()} disabled={!store.canUndo} className="flex-1 px-2 py-1.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30" title="Ctrl+Z"><Undo2 className="inline-block w-4 h-4 mr-1 -mt-0.5" />撤销</button>
            <button onClick={() => store.redo()} disabled={!store.canRedo} className="flex-1 px-2 py-1.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30" title="Ctrl+Y"><Redo2 className="inline-block w-4 h-4 mr-1 -mt-0.5" />重做</button>
          </div>
        </div>

      {tab === 'edit' ? (
        <>
          {/* 主区域 (v129: EditorCanvas 移到底层 absolute inset-0, 此处只留浮层提示) */}
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 min-w-0 relative">
              {store.tool === 'slider' && (
                <div className="absolute top-2 left-2 text-xs bg-black/60 rounded px-2 py-1 text-white/80 pointer-events-none">
                  点击放置锚点 · Ctrl+点击=红锚点 · 双击/右键完成滑条 · Esc取消
                </div>
              )}
              {/* v184: 谱面信息已移到页签栏 (song setup 左侧居中), 此处不再渲染 */}
            </div>
            {/* 右侧检查器 (v129: 背景半透明 /75 + pointer-events-auto) */}
            <div className="w-56 shrink-0 bg-[#16161d]/75 border-l border-white/10 overflow-auto pointer-events-auto">
              <Inspector />
              <div className="p-3 text-xs text-white/40 space-y-1 border-t border-white/10">
                <div className="font-bold text-white/60">快捷键</div>
                <div>空格 播放/暂停</div>
                <div>1-4 切换工具</div>
                <div>Ctrl+C/V 复制/粘贴</div>
                <div>Ctrl+Z/Y 撤销/重做</div>
                <div>Ctrl+S 保存谱面</div>
                <div>Ctrl+B 添加书签 · Ctrl+Shift+B 删除书签</div>
                <div>↑/↓ 跳到前/后一条书签</div>
                <div>Del 删除所选</div>
                <div>空白处拖拽 框选 (Shift 追加)</div>
                <div>Ctrl+点击物件 添加/移除选中</div>
                <div>Ctrl+G 反转选区 (时间镜像+路径反向)</div>
                <div>Ctrl+,/. 旋转90° (逆/顺时针, 游玩区中心)</div>
                <div>Ctrl+H/J 水平/垂直镜像 (游玩区中心)</div>
                <div>Q/W/E/R 新Combo/Whistle/Finish/Clap</div>
                <div>J/K 选中物件前移/后移一个吸附</div>
                <div>V 跳到最后一个物件</div>
                <div>滚轮 按节拍移动时间</div>
                <div>←/→ 按节拍移动时间 (Shift 4拍)</div>
                <div>Ctrl+←/→ 跳到上/下个物件</div>
                <div>选中滑条后可拖拽白色节点编辑形状</div>
              </div>
            </div>
          </div>
        </>
      ) : tab === 'setup' ? (
        <div className="flex-1 min-w-0 overflow-auto flex flex-col pointer-events-auto"><SetupPage /></div>
      ) : (
        <div className="flex-1 min-w-0 overflow-auto flex flex-col pointer-events-auto"><TimingPage /></div>
      )}
      </div>{/* /主区域行 (左侧栏 + 内容; v109: 上时间轴之下/下时间轴之上) */}

      {/* 下方全局时间轴 + 播放控制(两个页签都显示; v129: 半透明浮层) */}
      <div className="shrink-0 border-t-2 border-white/15 pointer-events-auto">
        <BottomTimeline />
      </div>
        </div>{/* /v129 浮层列 */}
      </div>{/* /v129 主区相对容器 */}

      {showLibrary && <SongLibrary key={libraryKey} onClose={() => setShowLibrary(false)} />}
      {showSkin && (isElectron()
        ? <SkinListPanel onClose={() => setShowSkin(false)} />
        : <SkinPicker onClose={() => setShowSkin(false)} />)}
      {showWizard && <FirstRunWizard onDone={() => { setShowWizard(false); setLibraryKey(k => k + 1); setShowLibrary(true); }} />}
      {store.conversionDialog === 'stream' && <StreamDialog />}
      {store.geoPanelOpen && <GeoSnapPanel />}
      {store.displayPanelOpen && <DisplayPanel />}
      {store.volumePanelOpen && <VolumePanel />}{/* v144: 音量设置面板 */}
      {store.patternPanelOpen && <PatternPanel />}
      {store.conversionDialog === 'split' && <SplitDialog />}
      {store.conversionDialog === 'polygon' && <PolygonDialog />}
      {store.conversionDialog === 'duplicate' && <DuplicateDialog />}
      {store.conversionDialog === 'symSlider' && <SymSliderDialog />}{/* v236: 对称滑条 */}
      {store.timingPointDialog && <TimingPointDialog />}
      {store.transformDialog && <TransformDialog mode={store.transformDialog} />}{/* v209: 旋转/缩放独立窗口 (编辑菜单 / Ctrl+Shift+R/S) */}
      {showShiftAll && <ShiftAllDialog onClose={() => setShowShiftAll(false)} />}{/* v156 */}
      {/* v120: 未保存改动提示 (z 层级最高, 盖住曲库等弹窗) */}
      <UnsavedDialog />
    </div>
    {/* v220: 右下角帧数显示 — 悬浮于所有控件之上; 挂在 v217 zoom 容器外, 不随界面缩放 */}
    <FpsCounter />
    </div>
  );
}
