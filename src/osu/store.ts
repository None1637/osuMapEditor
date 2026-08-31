// 编辑器核心状态: 谱面数据 + 撤销/重做 + 剪贴板 + 选择 + 音频时钟
import { useSyncExternalStore } from 'react';
import type { Beatmap, HitObject, TimingPoint } from './parser';
import { genId, timingAt, serializeOsu } from './parser';
import { invalidatePath } from './renderer';
import { selectionCenter, rotateObjects, flipObjects, scaleObjects, reflectObjectsAcrossLine, type Pt } from './transform';
import { reverseSelection } from './reverse';
import { GRID_ORIGIN } from './gridSnap';
import { AudioClock } from './clock/AudioClock';
import { HitSoundScheduler, type HitSoundEvent } from './clock/HitSoundScheduler';
import { createTempoNode, type TempoNode } from './clock/tempoWorklet';
import { parseHitSample, setNumFromGeneral, soundsForHitSound, stemCandidates, planSliderSounds, objectVolume, buildHitSampleRaw, hitSampleFilename, DEFAULT_SAMPLE_STEMS, DEFAULT_SLIDER_STEMS, type SliderSoundPlan, type HitSample } from './clock/hitSounds';
import { SAMPLE_CONCURRENCY, VoiceLimiter } from './clock/voiceLimiter';
import { saveBeatmap, mapFileName, type MapSource, type SaveOutcome } from './saveMap';
import { DEFAULT_GROUP, instantiatePattern, loadPatternGroups, loadPatterns, makePattern, newPatternId, savePatternGroups, savePatterns, type StoredPattern } from './patternLibrary';
import { reportMenuState, reportDirtyState } from './electronMenu';
import { getElectronAPI } from './electronBridge'; // v185: 谱面备份 IPC
import { defaultNewPoint, effectivePointAt, activePointAt, snapTimeToRedBeat, metronomeBeats } from './timingEdit'; // v156
import { resnapSliderLength } from './sliderPath'; // v156: 重新计算滑条长度
import { setDisplayFlag as applyDisplayFlag, setDisplayNumber as applyDisplayNumber, setDisplayString as applyDisplayString, type BoolDisplayKey, type DisplaySettings, type StrDisplayKey } from './displaySettings'; // v132: 显示设置
import { setVolume as applyVolume, musicGain, effectsGain, type VolumeSettings } from './volumeSettings'; // v144: 音量设置
import { dirtyFingerprint } from './dirtyFingerprint'; // v140: 脏标记内容指纹
import { seekByBeats, wheelSteps, playingWheelStepMs, type WheelAccum } from './seekSnapping'; // v193: 滚轮 seek
import { beginLifecycleFrame } from './lifecycle'; // v197: 每帧推进滑条时长 memo 帧号
import { toggleEdgesHitSound, setEdgeSoundBitAll } from './edgeSounds'; // v213: 滑条 per-edge hitsound

interface Snapshot {
  hitObjects: HitObject[];
  timingPoints: TimingPoint[];
  difficulty: Beatmap['difficulty'];
  editor: Beatmap['editor'];
  general: Beatmap['general'];
  metadata: Beatmap['metadata'];
  /** v209: rawSections 一并快照 (重置休息时段改 [Events] 原文, 撤销需恢复) */
  rawSections?: Record<string, string[]>;
}

function deepCopy<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

/** 变换原点: 'selection' 选区包围盒中心 / 'playfield' 游玩区中心 (256,192) / {x,y} 自定义位置 */
export type TransformOrigin = 'selection' | 'playfield' | Pt;

export type Tool = 'select' | 'circle' | 'slider' | 'spinner';

export const PLAYBACK_RATES = [0.5, 0.75, 1] as const;

/** v101: hitsound 总线增益 (留余量防削波; 所有 hitsound 经此总线再到 destination) */
export const HITSOUND_BUS_GAIN = 0.8;

// v96: 辅助线开关持久化 (默认关, 记忆上次)
const LS_GEO_ENABLED = 'osu-editor:geo-enabled';
function loadGeoEnabled(): boolean {
  try { return localStorage.getItem(LS_GEO_ENABLED) === '1'; } catch { return false; }
}

// v103: 波形/频谱显示开关持久化; v127: 默认开 (波形画在上方时间轴背景, 不再是独立窗口)
const LS_WAVE_PANEL_OPEN = 'osu-editor:wavepanel-open';
function loadWavePanelOpen(): boolean {
  try { const v = localStorage.getItem(LS_WAVE_PANEL_OPEN); return v === null ? true : v === '1'; } catch { return true; }
}

// v127: 波形显示模式 (波形图/频谱图) 与层级 (背景/上层) 持久化 (原 WaveformPanel 组件内状态, 面板废弃后入 store)
const LS_WAVE_MODE = 'osu-editor:wavepanel:mode';
const LS_WAVE_ON_TOP = 'osu-editor:wavepanel:ontop';
function loadWaveMode(): 'wave' | 'spectro' {
  try { return localStorage.getItem(LS_WAVE_MODE) === 'spectro' ? 'spectro' : 'wave'; } catch { return 'wave'; }
}
function loadWaveOnTop(): boolean {
  try { return localStorage.getItem(LS_WAVE_ON_TOP) === '1'; } catch { return false; }
}

