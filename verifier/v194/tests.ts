// v194: 参考 Bpm-Measurer 优化频谱显示 — SPECTRO_FRAME 2048→1024 (瞬态更锐利) + 分段式色带 (黑→紫→红→黄→白)
import {
  spectroColor, spectroColumnAt, normalizeDb,
  SPECTRO_BINS, SPECTRO_FRAME, SPECTRO_DB_RANGE, logBinForFreq,
} from '../../src/osu/waveformData';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  PASS ${msg}`);
  else { failures++; console.error(`  FAIL ${msg}`); }
}
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// ---- T1: FFT 帧长 1024 ----
assert(SPECTRO_FRAME === 1024, `T1 SPECTRO_FRAME=1024 (实际 ${SPECTRO_FRAME})`);

// ---- T2: 色带锚点 (Bpm-Measurer 分段式) ----
{
  const eq = (c: number[], r: number, g: number, b: number) => c[0] === r && c[1] === g && c[2] === b;
  assert(eq(spectroColor(0), 0, 0, 0), 'T2 t=0 黑');
  assert(eq(spectroColor(0.25), 128, 0, 128), 'T2 t=0.25 紫 (128,0,128)');
  assert(eq(spectroColor(0.5), 255, 0, 0), 'T2 t=0.5 红 (255,0,0)');
  assert(eq(spectroColor(0.75), 255, 255, 0), 'T2 t=0.75 黄 (255,255,0)');
  assert(eq(spectroColor(1), 255, 255, 255), 'T2 t=1 白');
  assert(eq(spectroColor(-5), 0, 0, 0) && eq(spectroColor(99), 255, 255, 255), 'T2 越界 clamp');
  let mono = true;
  const s = (c: number[]) => c[0] + c[1] + c[2];
  // 分段 [0.25,0.5) 内 b 128→0 与 r 128→255 对冲, 允许 ≤2 的微小回落 (Bpm-Measurer 原式如此)
  for (let i = 1; i <= 200; i++) if (s(spectroColor(i / 200)) < s(spectroColor((i - 1) / 200)) - 2) mono = false;
  assert(mono, 'T2 亮度随 t 单调 (允许 ≤2 段间回落)');
}

// ---- T3: dB 归一化仍 80dB 动态范围 ----
{
  assert(SPECTRO_DB_RANGE === 80, 'T3 动态范围 80dB');
  assert(normalizeDb(0, SPECTRO_FRAME) === 0, 'T3 静音 → 0');
  assert(near(normalizeDb(SPECTRO_FRAME / 2, SPECTRO_FRAME), 1, 1e-6), 'T3 满幅 → 1');
}

// ---- T4: 1024 帧下逐列频谱定位仍准确 (合成 chirp: 前 200Hz 后 4000Hz) ----
{
  const sr = 16000, n = sr;
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
  // v194: 1024 帧 binHz=15.6Hz, 低频对数 bin 的 max 池化把峰摊到相邻 bin, 容差放宽到 4
  assert(Math.abs(lo.pi - binOf(200)) <= 4, `T4 前段峰值 bin≈200Hz (${lo.pi} vs ${binOf(200)})`);
  assert(Math.abs(hi.pi - binOf(4000)) <= 4, `T4 后段峰值 bin≈4000Hz (${hi.pi} vs ${binOf(4000)})`);
  assert(lo.pk > 0.3 && hi.pk > 0.3, `T4 峰值强度显著 (${lo.pk.toFixed(2)}/${hi.pk.toFixed(2)})`);
  // 1024 帧 (64ms @16k) 居中窗口: 距切换点 500ms 处不应串扰
  assert(lo.col[binOf(4000)] < 0.15, 'T4 前段高频区能量低');
}

console.log(failures ? `\nV194_TESTS_FAILED: ${failures}` : '\nV194_TESTS_PASSED');
process.exit(failures ? 1 : 0);
