// v103: 纯函数 DSP 工具 — radix-2 FFT / Hann 窗 / 幅值谱 (node 可单测, 无 DOM 依赖)

/** 原位迭代 radix-2 FFT。re/im 长度须为 2 的幂且等长。 */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n !== im.length || n < 2 || (n & (n - 1)) !== 0) throw new Error('fft: length must be power of 2');
  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  // 蝶形
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = i + k + half;
        const xr = re[b] * cwr - im[b] * cwi;
        const xi = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

/** Hann 窗: w[0]=w[n-1]=0, 中心≈1 */
export function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

/** 前半幅值谱: out[k] = sqrt(re^2+im^2), k ∈ [0, n/2] */
export function frameMagnitudes(re: Float32Array, im: Float32Array, out: Float32Array): void {
  const half = re.length >> 1;
  for (let k = 0; k <= half && k < out.length; k++) out[k] = Math.hypot(re[k], im[k]);
}
