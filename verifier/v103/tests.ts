// v103 纯函数单测: FFT / Hann / 波形 peaks / 对数频率 bin / dB 归一化 / 色带 / 滚动移位
// 运行: npx esbuild verifier/v103/tests.ts --bundle --platform=node --outfile=/tmp/v103.cjs && node /tmp/v103.cjs
import { fft, hannWindow, frameMagnitudes } from '../../src/osu/fft';
import {
  computePeaks, spectroColumnAt, logBinForFreq, freqForLogBin, normalizeDb,
  spectroColor, pixelShift, mixdownMono, frameToLogBins,
  SPECTRO_BINS, SPECTRO_FMIN, SPECTRO_FMAX, SPECTRO_FRAME, SPECTRO_DB_RANGE,
  type AudioBufferLike,
} from '../../src/osu/waveformData';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// ---- T1: FFT 单频正弦峰值落在正确 bin ----
{
  const N = 1024, k0 = 100;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = Math.cos((2 * Math.PI * k0 * i) / N);
  fft(re, im);
  const mags = new Float32Array(N / 2 + 1);
  frameMagnitudes(re, im, mags);
  let peak = 0, pk = -1;
  for (let k = 0; k < mags.length; k++) if (mags[k] > peak) { peak = mags[k]; pk = k; }
  assert(pk === k0, `T1 单频正弦峰值 bin=${pk} 期望 ${k0}`);
  assert(near(peak, N / 2, N * 0.01), `T1 峰值幅度≈N/2 (实际 ${peak.toFixed(1)})`);
  assert(mags[50] < peak * 0.01, 'T1 远离峰值处幅值≈0');
}

// ---- T2: FFT 冲激响应平坦 + hann 端点 ----
{
  const N = 256;
  const re = new Float32Array(N), im = new Float32Array(N);
  re[0] = 1;
  fft(re, im);
  const mags = new Float32Array(N / 2 + 1);
  frameMagnitudes(re, im, mags);
  let flat = true;
  for (let k = 1; k < mags.length; k++) if (!near(mags[k], 1, 1e-4)) flat = false;
  assert(flat, 'T2 冲激 FFT 幅值谱平坦=1');
  const w = hannWindow(1024);
  assert(near(w[0], 0, 1e-6) && near(w[1023], 0, 1e-6), 'T2 hann 端点为 0');
  assert(near(w[512], 1, 0.01), 'T2 hann 中心≈1');
}