class EditorStore {
  beatmap: Beatmap | null = null;
  selected = new Set<number>();
  /** v102: 选中的绿线 (按 time 键); 与物件选区并列, 非加选的 select/clearSelection 会一并清空 */
  selectedGreenLines = new Set<number>();
  currentTime = 0;
  playing = false;
  tool: Tool = 'select';
  distanceLock = false; // 是否启用 DistanceSpacing 锁定间距 (lazer ComposerDistanceSnapProvider.DistanceSnapToggle 默认 TernaryState.False)
  /** v115: 锁定物件 (stable 「编辑 > Lock Notes」): 开启后无法移动/修改/删除任何已有物件;
      放置新物件/粘贴/绿线编辑不受影响。各物件变更入口统一检查此标志 */
  lockNotes = false;
  // v223: 游玩区平移/缩放 (视图辅助, 不写入谱面): 开关 + 偏移 (osu px) + 缩放倍率 (默认 1.0);
  // 关闭时变换不生效 (回到默认适配视图), 已设值保留
  playfieldPanEnabled = false;
  playfieldPanX = 0;
  playfieldPanY = 0;
  playfieldScale = 1.0;
  // v235: 吸附到物件总开关 (默认开) — 关闭后物件中心/滑条尾吸附、几何辅助吸附、间距辅助线吸附、拖拽整体吸附全部停用
  objectSnapEnabled = true;
  // v56: 位置网格 (lazer OsuGridToolboxGroup + rectangularGridSnapToggle)
  gridSnap = false; // Grid Snap 开关 (lazer 默认 False); 网格线始终显示 (lazer LayerBelowRuleset)
  gridType: 'square' | 'triangle' | 'circle' | 'none' = 'square'; // v119: none = 无网格 (渲染与吸附同时停)
  gridSpacing: number | null = null; // null = 跟随谱面 [Editor] GridSize (lazer 初始值); 修改时写回 editor.gridSize
  gridRotation = 0; // 度; 圆形禁用 (lazer GridLinesRotation.Disabled)
  // v78: 自定义网格中心 (lazer OsuGridToolboxGroup 的 StartPositionX/Y 可配; 默认 = 游玩区中心 GRID_ORIGIN)
  // 与自定义变换原点同款逻辑: UI 状态不入 undo/谱面, 画布标记可拖拽 (吸附规则与物件同级)
  gridOrigin: Pt = { x: 256, y: 192 };
  gridOriginCustom = false;
  setGridOrigin(p: Pt) { this.gridOrigin = { x: Math.round(p.x), y: Math.round(p.y) }; this.emitSelection(); }
  setGridOriginCustom(b: boolean) { this.gridOriginCustom = b; this.emitSelection(); }
  // v163: 限制物件在游玩区域内 (默认开 = 既有行为); 关闭后放置/拖动/网格吸附均不钳制到 0..512/0..384
  limitToPlayfield = true;
  setLimitToPlayfield(b: boolean) { this.limitToPlayfield = b; this.emitSelection(); }
  setObjectSnapEnabled(b: boolean) { this.objectSnapEnabled = b; this.emitSelection(); } // v235
  /** 当前生效的网格原点 (自定义 or lazer 默认 GRID_ORIGIN) */
  currentGridOrigin(): Pt { return this.gridOriginCustom ? this.gridOrigin : GRID_ORIGIN; }
  // v84: 几何辅助 (Mapping Tools Geometry Dashboard 三种): 圆心点 / 三点圆 / 直线延伸线; 全部默认开 (mapping tools 默认启用)
  geoCenter = true;
  geoCircle = true;
  geoLines = true;
  // v126: 视觉间距辅助线 (物件边缘外扩等距轮廓): 默认关 (覆盖物件多, 避免默认干扰), 距离可调
  geoDist = false;
  geoDistValue = 50; // osu px, 物件边缘向外距离
  setGeoDistValue(v: number) {
    this.geoDistValue = Math.max(0, Math.min(500, Math.round(Number.isFinite(v) ? v : 0)));
    this.emitSelection();
  }
  geoPanelOpen = false;
  setGeoFlag(k: 'geoCenter' | 'geoCircle' | 'geoLines' | 'geoDist', v: boolean) { this[k] = v; this.emitSelection(); }
  setGeoPanelOpen(b: boolean) { this.geoPanelOpen = b; this.emitSelection(); }
  // v88: 辅助显示范围 (面板互斥勾选项): all = 当前可见所有物件; selection = 当前选中 + 上次选中
  // v90: 显示/隐藏总开关移到工具栏「辅助线」按钮 (none 勾选项撤销)
  // v96: 默认关, localStorage 记忆上次开关
  geoScope: 'all' | 'selection' = 'selection';
  geoEnabled = loadGeoEnabled();
  prevGeoIds = new Set<number>(); // 上次非空选择集 (selection 范围下并入显示/吸附)
  setGeoScope(s: 'all' | 'selection') { this.geoScope = s; this.emitSelection(); }
  setGeoEnabled(b: boolean) {
    this.geoEnabled = b;
    try { localStorage.setItem(LS_GEO_ENABLED, b ? '1' : '0'); } catch { /* 隐私模式等忽略 */ }
    this.emitSelection();
  }
  private rememberGeoSelection() { if (this.selected.size) this.prevGeoIds = new Set(this.selected); }
  // v103: 波形/频谱显示开关 (入 store 供工具栏切换); v127: 默认开, 画在上方时间轴 (WaveformPanel 悬浮窗已废弃)
  wavePanelOpen = loadWavePanelOpen();
  setWavePanelOpen(b: boolean) {
    this.wavePanelOpen = b;
    try { localStorage.setItem(LS_WAVE_PANEL_OPEN, b ? '1' : '0'); } catch { /* 隐私模式等忽略 */ }
    this.emitSelection();
  }
  // v127: 波形模式 (wave=波形图 / spectro=频谱图) 与层级 (false=时间轴背景 / true=时间轴上层)
  waveMode: 'wave' | 'spectro' = loadWaveMode();
  waveOnTop = loadWaveOnTop();
  setWaveMode(m: 'wave' | 'spectro') {
    this.waveMode = m;
    try { localStorage.setItem(LS_WAVE_MODE, m); } catch { /* 隐私模式等忽略 */ }
    this.emitSelection();
  }
  setWaveOnTop(b: boolean) {
    this.waveOnTop = b;
    try { localStorage.setItem(LS_WAVE_ON_TOP, b ? '1' : '0'); } catch { /* 隐私模式等忽略 */ }
    this.emitSelection();
  }
  // v132: 显示设置面板 (页签栏右侧「显示设置」按钮; 开关值在 displaySettings 模块单例, 渲染循环直读)
  displayPanelOpen = false;
  setDisplayPanelOpen(b: boolean) { this.displayPanelOpen = b; this.emitSelection(); }
  setDisplayFlag(k: BoolDisplayKey, v: boolean) { applyDisplayFlag(k, v); this.emitSelection(); }
  /** v168: 显示设置数值项 (背景亮度) */
  setDisplayNumber(k: 'bgBrightness', v: number) { applyDisplayNumber(k, v); this.emitSelection(); }
  /** v231/v232: 显示设置字符串枚举项 (滑条控制点样式 / 物件选中效果) */
  setDisplayString<K extends StrDisplayKey>(k: K, v: DisplaySettings[K]) { applyDisplayString(k, v); this.emitSelection(); }
  // v144: 音量设置面板 (显示设置左侧「音量」按钮; 值在 volumeSettings 模块单例)
  volumePanelOpen = false;
  setVolumePanelOpen(b: boolean) { this.volumePanelOpen = b; this.emitSelection(); }
  setVolume(k: keyof VolumeSettings, v: number) { applyVolume(k, v); this.applyVolumeBuses(); this.emitSelection(); }
  /** v103: 解码后的整曲 PCM (波形/频谱数据源); 解码失败降级时为 null */
  getAudioBuffer(): AudioBuffer | null { return this.audioBuffer; }
  // v86: Pattern 库 (规格见 patternLibrary.ts 头注释): 收藏选中物件, 拖到游玩区落盘
  patterns: StoredPattern[] = [];
  patternGroups: string[] = [];           // 空分类名 (有 pattern 的分类从 patterns 聚合)
  patternPanelOpen = false;
  patternDrag: StoredPattern | null = null; // 拖拽中的 pattern (EditorCanvas 读它画幻影/落盘)
  patternAlign: 'none' | 'greenline' | 'scale' = 'none'; // 两个勾选框 (互斥)
  patternsLoaded = false;
  loadPatternsIfNeeded() {
    if (this.patternsLoaded) return;
    this.patternsLoaded = true;
    this.patterns = loadPatterns();
    this.patternGroups = loadPatternGroups();
  }
  private persistPatterns() { savePatterns(this.patterns); savePatternGroups(this.patternGroups); }
  setPatternPanelOpen(b: boolean) { this.patternPanelOpen = b; this.emitSelection(); }
  setPatternAlign(a: 'none' | 'greenline' | 'scale') { this.patternAlign = a; this.emitSelection(); }
  /** 收藏当前选中物件为 pattern (≥1 个), 归入 group (缺省未分类); 返回新 pattern */
  addPatternFromSelection(name: string, group?: string): StoredPattern | null {
    if (!this.beatmap || !this.selected.size) return null;
    const objs = this.beatmap.hitObjects.filter(o => this.selected.has(o.id));
    if (!objs.length) return null;
    const p = makePattern(newPatternId(), name || `pattern ${this.patterns.length + 1}`, this.beatmap, objs, group);
    this.patterns = [...this.patterns, p];
    this.persistPatterns();
    this.emitSelection();
    return p;
  }
  deletePattern(id: string) {
    this.patterns = this.patterns.filter(p => p.id !== id);
    this.persistPatterns(); this.emitSelection();
  }
  renamePattern(id: string, name: string) {
    const p = this.patterns.find(p => p.id === id);
    if (p && name.trim()) { p.name = name.trim(); this.persistPatterns(); this.emitSelection(); }
  }
  movePattern(id: string, group: string) {
    const p = this.patterns.find(p => p.id === id);
    if (p) { p.group = group; this.persistPatterns(); this.emitSelection(); }
  }
  addPatternGroup(name: string) {
    const n = name.trim();
    if (n && n !== DEFAULT_GROUP && !this.allPatternGroups().includes(n)) {
      this.patternGroups = [...this.patternGroups, n];
      this.persistPatterns(); this.emitSelection();
    }
  }
  renamePatternGroup(oldName: string, newName: string) {
    const n = newName.trim();
    if (!n || n === oldName || this.allPatternGroups().includes(n)) return;
    this.patternGroups = this.patternGroups.map(g => g === oldName ? n : g);
    for (const p of this.patterns) if (p.group === oldName) p.group = n;
    this.persistPatterns(); this.emitSelection();
  }
  /** 删除分类: 其中 pattern 移到未分类 (不连删) */
  deletePatternGroup(name: string) {
    if (name === DEFAULT_GROUP) return;
    this.patternGroups = this.patternGroups.filter(g => g !== name);
    for (const p of this.patterns) if (p.group === name) p.group = DEFAULT_GROUP;
    this.persistPatterns(); this.emitSelection();
  }
  allPatternGroups(): string[] {
    const s = new Set<string>([DEFAULT_GROUP, ...this.patternGroups]);
    for (const p of this.patterns) s.add(p.group);
    return [...s];
  }
  startPatternDrag(id: string) {
    const p = this.patterns.find(p => p.id === id);
    if (p) { this.patternDrag = p; this.emitSelection(); }
  }
  cancelPatternDrag() { if (this.patternDrag) { this.patternDrag = null; this.emitSelection(); } }
  /** 落盘: 首物件落在 pos (已吸附), 起点时间 startMs (已吸附节拍); 一次 undo, 选中新物件 */
  dropPattern(pos: Pt, startMs: number) {
    const p = this.patternDrag;
    if (!p || !this.beatmap) { this.patternDrag = null; return; }
    this.patternDrag = null;
    const r = instantiatePattern(p, this.beatmap, pos, startMs,
      { greenlineAlign: this.patternAlign === 'greenline', scaleAlign: this.patternAlign === 'scale' });
    this.pushUndo();
    if (r.greenlines.length) {
      // 同时间点已有绿线直接替换 (规格确认)
      const times = new Set(r.greenlines.map(g => g.time));
      this.beatmap.timingPoints = this.beatmap.timingPoints.filter(t => t.uninherited || !times.has(t.time));
      this.beatmap.timingPoints.push(...r.greenlines);
      this.beatmap.timingPoints.sort((a, b) => a.time - b.time);
    }
    this.beatmap.hitObjects.push(...r.objects);
    this.beatmap.hitObjects.sort((a, b) => a.time - b.time);
    this.selected = new Set(r.objects.map(o => o.id));
    this.emit();
  }
  get beatSnap(): number { return this.beatmap?.editor.beatDivisor ?? 4; }
  set beatSnap(v: number) { if (this.beatmap) { this.beatmap.editor.beatDivisor = v; } }
  // 正在绘制的滑条控制点
  pendingSlider: { x: number; y: number; redAnchor: boolean }[] = [];
  /** v180: 转盘放置中状态 — 已提交的起点时间 (ms); null = 未在放置 (lazer SpinnerPlacementBlueprint isPlacingEnd) */
  pendingSpinner: number | null = null;
  /** v82: 放置中光标 (osu 坐标, EditorCanvas mousemove 维护; 上方时间轴滑条预览用, 与画布预览同源) */
  pendingCursor: { x: number; y: number } | null = null;
  /** v145: 放置预览幽灵位置 (osu 坐标, 已吸附, EditorCanvas mousemove 维护; 间距面板实时预览用) */
  placementPreview: { x: number; y: number } | null = null;
  /** v145: 写放置预览; 圆整到整数 px 且与现值相同则不发通知 (防 mousemove/rAF 重渲染风暴) */
  setPlacementPreview(p: { x: number; y: number } | null) {
    const q = p ? { x: Math.round(p.x), y: Math.round(p.y) } : null;
    const cur = this.placementPreview;
    if (!q && !cur) return;
    if (q && cur && q.x === cur.x && q.y === cur.y) return;
    this.placementPreview = q;
    this.emitSelection();
  }
  // v167: 谱面星数 (lazer 移植, 见 starRating.ts) — App 在谱面数据变化 (getDataVersion) 后防抖 ~200ms 异步重算;
  //   UI 派生状态, 不入 undo; null = 无谱面或尚未算出 (显示时保留上一次结果, 由 App 控制)
  starRating: number | null = null;
  setStarRating(v: number | null) { this.starRating = v; this.emitSelection(); }
  audioUrl: string | null = null;
  audio: HTMLAudioElement | null = null; // 兜底(解码失败时, 无 1ms 保证, degradedSync=true)
  degradedSync = false;
  backgroundUrl: string | null = null;
  backgroundImg: HTMLImageElement | null = null;
  // Web Audio: 采样级时钟, 消除播放offset
  private actx: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  // v216: 每条播放 source 独立的淡入淡出增益 — 播放中 seek 用 per-source 交叉淡变,
  // 不再 dip 共享音乐总线 (滚轮连击时总线被反复瞬时拉零, 听感破碎/发闷如低码率)
  private sourceGain: GainNode | null = null;
  // v60: 变速不变调引擎 (lazer AudioAdjustments.Tempo 语义; rate≠1 时启用 signalsmith-stretch 节点)
  private tempoNode: TempoNode | null = null;
  private tempoLoading: Promise<void> | null = null;
  tempoActive = false; // 调试: 当前播放是否经 signalsmith-stretch 引擎
  tempoAnalyser: AnalyserNode | null = null; // 测试挂钩: CDP 频谱验证不变调
  private tempoGain: GainNode | null = null; // v216: 变速支路独立增益 (seek 防咔哒 dip 只作用此支路)
  private tempoEndTimer: ReturnType<typeof setTimeout> | null = null; // 播完检测 (signalsmith 节点无 ended 回执, 定时器替代)
  private clock: AudioClock | null = null;
  private scheduler: HitSoundScheduler | null = null;
  private hitBuffers = new Map<string, AudioBuffer>(); // stem(如 "soft-hitnormal") -> 谱面自定义采样
  private defaultBuffers = new Map<string, AudioBuffer>(); // 默认 hitsound (回退用; 皮肤目录采样会覆盖对应 stem)
  private skinSampleStems = new Set<string>(); // 被皮肤目录覆盖的默认 stem (恢复默认时移除)
  private defaultsLoading = false;
  private samplesToken = 0;
  // sliderslide 循环音: 随事件表重建, 播放中按 lookahead 排程, 暂停/seek 时停止
  private slideLoops: NonNullable<SliderSoundPlan['slide']>[] = [];
  private loopCursor = 0;
  private activeLoopNodes = new Set<AudioBufferSourceNode>();
  // v101: hitsound 总线 (留余量防削波) + 同采样并发上限 (lazer SAMPLE_CONCURRENCY=6)
  // v122: 上限只数"发声中"的 voice (预排程未来 voice 不占名额), 超限最老淡出让位 — 修复密集段消音
  private hitBus: GainNode | null = null;
  // v144: 音乐总线 (常速 source / 变速 tempoNode 统一经此进 destination; 增益 = 主*歌曲音量)
  private musicBus: GainNode | null = null;
  private voiceLimiter = new VoiceLimiter<AudioBuffer, { src: AudioBufferSourceNode; gain: GainNode }>(SAMPLE_CONCURRENCY);
  /** 调试: 当前活跃 voice 数 / 历史峰值 (CDP 验证用) */
  debugVoiceStats = { active: 0, maxSeen: 0 };
  playbackRate: number = 1;
  private eventsVersion = -1;

  // v67: Ctrl+S 保存谱面 — 谱面来源 (曲库目录 + 原文件名), 保存结果/反馈消息
  mapSource: MapSource | null = null;
  saveMessage: string | null = null;
  lastSave: SaveOutcome | null = null; // 测试挂钩: 最近一次保存的路由/文件名/全文
  // v120: 未保存改动 (脏标记) — pushUndo 时置位, load/save 成功时清除; 切换谱面/关闭前弹窗提示
  dirty = false;
  /** v120: 待执行的"废弃改动后继续"动作 (弹窗显示期间非空; 保存/废弃后由弹窗执行并清空) */
  pendingAction: (() => void) | null = null;
  /** v136: 弹窗确认后动作重入 guardUnsaved 的一次性放行标记 (resolvePendingAction 同步置位/消费) */
  private bypassUnsavedOnce = false;

  /** v120: 脏标记上报 (Electron 主进程关闭拦截用; 仅在状态翻转时发 IPC) */
  private setDirty(b: boolean) {
    if (this.dirty === b) return;
    this.dirty = b;
    reportDirtyState(b);
    this.emitPlayback(); // v124: 未保存指示器 (游玩区左下角) 即时显隐
  }

  /** v120: 有未保存改动时拦截 action, 弹保存/废弃提示; 返回 false = 已拦截 (调用方直接 return) */
  guardUnsaved(action: () => void): boolean {
    // v136: 弹窗确认 (保存/废弃) 后动作会重入本守卫 — 一次性放行, 否则仍脏被二次拦截, 弹窗重开
    // (表现为"点废弃改动没效果": 切难度/开谱面/拖入文件的重入动作在第一行 guardUnsaved 又被拦下)
    if (this.bypassUnsavedOnce) { this.bypassUnsavedOnce = false; return true; }
    if (!this.beatmap || !this.dirty) return true;
    this.pendingAction = action;
    this.emitPlayback(); // 弹窗显隐与谱面数据无关
    return false;
  }

  /** v120: 弹窗按钮回调: 清空待执行动作 (+可选先执行);
   *  v136: run=true 时动作在 bypassUnsavedOnce 下同步执行 (重入 guardUnsaved 直接放行; try/finally 保证标记不外泄) */
  resolvePendingAction(run: boolean) {
    const a = this.pendingAction;
    this.pendingAction = null;
    this.emitPlayback();
    if (run && a) {
      this.bypassUnsavedOnce = true;
      try { a(); } finally { this.bypassUnsavedOnce = false; }
    }
  }

