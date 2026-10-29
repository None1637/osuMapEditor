// v509: 对比两份 WAV (编辑器慢放 vs osu! 慢放) — 对齐偏移 / 相关度 / SNR / 时长比
// 用法: node verifier/v509/compare.mjs [editor.wav] [osu.wav]
import fs from 'fs';

function readWav(p) {
  const b = fs.readFileSync(p);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const str = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
  if (str(0, 4) !== 'RIFF' || str(8, 4) !== 'WAVE') throw new Error('not wav: ' + p);
  let off = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (off + 8 <= b.length) {
    const id = str(off, 4), size = view.getUint32(off + 4, true);
    if (id === 'fmt ') {
      let audioFormat = view.getUint16(off + 8, true);
      // WAVE_FORMAT_EXTENSIBLE: Audacity 常从此格式导出 24-bit PCM / 32-bit float。
      if (audioFormat === 0xFFFE && size >= 40) audioFormat = view.getUint16(off + 32, true);
      fmt = { audioFormat, channels: view.getUint16(off + 10, true), sampleRate: view.getUint32(off + 12, true), bits: view.getUint16(off + 22, true) };
    }
    if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataOff < 0) throw new Error('bad fmt: ' + p);
  const { audioFormat, channels, sampleRate, bits } = fmt;
  const n = Math.floor(dataLen / (bits / 8) / channels);
  const chans = [];
  for (let c = 0; c < channels; c++) chans.push(new Float32Array(n));
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      const pos = dataOff + (i * channels + c) * (bits / 8);
      let v;
      if (audioFormat === 1 && bits === 16) v = view.getInt16(pos, true) / 32768;
      else if (audioFormat === 1 && bits === 8) v = view.getUint8(pos) / 128 - 1;
      else if (audioFormat === 1 && bits === 24) {
        const u = view.getUint8(pos) | (view.getUint8(pos + 1) << 8) | (view.getUint8(pos + 2) << 16);
        v = (u & 0x800000 ? u - 0x1000000 : u) / 8388608;
      } else if (audioFormat === 1 && bits === 32) v = view.getInt32(pos, true) / 2147483648;
      else if (audioFormat === 3 && bits === 32) v = view.getFloat32(pos, true);
      else if (audioFormat === 3 && bits === 64) v = view.getFloat64(pos, true);
      else throw new Error(`unsupported format ${audioFormat}/${bits}`);
      chans[c][i] = v;
    }
  }
  return { sampleRate, channels: chans, length: n };
}

function mixDownResample(w, targetSr = 11025) {
  const { sampleRate: sr, channels, length } = w;
  const ratio = sr / targetSr;
  const m = Math.floor(length / ratio);
  const out = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const x = i * ratio, j = Math.floor(x), f = x - j;
    const a = Math.min(j, length - 1), b = Math.min(j + 1, length - 1);
    out[i] = (channels[0][a] * (1 - f) + channels[0][b] * f + (channels[1] ? channels[1][a] * (1 - f) + channels[1][b] * f : 0)) / (channels[1] ? 2 : 1);
  }
  return out;
}

function alignAtRate(a, b, maxLag, centerLag = 0, margin = maxLag) {
  let best = { lag: centerLag, corr: -1 };
  const from = Math.max(-maxLag, centerLag - margin), to = Math.min(maxLag, centerLag + margin);
  for (let lag = from; lag <= to; lag++) {
    let dot = 0, na = 0, nb = 0;
    const start = Math.max(0, lag), end = Math.min(a.length, b.length + lag);
    for (let i = start; i < end; i++) { const x = a[i], y = b[i - lag]; dot += x * y; na += x * x; nb += y * y; }
    const corr = dot / (Math.sqrt(na * nb) || 1);
    if (corr > best.corr) best = { lag, corr };
  }
  return best;
}

function downsample(a, factor) {
  const out = new Float32Array(Math.floor(a.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += a[i * factor + j];
    out[i] = sum / factor;
  }
  return out;
}

function bestAlign(a, b, maxLagMs = 2000, sr = 11025) {
  // 先以约 1.4kHz 粗对齐，再回原分辨率精修；避免整首歌 × 44k 个偏移的暴力扫描。
  const factor = 8;
  const ac = downsample(a, factor), bc = downsample(b, factor);
  const coarseSr = sr / factor;
  const coarse = alignAtRate(ac, bc, Math.round(maxLagMs / 1000 * coarseSr));
  return alignAtRate(a, b, Math.round(maxLagMs / 1000 * sr), coarse.lag * factor, factor * 2);
}

const [editorPath, osuPath] = process.argv.slice(2);
if (!editorPath || !osuPath) { console.error('用法: node verifier/v509/compare.mjs editor.wav osu.wav'); process.exit(1); }
const A = mixDownResample(readWav(editorPath)), B = mixDownResample(readWav(osuPath));
console.log('editor samples:', A.length, 'osu samples:', B.length, 'dur ratio:', (B.length / A.length).toFixed(4));
const { lag, corr } = bestAlign(A, B);
console.log('best lag:', lag, 'samples =', (lag * 1000 / 11025).toFixed(1), 'ms; corr =', corr.toFixed(4));
// 注意: 不同保时音高算法的相位/瞬态不同，低波形相关度不等于降调或低音质；需结合频谱与实听。
// 对齐后误差统计
const start = Math.max(0, lag), end = Math.min(A.length, B.length + lag);
let err = 0, sig = 0, n = 0;
for (let i = start; i < end; i++) { const d = A[i] - B[i - lag]; err += d * d; sig += A[i] * A[i]; n++; }
const rmsErr = Math.sqrt(err / n), rmsSig = Math.sqrt(sig / n);
console.log('对齐后: RMS err =', rmsErr.toFixed(6), 'SNR =', (20 * Math.log10(rmsSig / (rmsErr || 1e-9))).toFixed(1), 'dB');
