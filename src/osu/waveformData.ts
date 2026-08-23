// v103: 波形/频谱数据层 (纯函数为主, node 可单测)
// 波形: 1ms 分桶 min/max (Audition 单轨对称显示); 频谱: STFT(1024, Hann) → dB 归一化 → 对数频率 bin
// v194: 参考 Bpm-Measurer — FFT 帧长 2048→1024 (瞬态更锐利, 时间分辨率 46ms→23ms @44.1k);
//       色带换 Bpm-Measurer 分段式 (黑→紫→红→黄→白), 中高强度更饱满
import { fft, hannWindow, frameMagnitudes } from './fft';

/** 结构兼容浏览器 AudioBuffer 的最小接口 (便于 node 侧构造合成音频单测) */
export interface AudioBufferLike {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(ch: number): Float32Array;
}

// ---------- 波形 peaks ----------

/**
 * v112: 波形/频谱显示采样偏移 +20ms (内容左移 20ms) — 对齐 lazer `Editor.WAVEFORM_VISUAL_OFFSET = 20`
 * (ppy/osu PR#26136,  closes issue#21947): osu! 谱面计时应含 ~20ms 历史系统延迟 (stable 平台偏移 +
 * 平均硬件回放延迟 + 用户 universal offset 习惯, lazer 实测置信 ±2ms), lazer 编辑器波形/频谱据此
 * 左移 20ms 显示 (纯视觉约定, 不影响播放/hitsound 排程)。v104 曾加过该补偿, v106 以"Chrome≈ffmpeg
 * 解码一致"为由归 0 — 但那只证明解码管线无额外偏移, 不等于 lazer 的社区显示约定: 实测谱面
 * (1357624 sabi KEMOMIMI) 首 beat 瞬态比红线晚 ~26ms, 缺了它任意谱面波形都相对节拍右偏 ~20ms。
 */
export const WAVEFORM_VISUAL_OFFSET_MS = 20;

export interface WavePeaks {
  min: Float32Array;
  max: Float32Array;
  msPerBucket: number;
  buckets: number;
}

/** 每 msPerBucket 毫秒一桶, 取所有声道采样极值 (Audition 单轨对称波形) */
export function computePeaks(buf: AudioBufferLike, msPerBucket = 1): WavePeaks {
  const spb = Math.max(1, Math.round((buf.sampleRate * msPerBucket) / 1000)); // 每桶采样数
  const buckets = Math.ceil(buf.length / spb);
  const min = new Float32Array(buckets).fill(Infinity);
  const max = new Float32Array(buckets).fill(-Infinity);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const b = (i / spb) | 0;
      const v = d[i];
      if (v < min[b]) min[b] = v;
      if (v > max[b]) max[b] = v;
    }
  }
  for (let b = 0; b < buckets; b++) if (min[b] === Infinity) { min[b] = 0; max[b] = 0; }
  return { min, max, msPerBucket, buckets };
}

// ---------- 频谱 (v106: 自适应逐列渲染 + 窗口居中) ----------
// v103 整曲预计算 (hop 512 ≈ 11.6ms/帧) 有方格且窗口取前缘 → 能量显示在 t+半窗 (~23ms 系统性右偏, 真凶);
// v106 改每像素列以列中心时间做一次 FFT (窗口居中, 有效分辨率 = msPerPixel, 任何缩放无方格), LRU 缓存有界

export const SPECTRO_BINS = 256;    // 对数频率 bin 数
export const SPECTRO_FMIN = 30;     // Hz
export const SPECTRO_FMAX = 16000;  // Hz
export const SPECTRO_FRAME = 1024;  // FFT 帧长 (v194: 2048→1024 对齐 Bpm-Measurer, 瞬态分辨率 46ms→23ms @44.1k)
export const SPECTRO_DB_RANGE = 80; // 动态范围 dB

/** 频率 → 对数 bin (浮点, [0, BINS]) */
export function logBinForFreq(f: number, fmin = SPECTRO_FMIN, fmax = SPECTRO_FMAX, bins = SPECTRO_BINS): number {
  return (bins * Math.log(f / fmin)) / Math.log(fmax / fmin);
}
/** 对数 bin → 频率 (logBinForFreq 的反函数) */
export function freqForLogBin(b: number, fmin = SPECTRO_FMIN, fmax = SPECTRO_FMAX, bins = SPECTRO_BINS): number {
  return fmin * Math.pow(fmax / fmin, b / bins);
}