  /** Ctrl+S (lazer Editor Save): 序列化写回来源文件; 无来源时兜底下载 .osu; 返回是否成功 (v120: 保存后清脏标记) */
  async save(): Promise<boolean> {
    if (!this.beatmap) return false;
    try {
      const r = await saveBeatmap(this.beatmap, this.mapSource);
      this.lastSave = r;
      this.saveMessage = r.route === 'download' ? `已导出: ${r.fileName}` : `已保存: ${r.fileName}`;
      this.setDirty(false); // v120
      this.savedFingerprint = this.fingerprint(); // v140: 保存内容成为新的干净基准
      this.emit();
      setTimeout(() => { this.saveMessage = null; this.emitPlayback(); }, 2600);
      void this.backupNow('save', r.text); // v185: 每次 Ctrl+S 备份一次 (异步, 不阻塞保存反馈)
      return true;
    } catch (e) {
      this.saveMessage = '保存失败: ' + (e instanceof Error ? e.message : String(e));
      this.emit();
      setTimeout(() => { this.saveMessage = null; this.emitPlayback(); }, 2600);
      return false;
    }
  }

  // v185: 谱面自动备份 — Ctrl+S 后 / 每 10 分钟 (App 定时器) 各备份一次;
  // 主进程写 exe 同目录 backup_beatmaps/<艺术家_歌曲名>/<原名_时间戳>.osu, 内容与上次相同则改名去重
  async backupNow(_trigger: 'save' | 'auto' = 'auto', content?: string): Promise<void> {
    const bm = this.beatmap;
    if (!bm) return;
    const api = getElectronAPI();
    if (!api?.backupBeatmap) return; // 浏览器/无备份能力 (dev)
    try {
      const m = bm.metadata;
      await api.backupBeatmap({
        artist: m.artist || m.artistUnicode,
        title: m.title || m.titleUnicode,
        origFile: this.mapSource?.fileName ?? mapFileName(bm),
        content: content ?? serializeOsu(bm),
      });
    } catch { /* 备份失败不打断编辑 */ }
  }

  /** v185: 文件菜单「查看备份」→ 主进程开当前谱面备份文件夹 */
  async openBackupFolder(): Promise<void> {
    const bm = this.beatmap;
    const api = getElectronAPI();
    if (!bm || !api?.openBackupFolder) return;
    const m = bm.metadata;
    try { await api.openBackupFolder({ artist: m.artist || m.artistUnicode, title: m.title || m.titleUnicode }); }
    catch { /* 忽略 */ }
  }

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** v140: 上次保存/载入时的内容指纹 (六段快照 JSON); dirty = 当前指纹 !== savedFingerprint */
  private savedFingerprint: string | null = null;
  /** v140: 当前谱面内容指纹 — 与 snapshot() 同六段 (撤销回保存态/无实际改动时指纹不变 → 不显示未保存) */
  private fingerprint(): string {
    return dirtyFingerprint(this.beatmap!);
  }
  /** v140: 按内容对比重算脏标记 (挂 emit() 漏斗: 所有数据变更含 undo/redo/拖拽提交都会经过) */
  private refreshDirty() {
    if (!this.beatmap || this.savedFingerprint === null) return;
    this.setDirty(this.fingerprint() !== this.savedFingerprint);
  }
  private clipboard: HitObject[] = [];
  /** v102: 绿线剪贴板 (time 相对 copy 时的共同原点, 与物件共用) */
  private clipboardGreens: TimingPoint[] = [];
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private version = 0;
  /** 数据版本: 仅谱面数据变更时递增 (hitsound 事件表重建以此为依据) */
  private dataVersion = 0;
  /** 谱面数据版本只读访问 (渲染层缓存派生数据用, 如 stacking 偏移) */
  getDataVersion = () => this.dataVersion;
  emit() { this.version++; this.dataVersion++; this.refreshDirty(); this.listeners.forEach(f => f()); } // v140: 数据变更后按内容指纹重算脏标记
  /** 播放中的高频 UI 刷新: 重建 UI 但不使 hitsound 事件表失效 (否则每帧重建+重排程 -> 音效叠爆) */
  emitPlayback() { this.version++; this.listeners.forEach(f => f()); }
  /** 选择集变化: 与谱面数据无关, 不使 hitsound 事件表失效 (框选拖拽期间每 mousemove 触发) */
  emitSelection() { this.version++; this.listeners.forEach(f => f()); }

  setBackground(url: string | null) {
    this.backgroundUrl = url;
    this.backgroundImg = null;
    if (url) {
      const img = new Image();
      img.onload = () => { this.backgroundImg = img; this.emit(); };
      img.src = url;
    }
  }

  load(bm: Beatmap, audioUrl: string | null, backgroundUrl: string | null = null, samples?: Map<string, File>, source: MapSource | null = null) {
    this.beatmap = bm;
    this.mapSource = source;
    this.lastSave = null;
    this.saveMessage = null;
    this.pendingAction = null; // v120: 新谱面已载入, 丢弃未执行的提示动作
    this.setDirty(false); // v120: 载入即干净状态
    this.savedFingerprint = this.fingerprint(); // v140: 载入内容成为干净基准 (脏标记按内容指纹对比)
    this.selected.clear();
    this.undoStack = []; this.redoStack = [];
    this.currentTime = bm.general.previewTime > 0 ? bm.general.previewTime : (bm.hitObjects[0]?.time ?? 0) - 1000;
    if (this.currentTime < 0) this.currentTime = 0;
    this.hitBuffers.clear();
    this.stopSlideLoops();
    this.slideLoops = [];
    this.loopCursor = 0;
    if (samples?.size) this.decodeSamples(samples);
    this.setAudio(audioUrl);
    this.setBackground(backgroundUrl);
    this.emit();
    void reportMenuState(bm, source); // v77: Electron 原生 "文件" 菜单状态 (非 Electron 无操作)
  }

  /** 异步解码谱面目录自带的 hitsound 采样 (无采样则播放时保持静音, 不再用合成音) */
  private async decodeSamples(files: Map<string, File>) {
    const token = ++this.samplesToken;
    if (!this.actx) this.actx = new AudioContext();
    const actx = this.actx;
    await Promise.all([...files].map(async ([stem, file]) => {
      try {
        const buf = await actx.decodeAudioData(await file.arrayBuffer());
        if (token === this.samplesToken) this.hitBuffers.set(stem, buf);
      } catch { /* 单个采样解码失败忽略 */ }
    }));
  }

