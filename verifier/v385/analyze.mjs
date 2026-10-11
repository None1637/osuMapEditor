// v385: 实时录音分析工具 — FFT / 稳态杂散 / 峰位检测 / glitch 扫描 (Node 侧)
// analyze/fft 与 v382 同算法 (Blackman-Harris 4 项窗 + radix-2 就地 FFT)。
export function fft(re, im) { // 迭代 radix-2, 就地
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
        const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
}

/** 对稳态段做加窗 FFT, 返回 { thdPct, spurDb, maxSpurDb, fundDb }
 *  expectFreqs: 期望输出成分 (Hz); 第一个为基频。多音时 THD 返回 null。 */
export function analyze(pcm, sr, expectFreqs) {
  const single = expectFreqs.length === 1;
  const N = 32768;
  if (pcm.length < N) throw new Error('pcm too short');
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * i / N) + 0.14128 * Math.cos(4 * Math.PI * i / N) - 0.01168 * Math.cos(6 * Math.PI * i / N);
    re[i] = pcm[i] * w;
  }
  fft(re, im);
  const df = sr / N, half = N / 2;
  const pw = new Float64Array(half);
  for (let i = 0; i < half; i++) pw[i] = re[i] * re[i] + im[i] * im[i];
  const compRange = (f) => {
    const c = Math.round(f / df);
    let pk = c;
    for (let i = Math.max(1, c - 4); i <= Math.min(half - 2, c + 4); i++) if (pw[i] > pw[pk]) pk = i;
    let e = 0;
    for (let i = Math.max(1, pk - 6); i <= Math.min(half - 1, pk + 6); i++) e += pw[i];
    return { pk, e, lo: pk - 6, hi: pk + 6 };
  };
  const comps = expectFreqs.map(compRange);
  const fund = comps[0].e;
  let hd = 0;
  if (single) {
    for (let k = 2; k <= 8; k++) {
      const f = expectFreqs[0] * k;
      if (f >= sr / 2 - 4 * df) break;
      hd += compRange(f).e;
    }
  }
  const mask = new Uint8Array(half);
  const mark = (lo, hi) => { for (let i = Math.max(0, lo); i <= Math.min(half - 1, hi); i++) mask[i] = 1; };
  mark(0, 2);
  for (const c of comps) mark(c.lo, c.hi);
  for (let k = 2; k <= 8; k++) {
    const f = expectFreqs[0] * k;
    if (f >= sr / 2 - 4 * df) break;
    const c = compRange(f); mark(c.lo, c.hi);
  }
  let spur = 0, maxSpur = 0;
  for (let i = 0; i < half; i++) if (!mask[i]) { spur += pw[i]; if (pw[i] > maxSpur) maxSpur = pw[i]; }
  const db = (x) => 10 * Math.log10(Math.max(x, 1e-30));
  return {
    thdPct: single ? 100 * Math.sqrt(hd / fund) : null,
    spurDb: db(spur) - db(fund),
    maxSpurDb: db(maxSpur) - db(fund),
    fundDb: db(fund),
  };
}

/** 谱峰实际频率: 在 approx Hz ±15% 范围内找最大功率峰 (抛物线插值亚 bin 精度) */
export function peakFreq(pcm, sr, approx) {
  const N = 32768;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * i / N) + 0.14128 * Math.cos(4 * Math.PI * i / N) - 0.01168 * Math.cos(6 * Math.PI * i / N);
    re[i] = (pcm[i] ?? 0) * w;
  }
  fft(re, im);
  const df = sr / N, half = N / 2;
  const lo = Math.max(2, Math.round(approx * 0.85 / df)), hi = Math.min(half - 2, Math.round(approx * 1.15 / df));
  let pk = lo, pkv = 0;
  for (let i = lo; i <= hi; i++) {
    const v = re[i] * re[i] + im[i] * im[i];
    if (v > pkv) { pkv = v; pk = i; }
  }
  const a = re[pk - 1] ** 2 + im[pk - 1] ** 2, b = pkv, c = re[pk + 1] ** 2 + im[pk + 1] ** 2;
  const frac = (a - c) / (2 * (a - 2 * b + c)) || 0;
  return (pk + Math.max(-0.5, Math.min(0.5, frac))) * df;
}

/** 自适应 glitch 扫描: 孤立大跳变 (>局部最大斜率 4 倍且 >0.12) + 零跑 (underrun 静音) + 能量跌落 */
export function glitchScanAdaptive(pcm, sr) {
  let firstOn = -1, lastOn = -1;
  for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > 0.01) { if (firstOn < 0) firstOn = i; lastOn = i; }
  if (firstOn < 0) return { firstOn, lastOn, jumps: 0, maxJump: 0, jumpAt: [], zeroRuns: 0, dips: 0 };
  let jumps = 0, maxJump = 0; const jumpAt = [];
  for (let i = firstOn + 20; i <= lastOn - 20; i++) {
    const d = Math.abs(pcm[i] - pcm[i - 1]);
    if (d > maxJump) maxJump = d;
    let loc = 0;
    for (let k = i - 18; k < i - 2; k++) loc = Math.max(loc, Math.abs(pcm[k + 1] - pcm[k]));
    if (d > 0.12 && d > loc * 4) { jumps++; if (jumpAt.length < 10) jumpAt.push(i); }
  }
  let zeroRuns = 0, run = 0, maxZeroRun = 0;
  for (let i = firstOn + 1; i <= lastOn; i++) {
    if (Math.abs(pcm[i]) < 1e-5) run++;
    else { if (run > 32) zeroRuns++; if (run > maxZeroRun) maxZeroRun = run; run = 0; }
  }
  if (run > maxZeroRun) maxZeroRun = run;
  const w = Math.floor(sr * 0.01);
  let dips = 0, prevRms = 0;
  for (let s0 = firstOn + Math.floor(sr * 0.2); s0 + w <= lastOn - Math.floor(sr * 0.05); s0 += w) {
    let e = 0; for (let i = s0; i < s0 + w; i++) e += pcm[i] * pcm[i];
    const rms = Math.sqrt(e / w);
    if (prevRms > 0.1 && rms < prevRms * 0.4) dips++;
    prevRms = rms;
  }
  return { firstOn, lastOn, jumps, maxJump, jumpAt, zeroRuns, maxZeroRun, dips };
}
