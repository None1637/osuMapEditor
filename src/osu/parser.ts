// osu! .osu 谱面文件解析器 (v14 格式) — 无损往返版
// 设计目标:
//  1) parse -> serialize -> parse 两遍结果深度相等 (语义无损)
//  2) 未建模内容 byte 级保留: [Events](含 storyboard/breaks/背景行)、[Colours]、
//     未知 section、已建模 section 中的未知键、物件 hitSample / 滑条边缘音效原始字符串
export interface Vec2 { x: number; y: number }

export interface TimingPoint {
  time: number;
  beatLength: number; // 负值 = 非继承点(绿线), 为百分比
  meter: number;
  sampleSet: number;
  sampleIndex: number;
  volume: number;
  uninherited: boolean;
  effects: number; // bit0: kiai, bit3: omit first bar line
}

export type ObjectType = 'circle' | 'slider' | 'spinner';

export interface SliderPoint extends Vec2 { }

export interface HitObject {
  id: number;
  type: ObjectType;
  x: number;
  y: number;
  time: number; // ms
  // slider
  curveType?: string; // L | P | B | C
  curvePoints?: SliderPoint[];
  slides?: number;
  length?: number; // pixel length
  // spinner
  endTime?: number;
  // sound
  hitSound?: number;
  newCombo?: boolean;
  comboSkip?: number;
  // ---- 无损保留的原始字段 (直接回填序列化) ----
  hitSampleRaw?: string;    // circle/slider/spinner 末尾 "bank:addition:custom:volume:file" 段
  edgeSoundsRaw?: string;   // slider: 各端点 hitSound, 形如 "0|2|0"
  edgeSetsRaw?: string;     // slider: 各端点 sampleSet 组, 形如 "0:0|1:0|0:0"
}

export interface Beatmap {
  formatVersion: number;
  general: {
    audioFilename: string;
    audioLeadIn: number;
    previewTime: number;
    countdown: number;
    sampleSet: string;
    stackLeniency: number;
    mode: number;
    letterboxInBreaks: number;
    widescreenStoryboard: number;
    background: string; // [Events] 中的背景图文件名
  };
  editor: {
    distanceSpacing: number; // 锁定间距倍率
    beatDivisor: number;     // 节拍细分
    gridSize: number;        // 网格大小
    timelineZoom: number;    // 上方时间轴缩放
    bookmarks: number[];     // v155: 书签 (蓝线, [Editor] Bookmarks, 逗号分隔 ms)
  };
  metadata: {
    title: string; titleUnicode: string;
    artist: string; artistUnicode: string;
    creator: string; version: string;
    source: string; tags: string;
    beatmapID: string; beatmapSetID: string;
  };
  difficulty: {
    hp: number; cs: number; od: number; ar: number;
    sliderMultiplier: number; sliderTickRate: number;
  };
  timingPoints: TimingPoint[];
  hitObjects: HitObject[];
  colors: { combos: string[]; sliderBorder: string; sliderTrackOverride: string };
  // ---- 无损保留 ----
  /** 未建模 section ([Events] / [Colours] / 未知 section) 的原始行, 序列化原样输出 */
  rawSections?: Record<string, string[]>;
  /** 已建模 section 中未识别的行 (未知键/注释), 序列化时追加在已知字段之后 */
  extraLines?: Record<string, string[]>;
  /** section 在源文件中的出现顺序 */
  sectionOrder?: string[];
}

function parseKV(line: string): [string, string] {
  const i = line.indexOf(':');
  return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}

let nextId = 1;
export function genId() { return nextId++; }

/** 已建模(重新生成而非原文保留)的 section */
const MODELED_SECTIONS = new Set(['General', 'Editor', 'Metadata', 'Difficulty', 'TimingPoints', 'HitObjects']);