  setAudio(url: string | null) {
    this.stopSource();
    if (this.audio) { this.audio.pause(); this.audio = null; }
    // 歌曲更换: 旧变速节点持有旧 PCM, 销毁待重建
    if (this.tempoNode) { try { this.tempoNode.disconnect(); } catch { /* noop */ } this.tempoNode = null; this.tempoAnalyser = null; this.tempoGain = null; }
    this.tempoLoading = null;
    this.audioUrl = url;
    this.audioBuffer = null;
    this.degradedSync = false;
    if (url) {
      // 优先 Web Audio 解码 (采样级精度); 失败退回 HTMLAudio (降级模式)
      fetch(url).then(r => r.arrayBuffer()).then(buf => {
        if (this.audioUrl !== url) return;
        if (!this.actx) this.actx = new AudioContext();
        this.ensureClock(); // 尽早创建时钟, 让相位跟踪预热
        return this.actx.decodeAudioData(buf);
      }).then(decoded => {
        if (decoded && this.audioUrl === url) {
          this.audioBuffer = decoded;
          this.ensureTempoNode(); // 预热变速引擎, 首次变速播放即可用
          this.emit();
        }
      }).catch(() => {
        if (this.audioUrl !== url) return;
        this.degradedSync = true;
        this.audio = new Audio(url);
        this.audio.volume = musicGain(); // v144: 兜底 <audio> 同样受歌曲音量控制 (音量设置在 applyVolumeBuses 同步)
        // 变速不变调 (lazer Tempo): 浏览器原生 time-stretch
        this.audio.preservesPitch = true;
        (this.audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
        this.audio.addEventListener('ended', () => { this.playing = false; this.emit(); });
      });
    }
  }

  /** signalsmith-stretch 变速不变调引擎: 创建节点并送入解码后的 PCM (幂等, 异步) */
  private ensureTempoNode() {
    if (!this.actx || !this.audioBuffer || this.tempoNode || this.tempoLoading) return;
    const actx = this.actx;
    const buf = this.audioBuffer;
    this.tempoLoading = (async () => {
      try {
        const node = await createTempoNode(actx);
        if (this.audioBuffer !== buf) { node.disconnect(); return; } // 加载期间已换歌
        const chL = buf.getChannelData(0);
        const chR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : chL;
        const lc = chL.slice();
        const rc = chR === chL ? lc : chR.slice();
        // buffer 模式: PCM 移交节点内部缓冲 (transferable); 单声道由节点复制到双声道
        await node.addBuffers(rc === lc ? [lc] : [lc, rc], rc === lc ? [lc.buffer] : [lc.buffer, rc.buffer]);
        if (this.audioBuffer !== buf) { node.disconnect(); return; } // 送 PCM 期间已换歌
        const an = actx.createAnalyser();
        an.fftSize = 4096;
        node.connect(an);
        const g = actx.createGain(); // v216: 变速支路独立增益
        an.connect(g);
        g.connect(this.ensureMusicBus()); // v144: 经音乐总线 (音量设置), 不直接接 destination
        this.tempoNode = node;
        this.tempoAnalyser = an;
        this.tempoGain = g;
      } catch (err) {
        console.warn('signalsmith-stretch tempo 节点不可用, 变速将退化为变调', err);
      }
    })();
  }

  // 调试: 最近排程的 hitsound 记录 (排查"音效不对"类问题用, 上限 300 条)
  debugLog: { mapTimeMs: number; soundId: string; volume: number; used: string; kind: string }[] = [];
  private debugPush(mapTimeMs: number, soundId: string, volume: number, used: string, kind: string) {
    this.debugLog.push({ mapTimeMs, soundId, volume, used, kind });
    if (this.debugLog.length > 300) this.debugLog.splice(0, this.debugLog.length - 300);
  }

  /** hitsound 总线: 所有 hitsound voice 的 GainNode 先接此总线, 再统一进 destination (v101) */
  private ensureHitBus(): GainNode {
    if (!this.actx) this.actx = new AudioContext();
    if (!this.hitBus) {
      this.hitBus = this.actx.createGain();
      this.hitBus.gain.value = HITSOUND_BUS_GAIN * effectsGain(); // v144: 主*音效音量
      this.hitBus.connect(this.actx.destination);
    }
    return this.hitBus;
  }

  /** v144: 音乐总线 (常速 source / 变速 tempoNode 统一经此进 destination; 增益 = 主*歌曲音量) */
  private ensureMusicBus(): GainNode {
    if (!this.actx) this.actx = new AudioContext();
    if (!this.musicBus) {
      this.musicBus = this.actx.createGain();
      this.musicBus.gain.value = musicGain();
      this.musicBus.connect(this.actx.destination);
    }
    return this.musicBus;
  }

  /** v144: 音量调整后同步现存总线/兜底 <audio> (新建总线在 ensure 时读单例, 无需同步) */
  private applyVolumeBuses() {
    if (this.hitBus) this.hitBus.gain.value = HITSOUND_BUS_GAIN * effectsGain();
    if (this.musicBus) this.musicBus.gain.value = musicGain();
    if (this.audio) this.audio.volume = musicGain();
  }

  /** 登记 voice 并执行并发上限 (v122): 只数与新 voice 同时发声的旧 voice, 超限最老在新 voice 发声时刻
   *  快速淡出后停止 (防咔哒); ended 后注销。startCtx/endCtx = AudioContext 时间 (秒), endCtx 缺省 = 自然播完 */
  private trackVoice(buf: AudioBuffer, src: AudioBufferSourceNode, gain: GainNode, startCtx: number, endCtx = startCtx + buf.duration) {
    const rec = { src, gain };
    for (const old of this.voiceLimiter.register(buf, rec, startCtx, endCtx)) {
      old.v.gain.gain.setTargetAtTime(0, startCtx, 0.008); // ~25ms 淡出
      try { old.v.src.stop(startCtx + 0.05); } catch { /* noop */ }
    }
    src.addEventListener('ended', () => {
      this.voiceLimiter.release(buf, rec);
      this.debugVoiceStats.active = this.voiceLimiter.totalCount();
    });
    this.debugVoiceStats.active = this.voiceLimiter.totalCount();
    if (this.debugVoiceStats.active > this.debugVoiceStats.maxSeen) this.debugVoiceStats.maxSeen = this.debugVoiceStats.active;
  }

  /** v122: 立即停止全部 hitsound voice (暂停/换谱/引擎停止; 含已预排程未发声的 — 否则暂停后音效还在响) */
  private stopAllHitVoices() {
    for (const e of this.voiceLimiter.drain()) { try { e.v.src.stop(); } catch { /* noop */ } }
    this.debugVoiceStats.active = 0;
  }

  private ensureClock(): AudioClock {
    if (!this.actx) this.actx = new AudioContext();
    if (!this.clock) {
      this.clock = new AudioClock({
        ctxNow: () => this.actx!.currentTime,
        perfNow: () => performance.now(),
        outputLatency: () => {
          const a = this.actx as AudioContext & { outputLatency?: number };
          return a.outputLatency ?? a.baseLatency ?? 0;
        },
      });
      this.scheduler = new HitSoundScheduler(this.clock, {
        schedule: (at, soundId, fallbacks, volume) => {
          if (!this.actx) return;
          // 回退链: 谱面自定义(含序号回退) -> 默认同 set -> 默认 normal 同音效
          let buf = this.hitBuffers.get(soundId);
          let used = soundId;
          if (!buf && fallbacks) for (const f of fallbacks) { buf = this.hitBuffers.get(f); if (buf) { used = f; break; } }
          if (!buf) { buf = this.defaultBuffers.get(soundId); if (buf) used = 'def:' + soundId; }
          if (!buf) {
            const sound = soundId.slice(soundId.indexOf('-') + 1).replace(/\d+$/, '');
            buf = this.defaultBuffers.get(`normal-${sound}`);
            if (buf) used = `def:normal-${sound}`;
          }
          if (!buf) { this.debugPush(NaN, soundId, volume ?? 100, 'MISS', 'hit'); return; }
          this.debugPush(NaN, soundId, volume ?? 100, used, 'hit');
          const src = this.actx.createBufferSource();
          src.buffer = buf;
          // lazer: 采样音量 (hitSample/timing point, 下限 5%) 经 GainNode 应用
          const gain = this.actx.createGain();
          gain.gain.value = (volume ?? 100) / 100;
          src.connect(gain);
          gain.connect(this.ensureHitBus()); // v101: 经 hitsound 总线 (余量), 不直接接 destination
          // v122: 发声起点 = max(排程时刻, 现在) — 已过时刻立即发声; 只把发声中的 voice 计入并发上限
          this.trackVoice(buf, src, gain, Math.max(at, this.actx.currentTime));
          src.start(at);
        },
      });
    }
    this.ensureDefaultSamples();
    return this.clock;
  }

  /** 加载 osu! 经典默认 hitsound (public/samples/, 一次性, 谱面无自定义采样时回退) */
  private ensureDefaultSamples() {
    if (this.defaultsLoading) return;
    this.defaultsLoading = true;
    if (!this.actx) this.actx = new AudioContext();
    const actx = this.actx;
    const base = import.meta.env.BASE_URL || '/';
    for (const stem of [...DEFAULT_SAMPLE_STEMS, ...DEFAULT_SLIDER_STEMS]) {
      fetch(`${base}samples/${stem}.wav`)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then(ab => actx.decodeAudioData(ab))
        // 皮肤目录已覆盖的 stem 不被迟到的默认采样回写
        .then(buf => { if (!this.skinSampleStems.has(stem)) this.defaultBuffers.set(stem, buf); })
        .catch(() => { /* 单个默认采样加载失败忽略 */ });
    }
  }

  /** 应用皮肤目录中的 hitsound 采样: 覆盖同名默认 stem (osu! 行为: 皮肤音效优先于内置默认) */
  async applySkinSamples(files: Map<string, File>): Promise<number> {
    if (!this.actx) this.actx = new AudioContext();
    const actx = this.actx;
    let loaded = 0;
    await Promise.all([...files].map(async ([stem, file]) => {
      try {
        const buf = await actx.decodeAudioData(await file.arrayBuffer());
        this.defaultBuffers.set(stem, buf);
        this.skinSampleStems.add(stem);
        loaded++;
      } catch { /* 单个采样解码失败忽略 */ }
    }));
    return loaded;
  }

  /** 移除皮肤目录采样, 重新加载内置默认 hitsound */
  resetSkinSamples() {
    for (const stem of this.skinSampleStems) this.defaultBuffers.delete(stem);
    this.skinSampleStems.clear();
    this.defaultsLoading = false;
    this.ensureDefaultSamples();
  }

  private stopSource() {
    if (this.source) { try { this.source.onended = null; this.source.stop(); } catch { /* noop */ } this.source = null; }
    if (this.sourceGain) { try { this.sourceGain.disconnect(); } catch { /* noop */ } this.sourceGain = null; } // v216
    if (this.tempoEndTimer) { clearTimeout(this.tempoEndTimer); this.tempoEndTimer = null; }
    if (this.tempoNode) { try { this.tempoNode.stop(); } catch { /* noop */ } }
    this.tempoActive = false;
    this.stopAllHitVoices(); // v122: 引擎停止时 hitsound 一起停 (暂停/换谱/变速重启都经此处)
  }

  /** 重建 hitsound 事件表 (谱面数据变更后懒重建): 按物件 hitSample/timing point/[General] 解析 sample set 与自定义序号 */
  private rebuildEventsIfDirty() {
    if (!this.scheduler || !this.beatmap || this.eventsVersion === this.dataVersion) return;
    this.eventsVersion = this.dataVersion;
    const bm = this.beatmap;
    const defSet = setNumFromGeneral(bm.general.sampleSet);
    const events: HitSoundEvent[] = [];
    const loops: NonNullable<SliderSoundPlan['slide']>[] = [];
    for (const o of bm.hitObjects) {
      if (o.type === 'slider') {
        // 滑条: 头/边缘/tick 全部由 planSliderSounds 规划 (含音量与 set 继承)
        const plan = planSliderSounds(bm, o);
        for (const e of [...plan.head, ...plan.edges, ...plan.ticks])
          events.push({ mapTimeMs: e.timeMs, soundId: e.soundId, fallbacks: e.fallbacks, volume: e.volume });
        if (plan.slide) loops.push(plan.slide);
        continue;
      }
      const hs = parseHitSample(o.hitSampleRaw);
      const tp = timingAt(bm.timingPoints, o.time);
      const tpSet = (tp.green ?? tp.red).sampleSet || defSet;
      const normalSet = hs.normalSet || tpSet;
      const additionSet = hs.additionSet || normalSet;
      // lazer: hitSample.volume > 0 覆盖, 否则 timing point volume (下限 5%)
      const volume = objectVolume(bm.timingPoints, o.time, hs.volume);
      for (const sid of soundsForHitSound(o.hitSound ?? 0)) {
        const set = sid === 'hitnormal' ? normalSet : additionSet;
        const cands = stemCandidates(sid, set, hs.customIndex);
        events.push({ mapTimeMs: o.time, soundId: cands[0], fallbacks: cands.slice(1), volume });
      }
    }
    events.sort((a, b) => a.mapTimeMs - b.mapTimeMs);
    loops.sort((a, b) => a.startMs - b.startMs);
    this.slideLoops = loops;
    this.scheduler.setEvents(events);
    this.scheduler.resync();
    this.resyncLoops();
    // v156: 节拍器拍点表随谱面数据重建 (红线段逐拍, 按 meter 标首拍)
    this.metroBeats = metronomeBeats(bm.timingPoints, this.songLength());
    this.resyncMetro();
  }

  // ---- v156: 节拍器 (原生 Timing 菜单「节拍器」开关; 走 hitsound 总线 lookahead 排程, 与 hitsound 同精度) ----
  /** 节拍器开关 (原生菜单 checkbox 勾选状态经 timing-menu-state 回显) */
  metronome = false;
  private metroBeats: { t: number; down: boolean }[] = [];
  private metroCursor = 0;

  toggleMetronome() {
    this.metronome = !this.metronome;
    this.resyncMetro();
    this.emitPlayback(); // 菜单勾选状态上报依赖订阅通知
  }

  /** seek/重建后: 节拍器游标重新对准 (与 resyncLoops 同模式) */
  private resyncMetro() {
    const now = this.clock?.rawNowMs() ?? 0;
    this.metroCursor = 0;
    while (this.metroCursor < this.metroBeats.length && this.metroBeats[this.metroCursor].t < now - 5) this.metroCursor++;
  }

  /** 播放中每帧 (positionMs 内调用): 排程 lookahead 250ms 内的拍点 (首拍 whistle 全量, 其余 hitnormal 七成) */
  private tickMetronome() {
    if (!this.metronome || !this.actx || !this.clock || !this.clock.running) return;
    const horizon = this.clock.rawNowMs() + 250;
    while (this.metroCursor < this.metroBeats.length && this.metroBeats[this.metroCursor].t <= horizon) {
      const b = this.metroBeats[this.metroCursor++];
      const at = this.clock.ctxTimeForMapTime(b.t);
      if (at === null) continue; // 已开始的拍不补播 (与 seek 静音一致)
      const buf = this.defaultBuffers.get(b.down ? 'normal-hitwhistle' : 'normal-hitnormal') ?? this.defaultBuffers.get('normal-hitnormal');
      if (!buf) continue;
      const src = this.actx.createBufferSource();
      src.buffer = buf;
      const gain = this.actx.createGain();
      gain.gain.value = b.down ? 1 : 0.7;
      src.connect(gain);
      gain.connect(this.ensureHitBus());
      const startAt = Math.max(at, this.actx.currentTime);
      this.trackVoice(buf, src, gain, startAt, startAt + buf.duration);
      src.start(at);
    }
  }

  /** 每帧调用 (暂停中也要): 预热/维持时钟相位跟踪 */
  tickClock() { beginLifecycleFrame(); this.clock?.trackPhase(); } // v197: 每帧推进 lifecycle memo 帧号

  /** 播放中每帧: 排程 lookahead 内的 sliderslide 循环音 */
  private tickSlideLoops() {
    if (!this.actx || !this.clock || !this.clock.running) return;
    const horizon = this.clock.rawNowMs() + 250;
    while (this.loopCursor < this.slideLoops.length && this.slideLoops[this.loopCursor].startMs <= horizon) {
      const lp = this.slideLoops[this.loopCursor++];
      const at = this.clock.ctxTimeForMapTime(lp.startMs);
      const endAt = this.clock.ctxTimeForMapTime(lp.endMs);
      if (at === null) continue; // 已开始的循环不补播 (与 seek 静音一致)
      const buf = this.hitBuffers.get(lp.soundId) ?? this.defaultBuffers.get(lp.soundId) ?? this.defaultBuffers.get('normal-sliderslide');
      if (!buf) continue;
      this.debugPush(lp.startMs, lp.soundId, lp.volume ?? 100, 'loop:' + lp.soundId, 'loop');
      const src = this.actx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = this.actx.createGain();
      gain.gain.value = (lp.volume ?? 100) / 100;
      src.connect(gain);
      gain.connect(this.ensureHitBus()); // v101: 循环音同样走 hitsound 总线
      // v122: 循环音 end = 排程停止时刻 (无则按长时), 同样只计发声中的 voice
      this.trackVoice(buf, src, gain, Math.max(at, this.actx.currentTime), endAt ?? Math.max(at, this.actx.currentTime) + 3600);
      src.start(at);
      if (endAt !== null) src.stop(endAt);
      this.activeLoopNodes.add(src);
      src.onended = () => { this.activeLoopNodes.delete(src); };
    }
  }

  /** 立即停止全部循环音 (暂停/seek/换谱) */
  private stopSlideLoops() {
    for (const s of this.activeLoopNodes) { try { s.onended = null; s.stop(); } catch { /* noop */ } }
    this.activeLoopNodes.clear();
  }

  /** seek/重建后: 循环音指针重新对准 */
  private resyncLoops() {
    this.stopSlideLoops();
    const now = this.clock?.rawNowMs() ?? 0;
    this.loopCursor = 0;
    while (this.loopCursor < this.slideLoops.length && this.slideLoops[this.loopCursor].startMs < now - 5) this.loopCursor++;
    this.resyncMetro(); // v156: 节拍器游标一并对准 (seek/变速重启都经此处)
  }

  // 当前精确播放位置 (ms): 对齐人耳可闻位置, WebAudio 时钟误差 < 1ms
  positionMs(): number {
    if (this.playing && this.audioBuffer && this.clock) {
      this.rebuildEventsIfDirty();
      this.scheduler?.tick();
      this.tickSlideLoops();
      this.tickMetronome(); // v156: 节拍器 (开关见原生 Timing 菜单)
      return this.clock.heardNowMs();
    }
    if (this.playing && this.audio) return this.audio.currentTime * 1000;
    return this.currentTime;
  }

  snapshot(): Snapshot {
    const bm = this.beatmap!;
    // v209: rawSections 入快照 (重置休息时段撤销用)
    return deepCopy({ hitObjects: bm.hitObjects, timingPoints: bm.timingPoints, difficulty: bm.difficulty, editor: bm.editor, general: bm.general, metadata: bm.metadata, rawSections: bm.rawSections ?? {} });
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    // v140: 不再在此置脏 — pushUndo 发生在变更前, 且存在无实际改动的操作; 脏标记改由 emit() 时按内容指纹对比 (refreshDirty)
  }

  restore(s: Snapshot) {
    invalidatePath(); // 几何缓存全部失效, 防止旧滑条残留
    const bm = this.beatmap!;
    bm.hitObjects = deepCopy(s.hitObjects);
    bm.timingPoints = deepCopy(s.timingPoints);
    bm.difficulty = deepCopy(s.difficulty);
    bm.editor = deepCopy(s.editor);
    bm.general = deepCopy(s.general);
    bm.metadata = deepCopy(s.metadata);
    bm.rawSections = deepCopy(s.rawSections ?? {}); // v209
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop()!);
    this.emit();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop()!);
    this.emit();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  addObject(o: HitObject) {
    if (!this.beatmap) return;
    this.pushUndo();
    this.beatmap.hitObjects.push(o);
    this.beatmap.hitObjects.sort((a, b) => a.time - b.time);
    this.emit();
  }

