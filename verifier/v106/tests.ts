// v106 纯函数单测: 逐列自适应频谱 (spectroColumnAt 窗口居中) + 列缓存 LRU
// 运行: npx esbuild verifier/v106/tests.ts --bundle --platform=node --outfile=/tmp/v106.cjs && node /tmp/v106.cjs
import {
  spectroColumnAt, getSpectroColumn, logBinForFreq, SPECTRO_BINS, SPECTRO_LRU_CAP,
  type AudioBufferLike,
} from '../../src/osu/waveformData';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const colMax = (col: Float32Array) => {
  let pk = 0, pi = -1;
  for (let b = 0; b < col.length; b++) if (col[b] > pk) { pk = col[b]; pi = b; }
  return { pk, pi };
};

// ---- T1: 合成 chirp 逐列峰值落在正确对数 bin (前段 200Hz / 后段 4000Hz) ----
{
  const sr = 16000, n = sr; // 1s
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = i < n / 2 ? 200 : 4000;
    d[i] = 0.9 * Math.sin((2 * Math.PI * f * i) / sr);
  }
  const out = new Float32Array(SPECTRO_BINS);
  spectroColumnAt(d, sr, 250, out);
  const lo = colMax(out);
  assert(Math.abs(lo.pi - Math.floor(logBinForFreq(200))) <= 2, `T1 250ms 列峰值 bin≈200Hz 处 (${lo.pi} vs ${Math.floor(logBinForFreq(200))})`);
  assert(lo.pk > 0.3, `T1 200Hz 峰值强度显著 (${lo.pk.toFixed(2)})`);
  spectroColumnAt(d, sr, 750, out);
  const hi = colMax(out);
  assert(Math.abs(hi.pi - Math.floor(logBinForFreq(4000))) <= 2, `T1 750ms 列峰值 bin≈4000Hz 处 (${hi.pi} vs ${Math.floor(logBinForFreq(4000))})`);
  assert(hi.pk > 0.3, `T1 4000Hz 峰值强度显著 (${hi.pk.toFixed(2)})`);
}

// ---- T2: 窗口以列中心为中心 (v106 根因修复: 前缘取窗会把能量右偏半个窗) ----
// 500ms 冲激 @44.1kHz: 居中窗口下 col(500) 强、col(480)/col(520) 都弱 (±20ms 已出 Hann 主瓣);
// 旧前缘窗口下 col(480) 会强 (帧 [480,526]ms 含冲激) — 该断言可区分两种取窗方式
{
  const sr = 44100, n = sr; // 1s
  const d = new Float32Array(n);
  d[Math.round(sr * 0.5)] = 0.9; // 500ms 冲激
  const out500 = new Float32Array(SPECTRO_BINS);
  const out480 = new Float32Array(SPECTRO_BINS);
  const out520 = new Float32Array(SPECTRO_BINS);
  spectroColumnAt(d, sr, 500, out500);
  spectroColumnAt(d, sr, 480, out480);
  spectroColumnAt(d, sr, 520, out520);
  const p500 = colMax(out500).pk, p480 = colMax(out480).pk, p520 = colMax(out520).pk;
  console.log(`  T2 冲激列强度: 480=${p480.toFixed(3)} 500=${p500.toFixed(3)} 520=${p520.toFixed(3)}`);
  assert(p500 > 0.15, `T2 冲激在 500ms 列显著 (${p500.toFixed(3)})`);
  assert(p520 < p500 * 0.5, `T2 520ms 列明显弱 (居中窗口, 非前缘) (${p520.toFixed(3)} vs ${p500.toFixed(3)})`);
  assert(p480 < p500 * 0.5, `T2 480ms 列同样弱 (对称 = 窗口居中; 前缘窗口此处会强) (${p480.toFixed(3)})`);
}

// ---- T3: 边缘零填充 (歌曲起点的列不崩、值有限) ----
{
  const sr = 8000, n = 400; // 50ms 短音频
  const d = new Float32Array(n).fill(0.3);
  const out = new Float32Array(SPECTRO_BINS);
  spectroColumnAt(d, sr, 0, out); // 窗口大半在歌曲外
  let finite = true;
  for (let b = 0; b < out.length; b++) if (!Number.isFinite(out[b])) finite = false;
  assert(finite, 'T3 0ms 边缘列全部有限 (零填充无 NaN)');
}

// ---- T4: getSpectroColumn 缓存 (同 key 同引用, round 归并) ----
{
  const sr = 8000, n = sr / 10;
  const d = new Float32Array(n).fill(0.2);
  const buf: AudioBufferLike = { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
  const a = getSpectroColumn(buf, 100.2);
  const b = getSpectroColumn(buf, 100.4); // round → 同 key 100
  assert(a === b, 'T4 同 key (round 归并) 返回同一引用');
  const c = getSpectroColumn(buf, 101);
  assert(c !== a, 'T4 不同 key 不同列');
}

// ---- T5: LRU 有界逐出 (超 cap 后最老列被逐出, 重算给新引用) ----
{
  const sr = 8000, n = 64; // 极小 buffer (越界列零填充, 只测缓存行为)
  const d = new Float32Array(n).fill(0.1);
  const buf: AudioBufferLike = { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
  const first = getSpectroColumn(buf, 0);
  for (let i = 1; i <= SPECTRO_LRU_CAP; i++) getSpectroColumn(buf, i); // 塞满并溢出 1 条
  const again = getSpectroColumn(buf, 0);
  assert(again !== first, `T5 超 cap(${SPECTRO_LRU_CAP}) 后最老列被逐出 (重算新引用)`);
  const hot = getSpectroColumn(buf, SPECTRO_LRU_CAP);
  assert(hot === getSpectroColumn(buf, SPECTRO_LRU_CAP), 'T5 未逐出的列仍命中缓存');
}

console.log(failures ? `\nV106_TESTS_FAILED: ${failures}` : '\nV106_TESTS_PASSED');
process.exit(failures ? 1 : 0);