export function parseOsu(text: string): Beatmap {
  const lines = text.replace(/\r/g, '').split('\n');
  let section = '';
  const rawSections: Record<string, string[]> = {};
  const extraLines: Record<string, string[]> = {};
  const sectionOrder: string[] = [];
  const bm: Beatmap = {
    formatVersion: 14,
    general: { audioFilename: 'audio.mp3', audioLeadIn: 0, previewTime: -1, countdown: 0, sampleSet: 'Normal', stackLeniency: 0.7, mode: 0, letterboxInBreaks: 0, widescreenStoryboard: 1, background: '' },
    editor: { distanceSpacing: 1, beatDivisor: 4, gridSize: 8, timelineZoom: 2, bookmarks: [] },
    metadata: { title: '', titleUnicode: '', artist: '', artistUnicode: '', creator: '', version: '', source: '', tags: '', beatmapID: '0', beatmapSetID: '-1' },
    difficulty: { hp: 5, cs: 4, od: 8, ar: 9, sliderMultiplier: 1.4, sliderTickRate: 1 },
    timingPoints: [], hitObjects: [],
    colors: { combos: [], sliderBorder: '', sliderTrackOverride: '' },
    rawSections, extraLines, sectionOrder,
  };

  const pushExtra = (sec: string, line: string) => { (extraLines[sec] = extraLines[sec] || []).push(line); };
  const pushRaw = (sec: string, line: string) => { (rawSections[sec] = rawSections[sec] || []).push(line); };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^osu file format v(\d+)/);
    if (m) { bm.formatVersion = parseInt(m[1]); continue; }
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1);
      sectionOrder.push(section);
      continue;
    }

    // 未建模 section: 原文保留(含注释行)
    if (section && !MODELED_SECTIONS.has(section)) {
      pushRaw(section, line);
      if (section === 'Events') {
        // 背景行: 0,0,"bg.jpg",0,0 或 0,0,bg.jpg (同时提取供运行时使用)
        const m2 = line.match(/^0,0,"?([^",]+)"?/);
        if (m2 && /\.(jpe?g|png|bmp|webp)$/i.test(m2[1])) bm.general.background = m2[1].trim();
      } else if (section === 'Colours') {
        const [k, v] = parseKV(line);
        if (k.startsWith('Combo')) {
          const rgb = v.split(',').map(s => parseInt(s.trim()) || 0);
          bm.colors.combos.push(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
        } else if (k === 'SliderBorder') {
          const rgb = v.split(',').map(s => parseInt(s.trim()) || 0);
          bm.colors.sliderBorder = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        } else if (k === 'SliderTrackOverride') {
          const rgb = v.split(',').map(s => parseInt(s.trim()) || 0);
          bm.colors.sliderTrackOverride = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        }
      }
      continue;
    }

    // 已建模 section: 注释行与未知键行保留为 extra
    if (line.startsWith('//')) { pushExtra(section, line); continue; }

    if (section === 'General') {
      const [k, v] = parseKV(line);
      if (k === 'AudioFilename') bm.general.audioFilename = v;
      else if (k === 'AudioLeadIn') bm.general.audioLeadIn = parseFloat(v) || 0;
      else if (k === 'PreviewTime') bm.general.previewTime = parseFloat(v) || -1;
      else if (k === 'Countdown') bm.general.countdown = parseInt(v) || 0;
      else if (k === 'SampleSet') bm.general.sampleSet = v;
      else if (k === 'StackLeniency') bm.general.stackLeniency = parseFloat(v) || 0;
      else if (k === 'LetterboxInBreaks') bm.general.letterboxInBreaks = parseInt(v) || 0;
      else if (k === 'WidescreenStoryboard') bm.general.widescreenStoryboard = parseInt(v) || 0;
      else if (k === 'Mode') bm.general.mode = parseInt(v) || 0;
      else pushExtra(section, line);
    } else if (section === 'Editor') {
      const [k, v] = parseKV(line);
      const n = parseFloat(v);
      if (k === 'DistanceSpacing') bm.editor.distanceSpacing = n;
      else if (k === 'BeatDivisor') bm.editor.beatDivisor = parseInt(v) || 4;
      else if (k === 'GridSize') bm.editor.gridSize = n;
      else if (k === 'TimelineZoom') bm.editor.timelineZoom = n;
      // v155: 书签 (逗号分隔 ms, stable [Editor] Bookmarks)
      else if (k === 'Bookmarks') bm.editor.bookmarks = v.split(',').map(s => parseInt(s.trim())).filter(x => isFinite(x));
      else pushExtra(section, line);
    } else if (section === 'Metadata') {
      const [k, v] = parseKV(line);
      if (k === 'Title') bm.metadata.title = v;
      else if (k === 'TitleUnicode') bm.metadata.titleUnicode = v;
      else if (k === 'Artist') bm.metadata.artist = v;
      else if (k === 'ArtistUnicode') bm.metadata.artistUnicode = v;
      else if (k === 'Creator') bm.metadata.creator = v;
      else if (k === 'Version') bm.metadata.version = v;
      else if (k === 'BeatmapID') bm.metadata.beatmapID = v;
      else if (k === 'BeatmapSetID') bm.metadata.beatmapSetID = v;
      else if (k === 'Source') bm.metadata.source = v;
      else if (k === 'Tags') bm.metadata.tags = v;
      else pushExtra(section, line);
    } else if (section === 'Difficulty') {
      const [k, v] = parseKV(line);
      const n = parseFloat(v);
      if (k === 'HPDrainRate') bm.difficulty.hp = n;
      else if (k === 'CircleSize') bm.difficulty.cs = n;
      else if (k === 'OverallDifficulty') bm.difficulty.od = n;
      else if (k === 'ApproachRate') bm.difficulty.ar = n;
      else if (k === 'SliderMultiplier') bm.difficulty.sliderMultiplier = n;
      else if (k === 'SliderTickRate') bm.difficulty.sliderTickRate = n;
      else pushExtra(section, line);
    } else if (section === 'TimingPoints') {
      const p = line.split(',');
      if (p.length < 2) { pushExtra(section, line); continue; }
      bm.timingPoints.push({
        time: parseFloat(p[0]),
        beatLength: parseFloat(p[1]),
        meter: parseInt(p[2] ?? '4') || 4,
        sampleSet: parseInt(p[3] ?? '1') || 1,
        sampleIndex: parseInt(p[4] ?? '0') || 0,
        volume: p[5] === undefined || p[5] === '' ? 100 : parseInt(p[5]),
        uninherited: p[6] !== '0',
        effects: parseInt(p[7] ?? '0') || 0,
      });
    } else if (section === 'HitObjects') {
      const obj = parseHitObjectLine(line);
      if (obj) bm.hitObjects.push(obj);
      else pushExtra(section, line);
    } else {
      // 文件头之前或无 section 的内容
      if (section) pushExtra(section, line);
    }
  }

  // colours 未提供时使用默认
  if (!bm.colors.combos.length) bm.colors.combos = ['#FF69B4', '#46B4FF', '#FFD746', '#6BFF6B'];
  if (!bm.colors.sliderBorder) bm.colors.sliderBorder = '#FFFFFF';

  bm.hitObjects.sort((a, b) => a.time - b.time);
  bm.timingPoints.sort((a, b) => a.time - b.time);
  return bm;
}