  deleteSelected() {
    if (!this.beatmap) return;
    const delObjs = this.selected.size > 0 && !this.lockNotes; // v115: 锁定物件时跳过物件删除 (绿线照删)
    if (!delObjs && !this.selectedGreenLines.size) return;
    this.pushUndo();
    if (delObjs) {
      this.beatmap.hitObjects = this.beatmap.hitObjects.filter(o => !this.selected.has(o.id));
      this.selected.clear();
      this.selectedNodes.clear();
      this.selectedEdges.clear();
    }
    // v113: 选中的绿线一并删除 (按 time 键, 红线不受影响)
    if (this.selectedGreenLines.size) {
      this.beatmap.timingPoints = this.beatmap.timingPoints.filter(tp => tp.uninherited || !this.selectedGreenLines.has(tp.time));
      this.selectedGreenLines.clear();
    }
    this.emit();
  }

  /** v113: 删除指定时刻的绿线 (按 time 键), 一次 undo; 时间轴右键删除用 */
  deleteGreenLinesAt(times: Iterable<number>) {
    if (!this.beatmap) return;
    const ts = new Set(times);
    if (!ts.size) return;
    this.pushUndo();
    this.beatmap.timingPoints = this.beatmap.timingPoints.filter(tp => tp.uninherited || !ts.has(tp.time));
    for (const t of ts) this.selectedGreenLines.delete(t);
    this.emit();
  }

  /** v155: 书签 (蓝线, [Editor] Bookmarks): 在当前位置添加 (Ctrl+B); 已存在同刻书签则不动作 */
  addBookmark(t: number) {
    const bm = this.beatmap; if (!bm) return;
    const ms = Math.max(0, Math.round(t));
    if (bm.editor.bookmarks.includes(ms)) return;
    this.pushUndo();
    bm.editor.bookmarks.push(ms);
    bm.editor.bookmarks.sort((a, b) => a - b);
    this.emit();
  }

  /** v155: 删除离当前位置最近的书签 (Ctrl+Shift+B), 阈值 500ms 内无书签则不动作 */
  removeBookmarkNear(t: number, threshold = 500) {
    const bm = this.beatmap; if (!bm || !bm.editor.bookmarks.length) return;
    let bi = -1, bd = Infinity;
    bm.editor.bookmarks.forEach((b, i) => { const d = Math.abs(b - t); if (d < bd) { bd = d; bi = i; } });
    if (bd > threshold) return;
    this.pushUndo();
    bm.editor.bookmarks.splice(bi, 1);
    this.emit();
  }

  // ---- v156: 原生 Timing 菜单命令 (electronMenu.handleMenuCommand 路由至此) ----
  /** 添加红/绿线 (克隆生效点默认值, 弹编辑窗确认; 与上时间轴 +红/+绿 一致) */
  timingAddPoint(uninherited: boolean) {
    const bm = this.beatmap; if (!bm) return;
    this.openTimingPointDialog('add', -1, defaultNewPoint(bm.timingPoints, Math.round(this.currentTime), uninherited));
  }

  /** 当前生效红线的拍号 (节拍类型菜单 radio 勾选依据); 无红线 null */
  timingMeterAtCurrent(): number | null {
    const bm = this.beatmap; if (!bm) return null;
    return effectivePointAt(bm.timingPoints, this.currentTime, true)?.meter ?? null;
  }

  /** 设置当前生效红线拍号 (节拍类型子菜单); 无红线/同值不动作 */
  timingSetMeter(meter: number) {
    const bm = this.beatmap; if (!bm) return;
    const red = effectivePointAt(bm.timingPoints, this.currentTime, true);
    if (!red || red.meter === meter) return;
    this.pushUndo();
    red.meter = meter;
    this.emit();
  }

  /** 重置当前区间 (当前时间最新生效点): 红 → 500ms/4拍/set1/idx0/vol80/fx0, 绿 → 1.00x 同余项 */
  timingResetCurrent() {
    const bm = this.beatmap; if (!bm) return;
    const tp = activePointAt(bm.timingPoints, this.currentTime);
    if (!tp) return;
    this.pushUndo();
    Object.assign(tp, { beatLength: tp.uninherited ? 500 : -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, effects: 0 });
    this.emit();
  }

  /** 删除当前区间 (当前时间最新生效点; 绿线同时清选区键) */
  timingDeleteCurrent() {
    const bm = this.beatmap; if (!bm) return;
    const tp = activePointAt(bm.timingPoints, this.currentTime);
    if (!tp) return;
    this.pushUndo();
    bm.timingPoints = bm.timingPoints.filter(p => p !== tp);
    if (!tp.uninherited) this.selectedGreenLines.delete(tp.time);
    this.emit();
  }

  /** 重新对齐 (stable Resnap): 'current' = 当前红线段内物件, 'all' = 全部物件;
   *  time/endTime 吸附到物件生效红线的节拍网格 (当前节拍吸附细分), 一次 undo */
  timingResnap(scope: 'current' | 'all') {
    const bm = this.beatmap; if (!bm || !bm.hitObjects.length) return;
    const snap = this.beatSnap;
    let lo = -Infinity, hi = Infinity;
    if (scope === 'current') {
      const red = effectivePointAt(bm.timingPoints, this.currentTime, true);
      if (!red) return;
      lo = red.time;
      hi = bm.timingPoints.find(p => p.uninherited && p.time > red.time)?.time ?? Infinity;
    }
    this.pushUndo();
    let n = 0;
    for (const o of bm.hitObjects) {
      if (o.time < lo || o.time >= hi) continue;
      const red = effectivePointAt(bm.timingPoints, o.time, true);
      if (!red) continue;
      const nt = snapTimeToRedBeat(red, o.time, snap);
      const d = nt - o.time;
      if (!d) continue;
      o.time = nt;
      if (o.endTime !== undefined) o.endTime += d;
      n++;
    }
    if (n) bm.hitObjects.sort((a, b) => a.time - b.time);
    this.emit();
  }

  /** 整体平移所有物件的时间 (ms; endTime 同步平移), 一次 undo */
  timingShiftAll(ms: number) {
    const bm = this.beatmap; if (!bm || !isFinite(ms) || !ms) return;
    this.pushUndo();
    for (const o of bm.hitObjects) {
      o.time += ms;
      if (o.endTime !== undefined) o.endTime += ms;
    }
    this.emit();
  }

  /** 重新计算滑条长度 (全部滑条按节拍细分重吸附长度, stable 同款), 一次 undo */
  timingRecalcSliders() {
    const bm = this.beatmap; if (!bm) return;
    const sliders = bm.hitObjects.filter(o => o.type === 'slider');
    if (!sliders.length) return;
    this.pushUndo();
    for (const o of sliders) { resnapSliderLength(bm, o, bm.editor.beatDivisor); invalidatePath(o.id); }
    this.emit();
  }

  /** 删除所有 Timing 区间 (红+绿; 无红线时解析/渲染有时钟兜底) */
  timingDeleteAll() {
    const bm = this.beatmap; if (!bm || !bm.timingPoints.length) return;
    this.pushUndo();
    bm.timingPoints = [];
    this.selectedGreenLines.clear();
    this.emit();
  }

  /** 把当前位置设为预览点 ([General] PreviewTime) */
  timingSetPreview() {
    const bm = this.beatmap; if (!bm) return;
    this.pushUndo();
    bm.general.previewTime = Math.round(this.currentTime);
    this.emit();
  }

  /** 将全部选中物件/绿线在时间上前移/后移 ms (endTime 同步平移; v113 起选中绿线同步移动并按新 time 重键选区; v115: 锁定物件时跳过物件), 一次 undo; J/K 快捷键用 */
  nudgeSelected(ms: number) {
    if (!this.beatmap || !ms) return;
    const moveObjs = this.selected.size > 0 && !this.lockNotes;
    if (!moveObjs && !this.selectedGreenLines.size) return;
    this.pushUndo();
    if (moveObjs) {
      for (const o of this.beatmap.hitObjects) {
        if (!this.selected.has(o.id)) continue;
        o.time += ms;
        if (o.endTime !== undefined) o.endTime += ms;
      }
      this.beatmap.hitObjects.sort((a, b) => a.time - b.time);
    }
    if (this.selectedGreenLines.size) {
      const moved = new Set<number>();
      for (const tp of this.beatmap.timingPoints) {
        if (tp.uninherited || !this.selectedGreenLines.has(tp.time)) continue;
        tp.time += ms;
        moved.add(tp.time);
      }
      this.beatmap.timingPoints.sort((a, b) => a.time - b.time);
      this.selectedGreenLines = moved;
    }
    this.emit();
  }

  /** v55: 逐 px 移动选中物件 (Ctrl+方向键, stable 同款; 滑条控制点随头平移), 一次按键一次 undo */
  nudgeSelectedPosition(dx: number, dy: number) {
    if (!this.beatmap || !this.selected.size || (!dx && !dy) || this.lockNotes) return;
    this.pushUndo();
    for (const o of this.beatmap.hitObjects) {
      if (!this.selected.has(o.id)) continue;
      o.x += dx; o.y += dy;
      if (o.type === 'slider') {
        o.curvePoints?.forEach(p => { p.x += dx; p.y += dy; });
        invalidatePath(o.id);
      }
    }
    this.emit();
  }

  updateObject(o: HitObject) {
    if (!this.beatmap || this.lockNotes) return;
    const i = this.beatmap.hitObjects.findIndex(x => x.id === o.id);
    if (i >= 0) { this.beatmap.hitObjects[i] = o; this.beatmap.hitObjects.sort((a, b) => a.time - b.time); }
  }

  // 拖拽结束时调用(拖拽过程中直接改对象不存undo)
  commitDrag() { this.emit(); }
  beginDrag() { this.pushUndo(); }

  /** 画布拖拽进行中 (节点/物件移动/框选): 时间轴等外部组件此时应忽略鼠标交互, 避免拖动经过时误触 seek (非响应式标志, 不 emit) */
  canvasDragging = false;
  /** v70: 上时间轴鼠标下的红/绿线 (Timing 页签高亮对应行; 变化时经 emitSelection 通知) */
  timelineHoverTp: TimingPoint | null = null;

  // ---- 物件转换 (F1-F4: 转连打/拆分/合并/多边形/批量复制; v141: 曲线互转窗口已废弃) ----
  /** 当前打开的转换参数窗口 (null = 无) */
  conversionDialog: 'stream' | 'split' | 'merge' | 'polygon' | 'duplicate' | 'symSlider' | null = null; // v236: +'symSlider' 对称滑条
  /** 转换实时预览: hideIds = 被替换的源物件 (渲染时隐藏), objects = 转换结果 (幽灵渲染); timingPoints = v68 绿线副本预览; 预览不碰谱面数据 */
  conversionPreview: { hideIds: number[]; objects: HitObject[]; timingPoints?: TimingPoint[] } | null = null;
  // ---- v68: 批量复制向量箭头 (DuplicateDialog 写入, 画布绘制/拖拽; 非响应式, 画布每帧读取) ----
  /** 向量箭头视图: 锚 = 第一批(源)物件结尾 (最后源物件尾端), 头 = 锚 + 每份向量 */
  dupVectorView: { anchor: { x: number; y: number }; dx: number; dy: number } | null = null;
  /** 拖动箭头头时回写参数 (由 DuplicateDialog 注册) */
  dupVectorDragHandler: ((dx: number, dy: number) => void) | null = null;
  // ---- v236: 对称滑条自定义锚点圈 (SymSliderDialog 写入, 画布绘制/拖拽; 非响应式, 画布每帧读取, dupVector 同款模式) ----
  /** 自定义锚点圈视图 (point/rotate/translate 且 anchor='custom' 时非 null) */
  symSliderAnchorView: { x: number; y: number } | null = null;
  /** 拖动锚点圈时回写弹窗参数 (由 SymSliderDialog 注册) */
  symSliderAnchorDragHandler: ((x: number, y: number) => void) | null = null;
  /** v236 二轮修正: 自定义对称轴两点视图 (axis 且 axisDir='custom' 时非 null; 同上半响应式模式) */
  symSliderAxisView: { p1: { x: number; y: number }; p2: { x: number; y: number } } | null = null;
  /** 拖动对称轴端点时回写弹窗参数 (由 SymSliderDialog 注册, which = 端点序号 1/2) */
  symSliderAxisDragHandler: ((which: 1 | 2, x: number, y: number) => void) | null = null;