// ---- T3: 合成音频 peaks 分桶 ----
{
  const sr = 1000; // 1kHz => 1ms = 1 采样, 便于验证
  const n = 100;   // 100ms
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = i === 10 ? -0.5 : i === 55 ? 0.8 : 0;
  const buf: AudioBufferLike = { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
  const p = computePeaks(buf, 1);
  assert(p.buckets === 100, `T3 100ms@1ms = 100 桶 (实际 ${p.buckets})`);
  assert(near(p.min[10], -0.5, 1e-6) && near(p.max[10], -0.5, 1e-6), 'T3 桶10 min=max=-0.5 (1 采样/桶)');
  assert(near(p.max[55], 0.8, 1e-6) && near(p.min[55], 0.8, 1e-6), 'T3 桶55 min=max=0.8 (1 采样/桶)');
  const p10 = computePeaks(buf, 10);
  assert(p10.buckets === 10 && near(p10.min[1], -0.5, 1e-6) && near(p10.max[5], 0.8, 1e-6), 'T3 10ms 分桶极值归并正确');
}

// ---- T4: 双声道取全声道极值 + mixdown ----
{
  const a = new Float32Array([0.5, 0, 0, 0]), b = new Float32Array([0, -0.9, 0, 0]);
  const buf: AudioBufferLike = {
    sampleRate: 1000, numberOfChannels: 2, length: 4,
    getChannelData: (ch) => (ch === 0 ? a : b),
  };
  const p = computePeaks(buf, 1);
  assert(near(p.max[0], 0.5, 1e-6) && near(p.min[1], -0.9, 1e-6), 'T4 双声道极值覆盖所有声道');
  const mono = mixdownMono(buf);
  assert(near(mono[0], 0.25, 1e-6) && near(mono[1], -0.45, 1e-6), 'T4 mixdown 为各声道平均');
}

// ---- T5: 对数频率 bin 映射 ----
{
  assert(near(logBinForFreq(SPECTRO_FMIN), 0, 1e-9), 'T5 fmin → bin 0');
  assert(near(logBinForFreq(SPECTRO_FMAX), SPECTRO_BINS, 1e-9), 'T5 fmax → bin BINS');
  let mono = true;
  for (let b = 1; b <= SPECTRO_BINS; b++) if (freqForLogBin(b) <= freqForLogBin(b - 1)) mono = false;
  assert(mono, 'T5 freqForLogBin 单调递增');
  let rt = true;
  for (const f of [50, 100, 440, 1000, 5000, 12000]) {
    if (!near(freqForLogBin(logBinForFreq(f)) / f, 1, 0.01)) rt = false;
  }
  assert(rt, 'T5 往返映射误差 <1%');
  assert(near(freqForLogBin(SPECTRO_BINS / 2), Math.sqrt(SPECTRO_FMIN * SPECTRO_FMAX), 1), 'T5 中点 bin = 几何平均频率');
}

// ---- T6: dB 归一化 ----
{
  assert(normalizeDb(0, SPECTRO_FRAME) === 0, 'T6 静音 → 0');
  assert(near(normalizeDb(SPECTRO_FRAME / 2, SPECTRO_FRAME), 1, 1e-6), 'T6 满幅 → 1');
  const t = normalizeDb((SPECTRO_FRAME / 2) * Math.pow(10, -SPECTRO_DB_RANGE / 2 / 20), SPECTRO_FRAME);
  assert(near(t, 0.5, 0.02), `T6 -40dB(半程) → ≈0.5 (实际 ${t.toFixed(3)})`);
  assert(normalizeDb(Infinity, SPECTRO_FRAME) === 1, 'T6 越界 clamp 1');
}

// ---- T7: 色带 ----
{
  const [r0, g0, b0] = spectroColor(0);
  assert(r0 === 0 && g0 === 0 && b0 === 0, 'T7 t=0 为黑');
  const [r1, g1, b1] = spectroColor(1);
  assert(r1 === 255 && g1 === 255 && b1 === 255, 'T7 t=1 为白');
  // v194 适配: 色带换 Bpm-Measurer 分段式 — t=0.6 位于 [0.5,0.75) 段, k=0.4 → r=255, g=102
  const [rn, gn2, bn2] = spectroColor(0.6);
  assert(rn === 255 && gn2 === 102 && bn2 === 0, `T7 t=0.6 命中红→黄段 (实际 ${rn},${gn2},${bn2})`);
  const [rx, gx, bx] = spectroColor(-5);
  assert(rx === 0 && gx === 0 && bx === 0, 'T7 越界 clamp');
  let bright = true;
  for (let i = 1; i <= 100; i++) {
    const s = (x: number[]) => x[0] + x[1] + x[2];
    // v194 适配: Bpm-Measurer 分段色带在 [0.25,0.5) 段 b 128→0 与 r 128→255 对冲, 允许 ≤2 微小回落
    if (s(spectroColor(i / 100)) < s(spectroColor((i - 1) / 100)) - 2) bright = false;
  }
  assert(bright, 'T7 亮度随 t 单调 (允许 ≤2 段间回落)');
}

// ---- T8: pixelShift ----
{
  assert(near(pixelShift(0, 600, 6000, 1000), 100, 1e-9), 'T8 t0 +600ms@win6000/w1000 → 100px');
  assert(near(pixelShift(0, 600, 3000, 1000), 200, 1e-9), 'T8 缩窗(更放大)平移加倍');
  assert(near(pixelShift(500, 0, 6000, 1000), -83.3333, 0.001), 'T8 反向为负');
}

// ---- T9: 逐列频谱 (合成 chirp: 前段 200Hz 后段 4000Hz, 能量落在不同对数 bin) ----
// v106 适配: computeSpectrogram 整曲帧阵列已移除, 改测 spectroColumnAt 逐列 (窗口居中)
{
  const sr = 16000, secs = 1;
  const n = sr * secs;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = i < n / 2 ? 200 : 4000;
    d[i] = 0.9 * Math.sin((2 * Math.PI * f * i) / sr);
  }
  const binOf = (f: number) => Math.floor(logBinForFreq(f));
  const colAt = (ms: number) => {
    const out = new Float32Array(SPECTRO_BINS);
    spectroColumnAt(d, sr, ms, out);
    let pk = 0, pi = -1;
    for (let b = 0; b < SPECTRO_BINS; b++) if (out[b] > pk) { pk = out[b]; pi = b; }
    return { pk, pi, col: out };
  };
  const lo = colAt(250), hi = colAt(750);
  // v194 适配: 1024 帧 binHz 变粗, 低频对数 bin 的 max 池化把峰摊到相邻 bin, 容差 2→4
  assert(Math.abs(lo.pi - binOf(200)) <= 4, `T9 前段峰值 bin≈200Hz 处 (${lo.pi} vs ${binOf(200)})`);
  assert(Math.abs(hi.pi - binOf(4000)) <= 4, `T9 后段峰值 bin≈4000Hz 处 (${hi.pi} vs ${binOf(4000)})`);
  assert(lo.pk > 0.3 && hi.pk > 0.3, `T9 峰值强度显著 (${lo.pk.toFixed(2)}/${hi.pk.toFixed(2)})`);
  assert(lo.col[binOf(4000)] < 0.15, 'T9 前段高频区能量低');
}

// ---- T10: frameToLogBins 区间 max ----
{
  const sr = 16000, fftSize = SPECTRO_FRAME;
  const mags = new Float32Array(fftSize / 2 + 1);
  const binHz = sr / fftSize;
  mags[Math.round(1000 / binHz)] = fftSize / 2; // 1000Hz 满幅
  const out = new Float32Array(SPECTRO_BINS);
  frameToLogBins(mags, sr, out);
  const b1000 = Math.floor(logBinForFreq(1000));
  assert(out[b1000] > 0.9, `T10 1000Hz 满幅 bin≈1 (实际 ${out[b1000].toFixed(2)})`);
  assert(out[Math.floor(logBinForFreq(100))] < 0.05, 'T10 其他 bin≈0');
}

console.log(failures ? `\nV103_TESTS_FAILED: ${failures}` : '\nV103_TESTS_PASSED');
process.exit(failures ? 1 : 0);