export function parseHitObjectLine(line: string): HitObject | null {
  const p = line.split(',');
  if (p.length < 5) return null;
  const x = parseFloat(p[0]), y = parseFloat(p[1]), time = parseFloat(p[2]);
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(time)) return null;
  const typeFlags = parseInt(p[3]);
  const hitSound = parseInt(p[4]) || 0;
  const base: HitObject = {
    id: genId(), type: 'circle', x, y, time, hitSound,
    newCombo: !!(typeFlags & 4), comboSkip: (typeFlags >> 4) & 7,
  };
  if (typeFlags & 1) { // circle
    base.type = 'circle';
    base.hitSampleRaw = p[5];
    return base;
  }
  if (typeFlags & 2) { // slider
    base.type = 'slider';
    const curve = (p[5] ?? 'L|0:0').split('|');
    base.curveType = curve[0];
    base.curvePoints = curve.slice(1).map(s => {
      const [cx, cy] = s.split(':');
      return { x: parseFloat(cx), y: parseFloat(cy) };
    });
    base.slides = parseInt(p[6] ?? '1') || 1;
    base.length = parseFloat(p[7] ?? '100') || 100;
    base.edgeSoundsRaw = p[8];
    base.edgeSetsRaw = p[9];
    base.hitSampleRaw = p[10];
    return base;
  }
  if (typeFlags & 8) { // spinner
    base.type = 'spinner';
    base.endTime = parseFloat(p[5] ?? String(time + 1000)) || time + 1000;
    base.hitSampleRaw = p[6];
    return base;
  }
  // hold note (mania) 等非 std 类型: 按 circle 兜底保留可序列化性
  base.hitSampleRaw = p[5];
  return base;
}