  openConversion(d: NonNullable<EditorStore['conversionDialog']>) { this.conversionDialog = d; this.emitSelection(); }
  /** 关闭转换窗口 (清除预览; 不应用) */
  closeConversion() { this.conversionDialog = null; this.conversionPreview = null; this.emitSelection(); }

  // ---- v63: 红线/绿线弹窗 (上时间轴 +红/+绿 插入 与 双击 BPM/SV 胶囊编辑 共用, 显示 .osu 行全部参数) ----
  timingPointDialog: { mode: 'add' | 'edit'; index: number; draft: TimingPoint } | null = null;
  openTimingPointDialog(mode: 'add' | 'edit', index: number, draft: TimingPoint) {
    this.timingPointDialog = { mode, index, draft: { ...draft } };
    this.emit();
  }
  closeTimingPointDialog() { this.timingPointDialog = null; this.emit(); }
  /** 应用弹窗草稿: edit 替换原行 / add 插入新行 (一次 undo) */
  applyTimingPointDialog(draft: TimingPoint) {
    const bm = this.beatmap; const dlg = this.timingPointDialog;
    if (!bm || !dlg) return;
    this.pushUndo();
    if (dlg.mode === 'edit' && dlg.index >= 0 && dlg.index < bm.timingPoints.length) bm.timingPoints[dlg.index] = { ...draft };
    else bm.timingPoints.push({ ...draft });
    bm.timingPoints.sort((a, b) => a.time - b.time);
    this.timingPointDialog = null;
    this.emit();
  }
  /** 弹窗内删除 (edit 模式) */
  removeTimingPointAt(index: number) {
    const bm = this.beatmap;
    if (!bm) return;
    this.pushUndo();
    bm.timingPoints.splice(index, 1);
    this.timingPointDialog = null;
    this.emit();
  }

  /** 更新转换预览 (参数变化时实时调用; 走 emitSelection 不重建 hitsound 事件表) */
  setConversionPreview(p: { hideIds: number[]; objects: HitObject[]; timingPoints?: TimingPoint[] } | null) { this.conversionPreview = p; this.emitSelection(); }
  /** 应用转换: 删除源物件 + 插入结果物件 (+ v68 可选绿线副本; 一次 undo), 选中结果物件, 关闭窗口 */
  applyConversion(removeIds: number[], add: HitObject[], addTiming: TimingPoint[] = []) {
    if (!this.beatmap) return;
    if (this.lockNotes && removeIds.length) return; // v115: 锁定物件 (纯新增的批量复制 removeIds 为空, 不受影响)
    this.pushUndo();
    const rm = new Set(removeIds);
    this.beatmap.hitObjects = this.beatmap.hitObjects.filter(o => !rm.has(o.id)).concat(add);
    this.beatmap.hitObjects.sort((a, b) => a.time - b.time);
    if (addTiming.length) {
      this.beatmap.timingPoints = this.beatmap.timingPoints.concat(addTiming.map(t => ({ ...t })));
      this.beatmap.timingPoints.sort((a, b) => a.time - b.time);
    }
    removeIds.forEach(id => invalidatePath(id));
    this.selected = new Set(add.map(o => o.id));
    this.conversionPreview = null;
    this.conversionDialog = null;
    this.emit();
  }

  copy() {
    if (!this.beatmap || (!this.selected.size && !this.selectedGreenLines.size)) return;
    const objs = this.beatmap.hitObjects.filter(o => this.selected.has(o.id));
    const greens = this.beatmap.timingPoints.filter(tp => !tp.uninherited && this.selectedGreenLines.has(tp.time));
    if (!objs.length && !greens.length) return;
    // v102: 物件与绿线共用一个时间原点 (全体最早者), 粘贴时保持相对时序
    const t0 = Math.min(...objs.map(o => o.time), ...greens.map(tp => tp.time));
    // v113: endTime 同样转为相对时间 — 旧逻辑只平移 time, 复制的转盘粘贴后 endTime 仍是原绝对时刻
    this.clipboard = deepCopy(objs).map(o => {
      const c = { ...o, time: o.time - t0 };
      if (c.endTime !== undefined) c.endTime -= t0;
      return c;
    });
    this.clipboardGreens = deepCopy(greens).map(tp => ({ ...tp, time: tp.time - t0 }));
    this.emitSelection(); // v209: 编辑菜单「粘贴」置灰依赖 hasClipboard, 复制后刷新订阅者
  }

  paste(atTime: number) {
    if (!this.beatmap || (!this.clipboard.length && !this.clipboardGreens.length)) return;
    this.pushUndo();
    this.selected.clear();
    this.selectedGreenLines.clear();
    // v196: 取整 round → floor — 底部时间戳 fmt 用 floor 显示, 用户按显示时刻粘贴 (如节拍吸附产生
    // 的 55749.507 显示 0:55.749, round 会落到 55750 与显示/既有线不符); floor 后粘贴时刻 == 显示时刻。
    // 与放置 (round 吸附) 的关系: round(f) ≥ floor(f), 物件恒不早于同刻粘贴的绿线, timingAt 不会取错 SV。
    for (const c of this.clipboard) {
      const o = deepCopy(c);
      o.id = genId();
      // v113: 物件时间与绿线同一路径取整 (v196 统一为 floor, 见上)
      o.time = Math.floor(c.time + atTime);
      if (o.endTime !== undefined && c.endTime !== undefined) o.endTime = Math.floor(c.endTime + atTime);
      this.beatmap.hitObjects.push(o);
      this.selected.add(o.id);
    }
    // v102: 绿线粘贴 — 目标时刻已有绿线则覆盖其参数 (与拖入新线替换语义一致), 否则插入
    for (const c of this.clipboardGreens) {
      const t = Math.floor(c.time + atTime);
      const existing = this.beatmap.timingPoints.find(tp => !tp.uninherited && Math.round(tp.time) === t);
      if (existing) Object.assign(existing, deepCopy(c), { time: t });
      else this.beatmap.timingPoints.push({ ...deepCopy(c), time: t });
      this.selectedGreenLines.add(t);
    }
    this.beatmap.hitObjects.sort((a, b) => a.time - b.time);
    this.beatmap.timingPoints.sort((a, b) => a.time - b.time);
    this.emit();
  }

  select(ids: number[], additive = false) {
    if (!additive) { this.rememberGeoSelection(); this.selected.clear(); this.selectedGreenLines.clear(); this.selectedNodes.clear(); this.selectedEdges.clear(); }
    ids.forEach(i => this.selected.add(i));
    this.emitSelection();
  }

  toggleSelect(id: number) {
    this.rememberGeoSelection();
    if (this.selected.has(id)) { this.selected.delete(id); this.selectedNodes.delete(id); this.selectedEdges.delete(id); }
    else this.selected.add(id);
    this.emitSelection();
  }

  clearSelection() {
    if (this.selected.size || this.selectedGreenLines.size || this.selectedNodes.size || this.selectedEdges.size) {
      this.rememberGeoSelection(); this.selected.clear(); this.selectedGreenLines.clear(); this.selectedNodes.clear(); this.selectedEdges.clear(); this.emitSelection();
    }
  }

  // ---- v117: 滑条节点选区 (Alt 层; objId -> 控制点下标集, 0=头; 物件选区变更时联动清空) ----
  selectedNodes = new Map<number, Set<number>>();

  get nodeSelectionCount(): number {
    let n = 0;
    for (const s of this.selectedNodes.values()) n += s.size;
    return n;
  }

  /** 设定节点选区 (空下标集自动剔除; 节点被选中的滑条自动并入物件选区 — 节点层是物件选区的细化) */
  setSelectedNodes(entries: Iterable<[number, number]>) {
    const m = new Map<number, Set<number>>();
    for (const [objId, idx] of entries) {
      let s = m.get(objId);
      if (!s) m.set(objId, (s = new Set()));
      s.add(idx);
    }
    for (const id of m.keys()) this.selected.add(id);
    this.selectedNodes = m;
    this.emitSelection();
  }

  /** Alt+Shift/Ctrl 点选: 加选/减选单个节点 (加选时滑条自动并入物件选区) */
  toggleSelectedNode(objId: number, idx: number) {
    const m = new Map(this.selectedNodes);
    let s = m.get(objId);
    if (s?.has(idx)) {
      s = new Set(s);
      s.delete(idx);
      if (s.size) m.set(objId, s); else m.delete(objId);
    } else {
      m.set(objId, new Set([...(s ?? []), idx]));
      this.selected.add(objId);
    }
    this.selectedNodes = m;
    this.emitSelection();
  }

  clearNodeSelection() {
    if (!this.selectedNodes.size) return;
    this.selectedNodes.clear();
    this.emitSelection();
  }

  // ---- v213: 时间轴滑条节点 (头/折返点/尾) 音效选区 (objId -> 端点下标集, 0=头 slides=尾; stable 同款) ----
  // 与物件选区共存: 节点被选中的滑条保留在 selected 中 (J/K/删除等物件级操作照常), W/E/R 路由到节点级
  selectedEdges = new Map<number, Set<number>>();

  get edgeSelectionCount(): number {
    let n = 0;
    for (const s of this.selectedEdges.values()) n += s.size;
    return n;
  }

  isEdgeSelected(objId: number, edge: number): boolean { return this.selectedEdges.get(objId)?.has(edge) ?? false; }

  /** 选中滑条节点 (非加选 = 替换; additive = 同物件内加选/减选, 跨物件则切换)。宿主滑条自动并入物件选区 */
  selectEdges(objId: number, edges: number[], additive = false) {
    if (additive && this.selectedEdges.size === 1 && this.selectedEdges.has(objId)) {
      const s = new Set(this.selectedEdges.get(objId));
      for (const e of edges) { if (s.has(e)) s.delete(e); else s.add(e); }
      if (s.size) this.selectedEdges = new Map([[objId, s]]);
      else this.selectedEdges = new Map();
    } else {
      this.selectedEdges = new Map(edges.length ? [[objId, new Set(edges)]] : []);
      if (edges.length) { this.rememberGeoSelection(); this.selected = new Set([objId]); this.selectedGreenLines.clear(); this.selectedNodes.clear(); }
    }
    this.emitSelection();
  }

  clearEdgeSelection() {
    if (!this.selectedEdges.size) return;
    this.selectedEdges = new Map();
    this.emitSelection();
  }

  /** v102: 选中绿线 (非加选时清空物件选区 — 单一选择模型; additive 供框选组合) */
  selectGreenLines(times: number[], additive = false) {
    if (!additive) { this.rememberGeoSelection(); this.selected.clear(); this.selectedGreenLines.clear(); this.selectedNodes.clear(); this.selectedEdges.clear(); }
    times.forEach(t => this.selectedGreenLines.add(t));
    this.emitSelection();
  }

  /** v157: timing 面板勾选绿线 — 切换单条选中状态, 不动物件选区 (与上时间轴药丸选区共享同一集合) */
  toggleGreenLineSelected(time: number) {
    if (this.selectedGreenLines.has(time)) this.selectedGreenLines.delete(time);
    else this.selectedGreenLines.add(time);
    this.emitSelection();
  }

  /** v157: 批量修改选中绿线属性 (timing 面板批量编辑栏; patch 不含 time/uninherited; 一次 undo) */
  updateGreenLinesAt(times: Iterable<number>, patch: Partial<TimingPoint>) {
    const bm = this.beatmap; if (!bm) return;
    const ts = new Set(times);
    if (!ts.size) return;
    this.pushUndo();
    for (const tp of bm.timingPoints) if (!tp.uninherited && ts.has(tp.time)) Object.assign(tp, patch);
    this.emit();
  }

  /** v102: 框选同时设定物件 + 绿线选区 (两类各自的 base 已在调用方合并) */
  selectWithGreens(ids: number[], greenTimes: number[]) {
    this.rememberGeoSelection();
    this.selected = new Set(ids);
    this.selectedGreenLines = new Set(greenTimes);
    this.selectedNodes.clear();
    this.selectedEdges.clear();
    this.emitSelection();
  }

  // ---- 选区几何变换 (旋转/镜像/缩放; 一次操作一次 undo) ----
  // 原点三种模式 (lazer SelectionRotationHandler 的 origin 参数语义):
  //  'selection' = 选区包围盒中心, 'playfield' = 游玩区中心 (256,192), {x,y} = 自定义位置
  // 原点模式与自定义点是 UI 状态 (不进 undo): Inspector 与画布标记共用, 画布上可拖拽
  originMode: 'selection' | 'playfield' | 'custom' = 'selection';
  customOrigin: Pt = { x: 256, y: 192 };

