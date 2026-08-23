// 皮肤系统: 优先从 public/skin/*.png 加载 osu! 经典皮肤图 (osu!droid gfx 同款),
// 未加载/缺失时使用程序化贴图回退, 接口不变 (drawImage 兼容 canvas 与 img)
// 着色规则 (osu! 标准): hitcircle 白底 -> 乘算 combo 色; overlay/箭头/球/数字原色绘制
export type SkinImage = CanvasImageSource & { readonly width: number; readonly height: number };

export interface Skin {
  hitcircle: SkinImage;
  hitcircleoverlay: SkinImage;
  approachcircle: SkinImage;
  reversearrow: SkinImage;
  sliderstartcircle: SkinImage;
  sliderstartcircleoverlay: SkinImage;
  sliderendcircle: SkinImage;
  sliderendcircleoverlay: SkinImage;
  sliderb: SkinImage;
  sliderfollowcircle: SkinImage;
  sliderscorepoint: SkinImage;
  followpoint: SkinImage;
  /** followpoint 序列帧 (皮肤目录含 followpoint-{n}.png 时加载; 空 = 单图模式) */
  followpointFrames: SkinImage[];
  /** 序列帧每帧时长 (ms): skin.ini AnimationFramerate > 0 -> 1000/rate, 否则 1000/帧数 (lazer getFrameLength) */
  followpointFrameMs: number;
  spinnerCircle: SkinImage;
  spinnerApproach: SkinImage;
  spinnerBackground: SkinImage;
  default0: SkinImage[];
  /** v132: skin.ini [Colours] Combo1..8 颜色 ('#rrggbb', 按编号排序; 空 = 皮肤未定义) */
  comboColors: string[];
  /** v132: skin.ini [Colours] SliderBorder (null = 未定义) */
  sliderBorder: string | null;
  /** v132: skin.ini [Colours] SliderTrackOverride (null = 未定义) */
  sliderTrackOverride: string | null;
  /** v170: skin.ini [Fonts] HitCircleOverlap 数字重叠 px (1x 逻辑像素; null = 未定义, 用旧 33/35 字距) */
  hitCircleOverlap: number | null;
  /** 文件皮肤是否已加载完成 (false = 程序化回退中) */
  filesLoaded: boolean;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function drawHitcircle(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  // 白底主体 (乘算 combo 色后显色), 与皮肤 hitcircle.png 同为白色
  const grad = g.createRadialGradient(r, r, r * 0.1, r, r, r * 0.95);
  grad.addColorStop(0, 'rgba(255,255,255,0.98)');
  grad.addColorStop(0.8, 'rgba(245,245,245,0.98)');
  grad.addColorStop(0.96, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  return c;
}

function drawOverlay(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  g.strokeStyle = '#ffffff';
  g.lineWidth = size * 0.045;
  g.shadowColor = '#ffffff'; g.shadowBlur = size * 0.05;
  g.beginPath(); g.arc(r, r, r * 0.92, 0, Math.PI * 2); g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = size * 0.02;
  g.beginPath(); g.arc(r, r, r * 0.97, 0, Math.PI * 2); g.stroke();
  return c;
}

function drawApproach(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = size * 0.035;
  g.beginPath(); g.arc(r, r, r * 0.94, 0, Math.PI * 2); g.stroke();
  return c;
}

function drawSliderBall(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r * 0.85, r * 0.85, r * 0.05, r, r, r * 0.95);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#e9f6ff');
  grad.addColorStop(0.85, '#9ed5ff');
  grad.addColorStop(1, 'rgba(110,180,255,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  return c;
}

function drawFollow(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, r * 0.3, r, r, r);
  grad.addColorStop(0, 'rgba(255,220,120,0.22)');
  grad.addColorStop(0.9, 'rgba(255,190,60,0.32)');
  grad.addColorStop(1, 'rgba(255,190,60,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  return c;
}

function drawScorePoint(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(r, r, r * 0.5, 0, Math.PI * 2); g.fill();
  return c;
}

// follow point 回退: 柔边白点 (lazer 默认回退为白色小方块, 经典皮肤为小圆点)
function drawFollowPoint(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, r * 0.2, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  return c;
}

// 回退箭头: 与皮肤 reversearrow.png 同向 (指向右)
function drawReverse(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineWidth = size * 0.07;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(r - r * 0.45, r - r * 0.5);
  g.lineTo(r + r * 0.4, r);
  g.lineTo(r - r * 0.45, r + r * 0.5);
  g.stroke();
  return c;
}

function drawSpinnerCircle(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, r * 0.2, r, r, r);
  grad.addColorStop(0, 'rgba(255,160,60,0.55)');
  grad.addColorStop(0.85, 'rgba(255,120,30,0.5)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,200,150,0.9)';
  g.lineWidth = size * 0.01;
  g.beginPath(); g.arc(r, r, r * 0.96, 0, Math.PI * 2); g.stroke();
  return c;
}

function drawSpinnerBackground(size: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.7);
  grad.addColorStop(0, 'rgba(0,20,40,0.55)');
  grad.addColorStop(1, 'rgba(0,10,25,0.25)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function drawDigit(size: number, d: number): HTMLCanvasElement {
  const [c, g] = makeCanvas(size);
  g.font = `bold ${size * 0.7}px "Venera", "Segoe UI", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(255,255,255,0.6)'; g.shadowBlur = size * 0.03;
  g.fillText(String(d), size / 2, size / 2 + size * 0.02);
  return c;
}

/** public/skin/ 下的皮肤文件名 -> Skin 字段 (缺省保留程序化回退) */
const SKIN_FILES: [keyof Skin, string][] = [
  ['hitcircle', 'hitcircle.png'],
  ['hitcircleoverlay', 'hitcircleoverlay.png'],
  ['approachcircle', 'approachcircle.png'],
  ['reversearrow', 'reversearrow.png'],
  ['sliderstartcircle', 'sliderstartcircle.png'],
  ['sliderstartcircleoverlay', 'sliderstartcircleoverlay.png'],
  ['sliderendcircle', 'sliderendcircle.png'],
  ['sliderendcircleoverlay', 'sliderendcircleoverlay.png'],
  ['sliderb', 'sliderb0.png'],
  ['sliderfollowcircle', 'sliderfollowcircle.png'],
  ['sliderscorepoint', 'sliderscorepoint.png'],
  ['followpoint', 'followpoint.png'],
  ['spinnerCircle', 'spinner-circle.png'],
  ['spinnerApproach', 'spinner-approachcircle.png'],
  ['spinnerBackground', 'spinner-background.png'],
];

/** 1x1 全透明占位图 (lazer: sliderstart/endcircle 存在但对应 overlay 缺失时 = 无 overlay, 不回退 hitcircleoverlay) */
let emptyImg: HTMLCanvasElement | null = null;
function emptyImage(): HTMLCanvasElement {
  if (!emptyImg) { emptyImg = document.createElement('canvas'); emptyImg.width = emptyImg.height = 1; }
  return emptyImg;
}

/**
 * 滑条头尾贴图回退 (lazer LegacyMainCirclePiece.load :64-103):
 * - sliderstart/endcircle 缺失 => 整组回退 hitcircle + hitcircleoverlay
 *   (皮肤把 hitcircle 做成全透明时, 滑条头不再显示程序化实心圆 — 此前回退底是实心白盘, 着色后成实心染色圆);
 * - 前缀 circle 存在但对应 overlay 缺失 => overlay 为空 (lazer: 不显示 overlay, 不回退 hitcircleoverlay)。
 * has = 该皮肤来源实际提供了哪些贴图 (加载成功后调用, 须在 hitcircle 就位之后)。
 */
export function resolveSliderCircleFallback(skin: Skin, has: (k: keyof Skin) => boolean, empty?: SkinImage) {
  const pairs: [('sliderstartcircle' | 'sliderendcircle'), ('sliderstartcircleoverlay' | 'sliderendcircleoverlay')][] = [
    ['sliderstartcircle', 'sliderstartcircleoverlay'],
    ['sliderendcircle', 'sliderendcircleoverlay'],
  ];
  for (const [circle, overlay] of pairs) {
    if (has(circle)) {
      if (!has(overlay)) skin[overlay] = empty ?? emptyImage();
    } else {
      skin[circle] = skin.hitcircle;
      skin[overlay] = skin.hitcircleoverlay;
    }
  }
}

export function createSkin(): Skin {
  const skin = makeProceduralBase();
  loadDefaultFilesInto(skin);
  return skin;
}

/** 程序化回退贴图全集 (文件皮肤缺失时逐字段使用) */
function makeProceduralBase(): Skin {
  const hitcircle = drawHitcircle(256);
  const overlay = drawOverlay(256);
  const sliderb = drawSliderBall(256);
  skinSpriteWidth.set(sliderb, 128); // v131: 256px 画布 = 128-box (回退球按 2r 盒子绘制, 不放大)
  return {
    hitcircle,
    hitcircleoverlay: overlay,
    approachcircle: drawApproach(256),
    reversearrow: drawReverse(256),
    sliderstartcircle: hitcircle,
    sliderstartcircleoverlay: overlay,
    sliderendcircle: hitcircle,
    sliderendcircleoverlay: overlay,
    sliderb,
    sliderfollowcircle: drawFollow(256),
    sliderscorepoint: drawScorePoint(64),
    followpoint: drawFollowPoint(16),
    followpointFrames: [],
    followpointFrameMs: 1000,
    spinnerCircle: drawSpinnerCircle(1024),
    spinnerApproach: drawApproach(512),
    spinnerBackground: drawSpinnerBackground(512),
    default0: Array.from({ length: 10 }, (_, i) => drawDigit(160, i)),
    comboColors: [], // v132: 程序化回退无皮肤颜色
    sliderBorder: null,
    sliderTrackOverride: null,
    hitCircleOverlap: null, // v170
    filesLoaded: false,
  };
}

/** 从 public/skin/ 异步加载默认文件皮肤, 逐张替换 (加载失败的保留回退) */
function loadDefaultFilesInto(skin: Skin) {
  const base = import.meta.env.BASE_URL || '/';
  const loadedKeys = new Set<keyof Skin>();
  let pending = SKIN_FILES.length + 10;
  const done = () => {
    if (--pending === 0) {
      resolveSliderCircleFallback(skin, k => loadedKeys.has(k)); // v100
      skin.filesLoaded = true;
    }
  };
  for (const [key, file] of SKIN_FILES) {
    const img = new Image();
    img.onload = () => { (skin[key] as SkinImage) = img; loadedKeys.add(key); done(); };
    img.onerror = done;
    img.src = `${base}skin/${file}`;
  }
  for (let i = 0; i < 10; i++) {
    const img = new Image();
    img.onload = () => { skin.default0[i] = img; done(); };
    img.onerror = done;
    img.src = `${base}skin/default-${i}.png`;
  }
}

let singleton: Skin | null = null;
/** 共享皮肤单例 (EditorCanvas 与 Timelines 共用, 只加载一次) */
export function getSkin(): Skin {
  if (!singleton) singleton = createSkin();
  return singleton;
}

// ---------- 用户皮肤文件夹 (osu! 皮肤目录: hitcircle.png / normal-hitnormal.wav 等) ----------
import type { FsDirLike } from './library';

/** 当前皮肤来源描述 (UI 展示用) */
export let skinSourceName = '默认皮肤';

/** 皮肤目录图片产生的 objectURL, 换肤/恢复默认时统一释放 */
let skinObjectUrls: string[] = [];

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

/** 文件名候选: @2x 优先 (osu! 高清皮肤约定), sliderb 兼容无序号命名。
 *  followpoint 不走这里 — applySkinFromDir 有专用通道 (单图或 followpoint-{n} 序列帧) */
function fileVariants(file: string): string[] {
  const out = [file.replace(/\.png$/i, '@2x.png'), file];
  if (file === 'sliderb0.png') out.push('sliderb.png');
  return out;
}

/** @2x 贴图的缩放修正 (osu framework ScaleAdjust=2: 高清贴图按一半像素尺寸绘制);
 *  followpoint 等按贴图宽度定显示尺寸的精灵必须除以该系数 (显式尺寸绘制的 hitcircle 等不受影响) */
export const skinScaleAdjust = new WeakMap<SkinImage, number>();

/** v131: 精灵固有宽度 (128-box 单位, 即 lazer 贴图像素 ÷ ScaleAdjust) — 滑条球等按贴图固有尺寸绘制的精灵用
 *  (lazer LegacySliderBall: AutoSize = 贴图尺寸, 非压进 OBJECT_DIMENSIONS 盒子);
 *  只登记需要固有尺寸的精灵 (INTRINSIC_SIZE_KEYS), 未登记时调用方按 128 (= 2r 盒子) 回退 */
export const skinSpriteWidth = new WeakMap<SkinImage, number>();

/** v150: 按贴图固有尺寸显示的精灵 (lazer LegacyMainCirclePiece: AutoSize + WithMaximumSize(OBJECT_DIMENSIONS*2=256)) —
 *  hitcircle 族不拉伸进 128 盒子, 按贴图像素 ÷ ScaleAdjust 显示 (150px hitcircle 显示为盒子的 150/128 倍);
 *  sliderb 为 v131 既有登记 (renderer 侧上限 384, 见 drawSlider) */
const INTRINSIC_SIZE_KEYS = new Set<keyof Skin>([
  'hitcircle', 'hitcircleoverlay',
  'sliderstartcircle', 'sliderstartcircleoverlay', 'sliderendcircle', 'sliderendcircleoverlay',
  'sliderb',
]);

/** v150: hitcircle 族精灵显示宽度 (128-box 单位) = 固有宽度, 上限 256 (lazer WithMaximumSize);
 *  未登记 (默认皮肤/程序化回退) 回退 128 = 撑满 2r 盒子 */
export function hitcircleSpriteWidth(img: SkinImage): number {
  return Math.min(skinSpriteWidth.get(img) ?? 128, 256);
}

/** 换回程序化回退底 (不触发 public/skin 加载), 换肤前清场 */
function resetToProcedural() {
  const skin = getSkin();
  for (const u of skinObjectUrls) URL.revokeObjectURL(u);
  skinObjectUrls = [];
  Object.assign(skin, makeProceduralBase());
}

/**
 * 从用户选择的皮肤目录加载贴图: 逐字段尝试 SKIN_FILES + default-0..9,
 * 找不到的文件保留程序化回退。返回成功加载的张数。
 * followpoint 特殊处理 (lazer GetAnimation("followpoint", looping, applyConfigFrameRate: true)):
 * v131: 序列帧优先 (lazer LegacySkinExtensions.GetTextures: animatable 时先查 followpoint-0 帧,
 *       有帧即整组动画, 静态 followpoint.png 被忽略 — 旧逻辑单图优先, 含 1x1 占位单图的皮肤 followpoint 全不显示);
 * 帧时长 = skin.ini AnimationFramerate > 0 ? 1000/rate : 1000/帧数 (lazer getFrameLength:
 * applyConfigFrameRate 且无 ini 配置时默认整组 1 秒一轮 — v131 误取 SIXTY_FRAME_TIME,
 * 该常量只用于 applyConfigFrameRate=false 的路径; 60fps 默认让 1x1 空白帧皮肤的亮灭节奏快 6 倍, 连线看似断裂)。
 */
export async function applySkinFromDir(dir: FsDirLike, sourceName: string): Promise<{ loaded: number; total: number }> {
  resetToProcedural();
  const skin = getSkin();
  const total = SKIN_FILES.length + 10;
  let loaded = 0;
  const loadName = async (name: string, assign: (img: SkinImage) => void): Promise<boolean> => {
    try {
      const f = await (await dir.getFileHandle(name)).getFile();
      const url = URL.createObjectURL(f);
      const img = await loadImage(url);
      skinObjectUrls.push(url);
      assign(img);
      if (name.toLowerCase().endsWith('@2x.png')) skinScaleAdjust.set(img, 2); // 高清贴图按半尺寸绘制
      return true;
    } catch { return false; }
  };
  // v170: loadOne 已并入数字加载的 前缀→default 回退链 (见下方 jobs)
  // v132: skin.ini 文本共享读取 (AnimationFramerate 帧率 + [Colours] 皮肤颜色)
  const iniTextP: Promise<string> = (async () => {
    try { const f = await (await dir.getFileHandle('skin.ini')).getFile(); return await f.text(); }
    catch { return ''; } // 无 skin.ini
  })();
  const jobs: Promise<void>[] = [];
  jobs.push((async () => {
    // v132: 解析 [Colours] (Combo1..8 / SliderBorder / SliderTrackOverride), 供显示设置「使用皮肤颜色」
    const cols = parseSkinIniColours(await iniTextP);
    skin.comboColors = cols.combos;
    skin.sliderBorder = cols.sliderBorder;
    skin.sliderTrackOverride = cols.sliderTrackOverride;
  })());
  const loadedKeys = new Set<keyof Skin>(); // v100: 滑条头尾回退判定 (实际提供了哪些贴图)
  for (const [key, file] of SKIN_FILES) {
    if (key === 'followpoint') continue; // 下方专用通道 (单图或序列帧)
    jobs.push((async () => {
      for (const name of fileVariants(file)) {
        if (await loadName(name, img => {
          (skin[key] as SkinImage) = img;
          // v131/v150: 固有尺寸精灵登记固有宽度 (128-box 单位 = 贴图像素 ÷ ScaleAdjust) —
          // sliderb (v131, lazer LegacySliderBall AutoSize) 与 hitcircle 族 (v150, lazer LegacyMainCirclePiece AutoSize+WithMaximumSize(256))
          if (INTRINSIC_SIZE_KEYS.has(key)) skinSpriteWidth.set(img, img.width / (name.toLowerCase().endsWith('@2x.png') ? 2 : 1));
        })) { loaded++; loadedKeys.add(key); return; }
      }
    })());
  }
  jobs.push((async () => {
    // v170: skin.ini [Fonts] HitCirclePrefix — 数字贴图用自定义前缀 (如 Saraune Leaves 的 blank-N;
    //       该皮肤 default-N.png 是 1x1 透明占位, 不读前缀会导致圈内数字不显示); 前缀文件缺失时回退 default-N
    const fonts = parseSkinIniFonts(await iniTextP);
    skin.hitCircleOverlap = fonts.hitCircleOverlap;
    const prefix = fonts.hitCirclePrefix ?? 'default';
    await Promise.all(Array.from({ length: 10 }, (_, i) => (async () => {
      const bases = prefix === 'default' ? [`default-${i}.png`] : [`${prefix}-${i}.png`, `default-${i}.png`];
      for (const b of bases) {
        let got = false;
        for (const name of fileVariants(b)) {
          if (await loadName(name, img => { skin.default0[i] = img; })) { got = true; break; }
        }
        if (got) { loaded++; return; }
      }
    })()));
  })());
  jobs.push((async () => {
    // v131: 序列帧优先 — 从 0 开始连续到首个缺失 (允许中间 1x1 空白占位帧, 皮肤常用此控制亮灭节奏)
    const frames: SkinImage[] = [];
    for (let i = 0; i < 120; i++) {
      let got = false;
      for (const name of [`followpoint-${i}@2x.png`, `followpoint-${i}.png`]) {
        if (await loadName(name, img => { frames[i] = img; })) { got = true; break; }
      }
      if (!got) break;
    }
    if (frames.length) {
      const m = (await iniTextP).match(/^\s*AnimationFramerate\s*:\s*(\d+)/mi); // v132: 改用共享 skin.ini 文本
      const iniRate = m ? parseInt(m[1]) : 0;
      skin.followpointFrames = frames;
      skin.followpoint = frames[0];
      skin.followpointFrameMs = iniRate > 0 ? 1000 / iniRate : 1000 / frames.length; // v143: lazer getFrameLength — applyConfigFrameRate 无 ini 时整组 1 秒/轮 (v131 误取 SIXTY_FRAME_TIME)
      loaded++;
      return;
    }
    // 无序列帧才回退单图 followpoint(@2x).png (lazer: 静态图仅在无帧时使用)
    for (const name of ['followpoint@2x.png', 'followpoint.png']) {
      if (await loadName(name, img => { skin.followpoint = img; })) { loaded++; return; }
    }
  })());
  await Promise.all(jobs);
  resolveSliderCircleFallback(skin, k => loadedKeys.has(k)); // v100: 缺失 sliderstart/endcircle 整组回退 hitcircle
  skin.filesLoaded = true;
  skinSourceName = sourceName;
  return { loaded, total };
}

/** 恢复默认皮肤 (public/skin + 程序化回退), 释放皮肤目录资源 */
export function resetSkinToDefault() {
  resetToProcedural();
  skinSourceName = '默认皮肤';
  loadDefaultFilesInto(getSkin());
}

/** v170: 解析 skin.ini [Fonts] 段: HitCirclePrefix (数字贴图前缀, 默认 default) / HitCircleOverlap (数字重叠 px);
 *  未定义为 null — 调用方分别回退 'default' 前缀与旧 33/35 字距 */
export function parseSkinIniFonts(ini: string): { hitCirclePrefix: string | null; hitCircleOverlap: number | null } {
  const out = { hitCirclePrefix: null as string | null, hitCircleOverlap: null as number | null };
  const sec = /^\s*\[Fonts\]\s*$/mi.exec(ini);
  if (!sec) return out;
  const body = ini.slice(sec.index + sec[0].length);
  const next = body.search(/^\s*\[/m); // 段到下一个 [Section] 为止
  const lines = (next >= 0 ? body.slice(0, next) : body).split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    if (/^HitCirclePrefix$/i.test(m[1])) out.hitCirclePrefix = m[2];
    else if (/^HitCircleOverlap$/i.test(m[1])) {
      const v = parseFloat(m[2]);
      if (isFinite(v)) out.hitCircleOverlap = v;
    }
  }
  return out;
}

/** v132: 解析 skin.ini [Colours] 段: Combo1..8 / SliderBorder / SliderTrackOverride ('r,g,b' -> '#rrggbb');
 *  Combo 允许跳号 (osu! 按声明编号顺序取色), 皮肤未定义的颜色为 null/空数组 (调用方回退谱面颜色) */
export function parseSkinIniColours(ini: string): { combos: string[]; sliderBorder: string | null; sliderTrackOverride: string | null } {
  const out = { combos: [] as string[], sliderBorder: null as string | null, sliderTrackOverride: null as string | null };
  const sec = /^\s*\[Colours\]\s*$/mi.exec(ini);
  if (!sec) return out;
  const body = ini.slice(sec.index + sec[0].length);
  const next = body.search(/^\s*\[/m); // 段到下一个 [Section] 为止
  const lines = (next >= 0 ? body.slice(0, next) : body).split(/\r?\n/);
  const hex = (v: string): string | null => {
    const m = v.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    const h = (n: string) => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, '0');
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  };
  const comboMap = new Map<number, string>();
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const val = hex(m[2]);
    if (!val) continue;
    const cm = m[1].match(/^Combo(\d+)$/i);
    if (cm) { comboMap.set(+cm[1], val); continue; }
    if (/^SliderBorder$/i.test(m[1])) out.sliderBorder = val;
    else if (/^SliderTrackOverride$/i.test(m[1])) out.sliderTrackOverride = val;
  }
  out.combos = [...comboMap.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  return out;
}

// ---- 贴图着色 (combo 色乘算), 带缓存, 供游玩区与时间轴共用 ----
const tintCache = new WeakMap<SkinImage, Record<string, HTMLCanvasElement>>();

export function tintedSprite(sprite: SkinImage, color: string): HTMLCanvasElement {
  let perColor = tintCache.get(sprite);
  if (!perColor) { perColor = {}; tintCache.set(sprite, perColor); }
  let out = perColor[color];
  if (!out) {
    const w = sprite.width, h = sprite.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.drawImage(sprite, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(sprite, 0, 0);
    out = c;
    perColor[color] = c;
  }
  return out;
}

/** 'rgb(r,g,b)' 或 '#rrggbb' -> 带透明度的 rgba 字符串 */
export function withAlpha(color: string, a: number): string {
  let m = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
  m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  return color;
}

// 调试暴露 (CDP 验证器/排查用): 页面内直接构造 mock FsDirLike 调 applySkinFromDir 验证皮肤读取
if (typeof window !== 'undefined') {
  (window as unknown as { __osuSkin: unknown }).__osuSkin = { applySkinFromDir, resetSkinToDefault, getSkin, skinScaleAdjust };
}