/** 数字序列化 */
function fmtNum(n: number): string {
  return String(n);
}

function defaultEdgeSounds(slides: number): string {
  return new Array(slides + 1).fill('0').join('|');
}
function defaultEdgeSets(slides: number): string {
  return new Array(slides + 1).fill('0:0').join('|');
}

const DEFAULT_SECTION_ORDER = ['General', 'Editor', 'Metadata', 'Difficulty', 'Events', 'TimingPoints', 'Colours', 'HitObjects'];

export function serializeOsu(bm: Beatmap): string {
  const extra = bm.extraLines ?? {};
  const raw = bm.rawSections ?? {};
  const sections: Record<string, string[]> = {};

  sections['General'] = [
    `AudioFilename: ${bm.general.audioFilename}`,
    `AudioLeadIn: ${bm.general.audioLeadIn}`,
    `PreviewTime: ${bm.general.previewTime}`,
    `Countdown: ${bm.general.countdown}`, `SampleSet: ${bm.general.sampleSet}`, `StackLeniency: ${bm.general.stackLeniency}`,
    `Mode: ${bm.general.mode}`, `LetterboxInBreaks: ${bm.general.letterboxInBreaks}`, `WidescreenStoryboard: ${bm.general.widescreenStoryboard}`,
  ];
  sections['Editor'] = [
    `DistanceSpacing: ${bm.editor.distanceSpacing}`, `BeatDivisor: ${bm.editor.beatDivisor}`,
    `GridSize: ${bm.editor.gridSize}`, `TimelineZoom: ${bm.editor.timelineZoom}`,
    // v155: 书签 (有内容才写, 与 stable 一致)
    ...(bm.editor.bookmarks.length ? [`Bookmarks: ${bm.editor.bookmarks.join(',')}`] : []),
  ];
  sections['Metadata'] = [
    `Title: ${bm.metadata.title}`, `TitleUnicode: ${bm.metadata.titleUnicode}`,
    `Artist: ${bm.metadata.artist}`, `ArtistUnicode: ${bm.metadata.artistUnicode}`,
    `Creator: ${bm.metadata.creator}`, `Version: ${bm.metadata.version}`,
    `Source: ${bm.metadata.source}`, `Tags: ${bm.metadata.tags}`, `BeatmapID: ${bm.metadata.beatmapID}`, `BeatmapSetID: ${bm.metadata.beatmapSetID}`,
  ];
  sections['Difficulty'] = [
    `HPDrainRate: ${bm.difficulty.hp}`, `CircleSize: ${bm.difficulty.cs}`,
    `OverallDifficulty: ${bm.difficulty.od}`, `ApproachRate: ${bm.difficulty.ar}`,
    `SliderMultiplier: ${bm.difficulty.sliderMultiplier}`, `SliderTickRate: ${bm.difficulty.sliderTickRate}`,
  ];
  sections['TimingPoints'] = bm.timingPoints.map(t =>
    `${fmtNum(t.time)},${t.beatLength},${t.meter},${t.sampleSet},${t.sampleIndex},${t.volume},${t.uninherited ? 1 : 0},${t.effects}`);
  sections['HitObjects'] = bm.hitObjects.map(o => {
    let flags = o.type === 'circle' ? 1 : o.type === 'slider' ? 2 : 8;
    if (o.newCombo) flags |= 4;
    flags |= (o.comboSkip ?? 0) << 4;
    const pos = `${fmtNum(o.x)},${fmtNum(o.y)},${fmtNum(o.time)},${flags},${o.hitSound ?? 0}`;
    if (o.type === 'circle') {
      // 可选尾字段缺失时省略, 保持与原文件字段数一致
      return o.hitSampleRaw !== undefined ? `${pos},${o.hitSampleRaw}` : pos;
    } else if (o.type === 'slider') {
      const curve = [o.curveType ?? 'L', ...(o.curvePoints ?? []).map(p => `${fmtNum(p.x)}:${fmtNum(p.y)}`)].join('|');
      const slides = o.slides ?? 1;
      const parts = [`${pos},${curve},${slides},${fmtNum(o.length ?? 100)}`];
      // edgeSounds/edgeSets/hitSample 逐级可选: 写到最后一个已定义的字段为止
      if (o.edgeSoundsRaw !== undefined || o.edgeSetsRaw !== undefined || o.hitSampleRaw !== undefined) {
        parts.push(o.edgeSoundsRaw ?? defaultEdgeSounds(slides));
        if (o.edgeSetsRaw !== undefined || o.hitSampleRaw !== undefined) {
          parts.push(o.edgeSetsRaw ?? defaultEdgeSets(slides));
          if (o.hitSampleRaw !== undefined) parts.push(o.hitSampleRaw);
        }
      }
      return parts.join(',');
    } else {
      const end = `${pos},${fmtNum(o.endTime ?? o.time + 1000)}`;
      return o.hitSampleRaw !== undefined ? `${end},${o.hitSampleRaw}` : end;
    }
  });

  // 建模 section 追加未知键/注释行; 未建模 section 用原文
  const order = (bm.sectionOrder?.length ? [...bm.sectionOrder] : DEFAULT_SECTION_ORDER);
  for (const s of Object.keys(sections)) if (!order.includes(s)) order.push(s);
  for (const s of Object.keys(raw)) if (!order.includes(s)) order.push(s);

  const L: string[] = [`osu file format v${bm.formatVersion}`];
  for (const sec of order) {
    const body: string[] = MODELED_SECTIONS.has(sec)
      ? [...(sections[sec] ?? []), ...(extra[sec] ?? [])]
      : (raw[sec] ?? []);
    if (!body.length && !MODELED_SECTIONS.has(sec)) continue;
    L.push('', `[${sec}]`, ...body);
  }
  return L.join('\n') + '\n';
}