  setOriginMode(m: 'selection' | 'playfield' | 'custom') { this.originMode = m; this.emitSelection(); }
  /** 更新自定义原点 (Inspector 输入 / 画布拖拽共用; 不钳制, 允许在游玩区外) */
  setCustomOrigin(p: Pt) { this.customOrigin = { x: Math.round(p.x), y: Math.round(p.y) }; this.emitSelection(); }
  /** 当前生效的变换原点 (custom 时取 customOrigin) */
  currentOrigin(): TransformOrigin { return this.originMode === 'custom' ? this.customOrigin : this.originMode; }

  // v166: 批量复制弹窗独立原点 — 与左侧栏变换(选区)各用一套, 互不影响 (弹窗勾选自定义不再改动 originMode)
  dupOriginMode: 'selection' | 'playfield' | 'custom' = 'selection';
  dupCustomOrigin: Pt = { x: 256, y: 192 };

  setDupOriginMode(m: 'selection' | 'playfield' | 'custom') { this.dupOriginMode = m; this.emitSelection(); }
  setDupCustomOrigin(p: Pt) { this.dupCustomOrigin = { x: Math.round(p.x), y: Math.round(p.y) }; this.emitSelection(); }
  /** 批量复制当前生效原点 (custom 时取 dupCustomOrigin) */
  currentDupOrigin(): TransformOrigin { return this.dupOriginMode === 'custom' ? this.dupCustomOrigin : this.dupOriginMode; }

  private selectedObjects() {
    return this.beatmap ? this.beatmap.hitObjects.filter(o => this.selected.has(o.id)) : [];
  }

  private resolveOrigin(origin: TransformOrigin, objs: HitObject[]): Pt | null {
    if (origin === 'playfield') return { x: 256, y: 192 };
    if (origin === 'selection') return selectionCenter(objs); // 空选区或只选转盘 -> null
    return origin;
  }

  private applyTransform(fn: (objs: HitObject[], c: Pt) => HitObject[], origin: TransformOrigin = 'selection') {
    if (this.lockNotes) return; // v115: 锁定物件
    const objs = this.selectedObjects();
    const c = this.resolveOrigin(origin, objs);
    if (!c) return; // 空选区或只选了转盘 (位置固定不可变换)
    this.pushUndo();
    for (const s of fn(objs, c)) invalidatePath(s.id);
    this.emit();
  }

  /** 旋转选区 (角度制, 顺时针为正; origin 默认选区中心) */
  rotateSelected(deg: number, origin: TransformOrigin = 'selection') { this.applyTransform((objs, c) => rotateObjects(objs, c, deg), origin); }
  /** 镜像选区: 'h' 水平 (左右) / 'v' 垂直 (上下); origin 默认选区中心 */
  flipSelected(axis: 'h' | 'v', origin: TransformOrigin = 'selection') { this.applyTransform((objs, c) => flipObjects(objs, c, axis), origin); }
  /** 等比缩放选区 (滑条 pixelLength 同步缩放); origin 默认选区中心 */
  scaleSelected(s: number, origin: TransformOrigin = 'selection') { if (s > 0) this.applyTransform((objs, c) => scaleObjects(objs, c, s), origin); }

  /** v75: 反转选区 (lazer Ctrl+G): 多选时间镜像 + 滑条路径反向 + newCombo 时序保持; 单选非滑条无操作; 一次 undo */
  reverseSelected() {
    const bm = this.beatmap;
    if (!bm || this.lockNotes) return; // v115: 锁定物件
    const objs = this.selectedObjects();
    if (objs.length === 0) return;
    if (objs.length === 1 && objs[0].type !== 'slider') return; // lazer CanReverse: 选中 >1 或任一滑条
    this.pushUndo();
    for (const s of reverseSelection(bm, objs)) invalidatePath(s.id);
    bm.hitObjects.sort((a, b) => a.time - b.time);
    this.emit();
  }

  // ---- hitsound / newCombo 编辑 (lazer/stable 同款 Q/W/E/R 快捷键与 Inspector 共用; 一次操作一次 undo) ----
  // 只改数据不改几何: emit() bump dataVersion -> hitsound 事件表自动重建, 滑条路径缓存无需失效

  private applyToSelected(fn: (o: HitObject) => void) {
    if (this.lockNotes) return; // v115: 锁定物件
    const objs = this.selectedObjects();
    if (!objs.length) return;
    this.pushUndo();
    objs.forEach(fn);
    this.emit();
  }

  /** 切换全部选中物件的 hitSound 位标志 (2=whistle 4=finish 8=clap); v114: lazer DrawableTernaryButton.Toggle 语义 — 未全有则全部置位, 全有才全部清位 (混合选区不再各自翻转) */
  toggleSelectedHitSound(bit: number) {
    const objs = this.selectedObjects();
    if (!objs.length) return;
    this.setSelectedHitSoundBit(bit, !objs.every(o => ((o.hitSound ?? 0) & bit) !== 0));
  }
  /** 切换全部选中物件的 newCombo 位 (ComboSkip 不动); v114: 同上三态语义 */
  toggleSelectedNewCombo() {
    const objs = this.selectedObjects();
    if (!objs.length) return;
    const on = !objs.every(o => !!o.newCombo);
    this.applyToSelected(o => { o.newCombo = on; });
  }
  /** 批量设置选中物件的 hitSound 位 (Inspector checkbox: 统一置位/清位) */
  setSelectedHitSoundBit(bit: number, on: boolean) {
    // v213: 滑条 edge 串已 materialize 时同步所有段 (stable: 整条选中时音效作用到所有节点;
    //       否则显式段会盖掉物件级回落, 快捷键静默失效)
    this.applyToSelected(o => {
      o.hitSound = on ? (o.hitSound ?? 0) | bit : (o.hitSound ?? 0) & ~bit;
      if (o.edgeSoundsRaw !== undefined) setEdgeSoundBitAll(o, bit, on);
    });
  }

  /** v213: 切换时间轴选中的滑条节点 (头/折返点/尾) 的 hitSound 位; 一次 undo */
  toggleEdgeHitSound(bit: number) {
    if (this.lockNotes || !this.beatmap || !this.selectedEdges.size) return;
    const targets: { o: HitObject; edge: number }[] = [];
    for (const [objId, edges] of this.selectedEdges) {
      const o = this.beatmap.hitObjects.find(x => x.id === objId);
      if (o?.type !== 'slider') continue;
      for (const edge of edges) targets.push({ o, edge });
    }
    if (!targets.length) return;
    this.pushUndo();
    toggleEdgesHitSound(targets, bit);
    this.emit();
  }
  /** 批量改选中物件的 hitSample 字段; 保留 filename; 全默认且无 filename 时省略该段 */
  applyHitSampleToSelected(patch: Partial<HitSample>) {
    this.applyToSelected(o => {
      o.hitSampleRaw = buildHitSampleRaw({ ...parseHitSample(o.hitSampleRaw), ...patch }, hitSampleFilename(o.hitSampleRaw));
    });
  }

  // ---- v209: 编辑菜单 (Electron 原生「编辑」菜单 + 配套快捷键; stable 编辑菜单对齐) ----

  /** 全选所有物件 (Ctrl+A / 编辑菜单; 绿线/节点选区一并清空) */
  selectAllObjects() {
    if (!this.beatmap) return;
    this.select(this.beatmap.hitObjects.map(o => o.id));
  }

  /** 剪切 = 复制 + 删除选中 (Ctrl+X; 一次 undo 由 deleteSelected 提供; 物件与选中绿线同剪) */
  cut() {
    if (!this.beatmap || (!this.selected.size && !this.selectedGreenLines.size)) return;
    this.copy();
    this.deleteSelected();
  }

  /** 剪贴板是否有内容 (编辑菜单「粘贴」置灰用) */
  hasClipboard(): boolean { return this.clipboard.length > 0 || this.clipboardGreens.length > 0; }

  /** J/K 前移/后移选中物件一个当前节拍吸附 (App 快捷键与编辑菜单共用同一实现) */
  nudgeSelectedBySnap(dir: -1 | 1) {
    const bm = this.beatmap; if (!bm) return;
    const { red } = timingAt(bm.timingPoints, this.currentTime);
    this.nudgeSelected(Math.round(red.beatLength / this.beatSnap) * dir);
  }

  /** 清除选中/全部物件的音效 (stable 编辑菜单): hitSound 位清零 + hitSample/滑条边缘音效回默认 (序列化省略即默认) */
  clearHitSounds(scope: 'selected' | 'all') {
    const bm = this.beatmap; if (!bm || this.lockNotes) return;
    const objs = scope === 'selected' ? this.selectedObjects() : bm.hitObjects;
    if (!objs.length) return;
    this.pushUndo();
    for (const o of objs) { o.hitSound = 0; o.hitSampleRaw = undefined; o.edgeSoundsRaw = undefined; o.edgeSetsRaw = undefined; }
    this.emit();
  }

  /** 重置 combo 组颜色 (stable): 清除全部物件的 newCombo/comboSkip 位, combo 颜色回到从头顺序循环 */
  resetComboFlags() {
    const bm = this.beatmap; if (!bm || this.lockNotes || !bm.hitObjects.length) return;
    this.pushUndo();
    for (const o of bm.hitObjects) { o.newCombo = false; o.comboSkip = 0; }
    this.emit();
  }

  /** 重置休息时段 (stable): 删除 [Events] 原文中的全部 break 行 (2,start,end / Break,start,end; 注释行保留) */
  resetBreaks() {
    const bm = this.beatmap; if (!bm) return;
    const ev = bm.rawSections?.['Events'];
    if (!ev) return;
    const filtered = ev.filter(l => !/^\s*(2|Break)\s*,/.test(l));
    if (filtered.length === ev.length) return; // 无 break 不动作 (不产生 undo/脏标记)
    this.pushUndo();
    bm.rawSections!['Events'] = filtered;
    this.emit();
  }

  /** 旋转/缩放独立窗口 (编辑菜单「旋转...」「缩放...」; 功能复制自左侧栏变换面板, 左侧栏保留) */
  transformDialog: 'rotate' | 'scale' | 'symmetry' | null = null;
  openTransformDialog(m: 'rotate' | 'scale' | 'symmetry') { if (!this.selected.size) return; this.transformDialog = m; this.emitSelection(); }
  closeTransformDialog() { if (this.transformDialog) { this.transformDialog = null; this.emitSelection(); } }

  // ---- v210: 对称窗口 (编辑菜单「对称...」, 无快捷键): 选区关于一条直线镜像 ----
  /** 对称轴模式: 选区 = 过选区中心的竖直/水平线; 中心 = 过游玩区中心 (256,192); 自定义 = symP1/symP2 两点决定的直线 */
  symAxisMode: 'selection' | 'center' | 'custom' = 'selection';
  /** 选区/中心模式的轴向: v = 竖直线 (左右镜像), h = 水平线 (上下镜像) */
  symAxisDir: 'v' | 'h' = 'v';
  /** 自定义对称轴端点 (画布渲染/拖拽共用, 与自定义原点同款模式) */
  symP1: Pt = { x: 176, y: 192 };
  symP2: Pt = { x: 336, y: 192 };
  setSymAxisMode(m: 'selection' | 'center' | 'custom') { this.symAxisMode = m; this.emitSelection(); }
  setSymAxisDir(d: 'v' | 'h') { this.symAxisDir = d; this.emitSelection(); }
  /** 自定义对称轴端点拖拽/输入: 两点最小间距 4 osu px (无法拖到同个位置 — 过近时沿拖拽方向钳到最小距离) */
  setSymPoint(i: 1 | 2, p: Pt) {
    const other = i === 1 ? this.symP2 : this.symP1;
    let dx = p.x - other.x, dy = p.y - other.y;
    let d = Math.hypot(dx, dy);
    if (d < 4) {
      if (d < 1e-6) { dx = 1; dy = 0; d = 1; } // 完全重合: 取 +x 方向顶开
      p = { x: other.x + (dx / d) * 4, y: other.y + (dy / d) * 4 };
    }
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    if (i === 1) this.symP1 = q; else this.symP2 = q;
    this.emitSelection();
  }
  /** 当前对称轴线上两点 (按模式换算; 选区模式无有效选区/只选转盘时返回 null) */
  symAxisLine(): { p1: Pt; p2: Pt } | null {
    if (this.symAxisMode === 'custom') return { p1: this.symP1, p2: this.symP2 };
    const c = this.symAxisMode === 'center' ? { x: 256, y: 192 } : selectionCenter(this.selectedObjects());
    if (!c) return null;
    return this.symAxisDir === 'v'
      ? { p1: { x: c.x, y: 0 }, p2: { x: c.x, y: 1 } }
      : { p1: { x: 0, y: c.y }, p2: { x: 1, y: c.y } };
  }
  /** 应用对称 (选区关于对称轴镜像; 一次应用一次 undo) */
  reflectSelected() {
    if (this.lockNotes) return;
    const objs = this.selectedObjects();
    if (!objs.length || !selectionCenter(objs)) return; // 空选区或只选转盘 (位置固定不参与变换)
    const line = this.symAxisLine();
    if (!line) return;
    this.pushUndo();
    for (const s of reflectObjectsAcrossLine(objs, line.p1, line.p2)) invalidatePath(s.id);
    this.emit();
  }