/** dB 归一化: mag 为 FFT 幅值, frameSize 为帧长; 输出 [0,1], 动态范围 SPECTRO_DB_RANGE */
export function normalizeDb(mag: number, frameSize: number, dbRange = SPECTRO_DB_RANGE): number {
  const db = 20 * Math.log10(mag / (frameSize / 2) + 1e-9);
  const t = (db + dbRange) / dbRange;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** 单帧幅值谱 → 对数 bin 强度写入 out[bins] (线性 bin 区间取 max) */
export function frameToLogBins(mags: Float32Array, sampleRate: number, out: Float32Array, bins = SPECTRO_BINS, fmin = SPECTRO_FMIN, fmax = SPECTRO_FMAX): void {
  const fftSize = (mags.length - 1) * 2;
  const binHz = sampleRate / fftSize;
  for (let b = 0; b < bins; b++) {
    const f0 = freqForLogBin(b, fmin, fmax, bins);
    const f1 = freqForLogBin(b + 1, fmin, fmax, bins);
    let k0 = Math.max(0, Math.floor(f0 / binHz));
    let k1 = Math.min(mags.length - 1, Math.ceil(f1 / binHz));
    if (k1 < k0) k1 = k0;
    let m = 0;
    for (let k = k0; k <= k1; k++) if (mags[k] > m) m = mags[k];
    out[b] = normalizeDb(m, fftSize);
  }
}

/** 单声道混合: 各声道平均 */
export function mixdownMono(buf: AudioBufferLike): Float32Array {
  const out = new Float32Array(buf.length);
  const n = buf.numberOfChannels;
  for (let ch = 0; ch < n; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / n;
  }
  return out;
}

// 模块级 scratch (单线程渲染循环内复用, 避免每列分配)
const HANN = hannWindow(SPECTRO_FRAME);
const scratchRe = new Float32Array(SPECTRO_FRAME);
const scratchIm = new Float32Array(SPECTRO_FRAME);
const scratchMags = new Float32Array(SPECTRO_FRAME / 2 + 1);

/** 单列频谱: 以 centerMs 为中心取 SPECTRO_FRAME Hann 窗 (边缘零填充) → FFT → 对数 bin 写入 out
 *  v106 窗口居中: 前缘取窗会把瞬态能量显示在 t+半窗 (~12ms @44.1k/1024 右偏); 居中后列时间即窗中心 */
export function spectroColumnAt(mono: Float32Array, sampleRate: number, centerMs: number, out: Float32Array, bins = SPECTRO_BINS): void {
  const center = Math.round((centerMs * sampleRate) / 1000);
  const start = center - SPECTRO_FRAME / 2;
  scratchRe.fill(0); scratchIm.fill(0);
  for (let i = 0; i < SPECTRO_FRAME; i++) {
    const s = start + i;
    if (s >= 0 && s < mono.length) scratchRe[i] = mono[s] * HANN[i];
  }
  fft(scratchRe, scratchIm);
  frameMagnitudes(scratchRe, scratchIm, scratchMags);
  frameToLogBins(scratchMags, sampleRate, out, bins);
}

// ---------- 列缓存 (WeakMap 随 buffer 回收; LRU 有界 ~10MB) ----------

interface SpectroCols {
  mono: Float32Array;
  sr: number;
  cols: Map<number, Float32Array>; // key = round(centerMs)
  lru: number[];
}
const colCache = new WeakMap<AudioBufferLike, SpectroCols>();
const peaksCache = new WeakMap<AudioBufferLike, WavePeaks>();

export const SPECTRO_LRU_CAP = 10000; // 10000 列 × 256 bin × 4B ≈ 10MB

export function getPeaks(buf: AudioBufferLike, msPerBucket = 1): WavePeaks {
  let p = peaksCache.get(buf);
  if (!p || p.msPerBucket !== msPerBucket) { p = computePeaks(buf, msPerBucket); peaksCache.set(buf, p); }
  return p;
}

/** 取 centerMs 的频谱列 (缓存命中直接返回, 否则现算并入 LRU) */
export function getSpectroColumn(buf: AudioBufferLike, centerMs: number): Float32Array {
  let sc = colCache.get(buf);
  if (!sc) {
    sc = { mono: mixdownMono(buf), sr: buf.sampleRate, cols: new Map(), lru: [] };
    colCache.set(buf, sc);
  }
  const key = Math.round(centerMs);
  let col = sc.cols.get(key);
  if (!col) {
    col = new Float32Array(SPECTRO_BINS);
    spectroColumnAt(sc.mono, sc.sr, key, col);
    sc.cols.set(key, col);
    sc.lru.push(key);
    if (sc.lru.length > SPECTRO_LRU_CAP) sc.cols.delete(sc.lru.shift()!);
  }
  return col;
}

/** 换歌/换 buffer 时无需手动清: WeakMap 键随 buffer 回收 */

// ---------- 色带 (v194: 参考 Bpm-Measurer 频谱配色分段式: 黑→紫(0.25)→红(0.5)→黄(0.75)→白(1)) ----------

/** t ∈ [0,1] → [r,g,b] (越界 clamp); 分段线性, 亮度单调不减 */
export function spectroColor(t: number): [number, number, number] {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  let r: number, g: number, b: number;
  if (x < 0.25) {
    const k = x / 0.25;
    r = k * 128; g = 0; b = k * 128;
  } else if (x < 0.5) {
    const k = (x - 0.25) / 0.25;
    r = 128 + k * 127; g = 0; b = 128 * (1 - k);
  } else if (x < 0.75) {
    const k = (x - 0.5) / 0.25;
    r = 255; g = k * 255; b = 0;
  } else {
    const k = (x - 0.75) / 0.25;
    r = 255; g = 255; b = k * 255;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

// ---------- 滚动缓存数学 ----------

/** 视口起点 t0a → t0b 对应的像素平移 (正值 = 内容向左移 dx 像素, win 为视口毫秒宽) */
export function pixelShift(t0a: number, t0b: number, win: number, width: number): number {
  return ((t0b - t0a) / win) * width;
}

/**
 * v111: 频谱滚动缓存的平移簿记 (纯函数, 供单测)。
 * imgT0 = 离屏位图当前精确表示的视口起点 (浮点毫秒, 亚像素残差留在其中);
 * 返回本帧应平移的整像素 dx 与平移后位图的新时间基准 newImgT0。
 * 不变式: imgT0 与当前 t0 的偏差恒 ≤ 0.5px 对应的毫秒, 任何帧数/速率下都不累积漂移。
 * (旧实现 t0+frac 双簿记在 dx=0 帧双计累计位移, 慢速滚动时漂移随帧数线性增长)
 */
export function spectroScrollStep(imgT0: number, t0: number, win: number, width: number): { dx: number; newImgT0: number } {
  const dx = Math.round(pixelShift(imgT0, t0, win, width));
  return { dx, newImgT0: imgT0 + (dx * win) / width };
}