// ---- 难度换算 ----
// 圆圈半径 (osu 坐标系像素): r = 54.4 - 4.48 * CS
export function csToRadius(cs: number): number { return 54.4 - 4.48 * cs; }
// AR -> preempt (ms)
export function arToPreempt(ar: number): number {
  if (ar < 5) return 1200 + 600 * (5 - ar) / 5;
  return 1200 - 750 * (ar - 5) / 5;
}
// AR -> fade-in 时长 (ms)
export function arToFadeIn(ar: number): number {
  if (ar < 5) return 800 + 400 * (5 - ar) / 5;
  return 800 - 500 * (ar - 5) / 5;
}

// ---- Timing 查询 ----
export function timingAt(points: TimingPoint[], time: number): { red: TimingPoint; green: TimingPoint | null } {
  let red: TimingPoint = points.find(p => p.uninherited) ?? { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 };
  let green: TimingPoint | null = null;
  for (const p of points) {
    if (p.time > time + 1e-6) break;
    // 注意: 红线后 green 清零是【采样语义】(stable: 红/绿线都携带 sampleSet/volume, 最后一条线生效),
    // SV 查询不要用这里的 green, 用 svPointAt (v148)
    if (p.uninherited) { red = p; green = null; }
    else green = p;
  }
  return { red, green };
}

/**
 * v148: SV 绿线独立查询 — 取 time 之前最后一条绿线, 红线【不】清除 SV
 * (lazer ControlPointInfo: TimingPoint 与 DifficultyPoint 分表独立二分查找;
 *  原 timingAt 遇红线 green=null, 红线后的滑条 SV 全部错误回退 1.0, 与 stable/lazer 不一致)
 */
export function svPointAt(points: TimingPoint[], time: number): TimingPoint | null {
  let green: TimingPoint | null = null;
  for (const p of points) {
    if (p.time > time + 1e-6) break;
    if (!p.uninherited) green = p;
  }
  return green;
}

export function svMultiplierAt(points: TimingPoint[], time: number, baseMultiplier: number): number {
  const { red } = timingAt(points, time);
  const green = svPointAt(points, time); // v148: SV 不被红线重置
  let sv = 1;
  if (green && green.beatLength < 0) sv = -100 / green.beatLength;
  return sv * baseMultiplier * (red.beatLength / 100); // px per beat... 实际速度 = sv*multiplier*100/beatLength px/ms
}

// 滑条速度: px/ms
export function sliderVelocityAt(points: TimingPoint[], time: number, sliderMultiplier: number): number {
  const { red } = timingAt(points, time);
  const green = svPointAt(points, time); // v148: SV 不被红线重置
  let sv = 1;
  if (green && green.beatLength < 0) sv = -100 / green.beatLength;
  return (100 * sliderMultiplier * sv) / red.beatLength;
}