  seek(t: number) {
    t = Math.max(0, t);
    if (this.playing) {
      // 播放中seek: 先暂停(避免位置被回放), 重启 source 重新锚定时钟
      this.pause();
      this.currentTime = t;
      this.play();
      return;
    }
    this.currentTime = t;
    this.clock?.onSeekPaused(t);
    this.scheduler?.setMuted(false);
    if (this.audio && Math.abs(this.audio.currentTime * 1000 - t) > 40) {
      this.audio.currentTime = t / 1000;
    }
    this.emit();
  }

  // ---- v193: 滚轮 seek (对齐 lazer Editor.OnScroll + EditorClock.seek) ----
  private wheelAccum: WheelAccum = { acc: 0 }; // lazer Editor.scrollAccumulation (三处滚轮入口共享)

  /**
   * 滚轮 seek 总入口 (游玩区/上时间轴/下时间轴共用):
   *  - 累积增量到 1 刻度 (120px, lazer precision=1) 才触发, 触摸板精密滚动不再每事件都 seek;
   *  - 暂停: 每步沿方向吸附一个 1/beatSnap 网格点 (seekByBeats, v179 语义);
   *  - 播放中: 不吸附, 步长 = BeatLength × BPM/120 × (1+250/(int)BeatLength), 轻量重定位 (不 pause/play)。
   */
  wheelSeek(deltaY: number, deltaMode: number) {
    const bm = this.beatmap;
    if (!bm) return;
    const steps = wheelSteps(this.wheelAccum, deltaY, deltaMode);
    if (!steps) return;
    if (this.playing) {
      const step = playingWheelStepMs(bm.timingPoints, this.currentTime);
      this.seekWhilePlaying(this.positionMs() + steps * step);
      return;
    }
    let t = this.currentTime;
    const dir = steps > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(steps); i++) t = seekByBeats(bm.timingPoints, this.beatSnap, t, dir);
    this.seek(t);
  }

  /**
   * 播放中轻量 seek (lazer: 播放中 seek 不 stop/start 轨道, 直接 ChannelSetPosition):
   * WebAudio 的 AudioBufferSourceNode 无法重定位, 用即时重建模拟 — 无 20ms 启动延迟;
   * v226: 防咔哒改回硬切换 (统一切换时刻 + 2ms 防爆音斜坡) — v216 交叉淡变在滚轮
   * 连击时多份"同曲不同进度"链式重叠发声, 听感 = 持续降质 (双重曝光/响度抽动);
   * v216: 防咔哒不再 dip 共享音乐总线 (滚轮连击时总线增益被反复瞬时拉零,
   * 且 cancelScheduledValues 会截断恢复斜坡, 听感 = 全轨断续发闷);
   * v198: hitsound voices 全停 (lazer seek 期间静音采样) — 否则 lookahead 内已排程的
   * 旧区间音效会照原时刻补响, 听感 = 滚过的物件 hitsound 全部补播。
   */
  seekWhilePlaying(t: number) {
    if (!this.playing) { this.seek(t); return; }
    t = Math.max(0, Math.min(t, this.songLength()));
    this.currentTime = t;
    if (this.audioBuffer && this.actx && this.clock) {
      const actx = this.actx;
      const offset = t / 1000;
      if (offset >= this.audioBuffer.duration) {
        this.pause();
        this.currentTime = this.songLength();
        this.emit();
        return;
      }
      const now = actx.currentTime;
      // v226: 硬切换 + 极短防爆音斜坡 — 取代 v216 交叉淡变。
      // v216 的 ~10-20ms 交叉淡变在单次 seek 不可闻, 但滚轮连击时链式重叠:
      // 任意瞬间 2~4 份"同曲不同进度"同时发声 (播放中步长 ~0.5s/格),
      // 听感 = 持续的双重曝光/响度抽动 (用户反馈: 播放中滚滚轮仍降质, 点时间轴不复现
      // — 后者走 pause/play 零重叠硬切)。改为统一切换时刻 startW: 旧源 2ms 斜降到 0,
      // 新源 startW 启动 2ms 斜升到 1, 重叠窗 ~2ms (仅防爆音咔哒), 听感 = 即时跳位。
      const startW = now + 0.003;
      const bus = this.ensureMusicBus();
      if (this.tempoActive && this.tempoNode) {
        // v226: 变速支路 dip 贴紧切换点单次短窗 (~5ms), 不再"立即拉零 + 延迟恢复"
        if (this.tempoGain) {
          const tg = this.tempoGain.gain;
          tg.cancelScheduledValues(now);
          tg.setValueAtTime(tg.value, now);
          tg.linearRampToValueAtTime(0, startW);
          tg.linearRampToValueAtTime(1, startW + 0.002);
        }
        this.tempoNode.schedule({ output: startW, input: offset, rate: this.playbackRate, active: true });
        if (this.tempoEndTimer) { clearTimeout(this.tempoEndTimer); this.tempoEndTimer = null; }
        const endCtx = startW + (this.audioBuffer.duration - offset) / this.playbackRate;
        this.tempoEndTimer = setTimeout(() => {
          this.tempoEndTimer = null;
          if (this.tempoNode) { try { this.tempoNode.stop(); } catch { /* noop */ } }
          if (this.tempoActive && this.playing) {
            this.playing = false;
            this.tempoActive = false;
            this.currentTime = this.songLength();
            this.emit();
          }
        }, Math.max(0, (endCtx - actx.currentTime) * 1000 + 50));
      } else {
        // v226: 硬切换 — 旧源 2ms 斜降到 0 后停止, 新源 startW 启动 2ms 斜升到 1, 重叠 ~2ms
        if (this.source) {
          try { this.source.onended = null; } catch { /* noop */ }
          if (this.sourceGain) {
            const og = this.sourceGain.gain;
            og.cancelScheduledValues(now);
            og.setValueAtTime(og.value, now);
            og.linearRampToValueAtTime(0, startW + 0.002);
          }
          try { this.source.stop(startW + 0.01); } catch { /* noop */ }
        }
        const src = actx.createBufferSource();
        src.buffer = this.audioBuffer;
        src.playbackRate.value = this.playbackRate;
        const sg = actx.createGain();
        sg.gain.setValueAtTime(0, now);
        sg.gain.linearRampToValueAtTime(1, startW + 0.002);
        src.connect(sg);
        sg.connect(bus);
        src.start(startW, offset);
        src.onended = () => {
          if (this.source === src) { this.playing = false; this.source = null; this.currentTime = this.songLength(); this.emit(); }
        };
        this.source = src;
        this.sourceGain = sg;
      }
      this.clock.onStartedAtCtxTime(startW, t);
      this.rebuildEventsIfDirty();
      this.stopAllHitVoices(); // v198: 停掉旧区间已预排程的 hitsound, resync 只重排 >= now 的事件
      this.scheduler?.resync();
      this.resyncLoops();
    } else if (this.audio) {
      this.audio.currentTime = t / 1000;
    }
    this.emit();
  }

  play() {
    this.playing = true;
    if (this.audioBuffer) {
      const clock = this.ensureClock();
      this.actx!.resume().catch(() => { });
      this.stopSource();
      const offset = this.currentTime / 1000;
      if (offset >= this.audioBuffer.duration) { this.playing = false; this.emit(); return; }
      // 确定性锚定: 延迟 20ms 启动, W 时刻谱面位置精确 = currentTime
      const startW = this.actx!.currentTime + 0.02;
      if (this.playbackRate !== 1 && this.tempoNode) {
        // 变速不变调 (lazer AudioAdjustments.Tempo): signalsmith-stretch 引擎.
        // schedule 锚点 = AudioContext 时间线, 与 source.start(startW, offset) 同一语义;
        // 节点自补偿内部延迟 (120ms), 每块按映射重定位, 无漂移
        this.tempoNode.schedule({ output: startW, input: offset, rate: this.playbackRate, active: true });
        // 播完: 定时器走原播完逻辑 (signalsmith 节点无 ended 回执), 到点再 stop 节点省 CPU.
        // 注意不能提前 schedule 一个未来 stop: 其"清除其后所有排程"语义会把未来 start 一并丢弃
        const endCtx = startW + (this.audioBuffer.duration - offset) / this.playbackRate;
        this.tempoEndTimer = setTimeout(() => {
          this.tempoEndTimer = null;
          if (this.tempoNode) { try { this.tempoNode.stop(); } catch { /* noop */ } }
          if (this.tempoActive && this.playing) {
            this.playing = false;
            this.tempoActive = false;
            this.currentTime = this.songLength();
            this.emit();
          }
        }, Math.max(0, (endCtx - this.actx!.currentTime) * 1000 + 50));
        this.tempoActive = true;
      } else {
        if (this.playbackRate !== 1 && !this.tempoNode) {
          // worklet 未就绪: 本次退回 playbackRate (变调), 就绪后自动重进不变调引擎
          this.ensureTempoNode();
          this.tempoLoading?.then(() => {
            if (this.playing && this.playbackRate !== 1 && this.tempoNode && !this.tempoActive) { this.pause(); this.play(); }
          });
        }
        const src = this.actx!.createBufferSource();
        src.buffer = this.audioBuffer;
        src.playbackRate.value = this.playbackRate;
        const sg = this.actx!.createGain(); // v216: per-source 增益 (seek 交叉淡变/启动防咔哒)
        sg.gain.setValueAtTime(0, this.actx!.currentTime);
        sg.gain.setTargetAtTime(1, startW, 0.003);
        src.connect(sg);
        sg.connect(this.ensureMusicBus()); // v144: 经音乐总线 (音量设置)
        src.start(startW, offset);
        src.onended = () => {
          if (this.source === src) { this.playing = false; this.source = null; this.currentTime = this.songLength(); this.emit(); }
        };
        this.source = src;
        this.sourceGain = sg;
      }
      clock.rate = this.playbackRate;
      clock.onStartedAtCtxTime(startW, this.currentTime);
      this.rebuildEventsIfDirty();
      this.scheduler?.resync();
      this.scheduler?.setMuted(false);
      this.resyncLoops();
    } else if (this.audio) {
      this.audio.currentTime = this.currentTime / 1000;
      this.audio.playbackRate = this.playbackRate;
      this.audio.play().catch(() => { });
    }
    this.emit();
  }

  pause() {
    if (this.playing && this.audioBuffer && this.clock) {
      this.currentTime = this.clock.onStopped();
      this.scheduler?.setMuted(true);
    } else if (this.playing) {
      this.currentTime = this.positionMs();
    }
    this.playing = false;
    this.stopSource();
    this.stopSlideLoops();
    this.audio?.pause();
    this.emit();
  }

  togglePlay() { this.playing ? this.pause() : this.play(); }

  /** 变速 (0.5 / 0.75 / 1.0); 播放中切换则重启 source 重锚定 */
  setRate(rate: number) {
    if (this.playbackRate === rate) return;
    this.playbackRate = rate;
    if (this.playing) {
      this.pause();
      this.play();
    }
    this.emit();
  }

  songLength(): number {
    if (this.audioBuffer) return this.audioBuffer.duration * 1000;
    if (this.audio && this.audio.duration && isFinite(this.audio.duration)) return this.audio.duration * 1000;
    const bm = this.beatmap;
    if (!bm) return 60000;
    const last = bm.hitObjects[bm.hitObjects.length - 1];
    return Math.max(last ? (last.endTime ?? last.time) + 2000 : 0, 10000);
  }

  /** 调试: 采样缓冲与排程状态快照 */
  debugState() {
    return {
      customBuffers: [...this.hitBuffers.keys()],
      defaultBuffers: [...this.defaultBuffers.keys()],
      defaultsLoading: this.defaultsLoading,
      playing: this.playing,
      degradedSync: this.degradedSync,
      hasAudioBuffer: !!this.audioBuffer,
      tempoReady: !!this.tempoNode,
      tempoActive: this.tempoActive,
      slideLoopCount: this.slideLoops.length,
      log: this.debugLog,
    };
  }
}

export const store = new EditorStore();

// 调试暴露 (CDP 验证器/排查用)
if (typeof window !== 'undefined') {
  (window as unknown as { __osuStore: EditorStore }).__osuStore = store;
}

export function useEditor(): EditorStore {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
