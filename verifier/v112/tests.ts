// v112 纯函数单测: WAVEFORM_VISUAL_OFFSET_MS=20 (lazer Editor.WAVEFORM_VISUAL_OFFSET) 显示采样映射
// 运行: npx esbuild verifier/v112/tests.ts --bundle --platform=node --outfile=/tmp/v112.cjs && node /tmp/v112.cjs
import {
  WAVEFORM_VISUAL_OFFSET_MS, computePeaks, getSpectroColumn, SPECTRO_BINS,
  type AudioBufferLike,
} from '../../src/osu/waveformData';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

// ---- T1: 常量 = 20 (对齐 lazer Editor.WAVEFORM_VISUAL_OFFSET, ppy/osu PR#26136) ----
assert(WAVEFORM_VISUAL_OFFSET_MS === 20, `T1 WAVEFORM_VISUAL_OFFSET_MS === 20 (实际 ${WAVEFORM_VISUAL_OFFSET_MS})`);

// ---- T2: 波形显示映射 — 显示时间 t 处采样 t+20 → 500ms 冲激出现在显示 480ms 处 (左移 20ms) ----
{
  const sr = 44100, n = sr;
  const d = new Float32Array(n);
  d[Math.round(sr * 0.5)] = 0.9; // 500ms 冲激
  const buf: AudioBufferLike = { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
  const peaks = computePeaks(buf, 1);
  // drawWave 的采样方式: 显示列时间 dispMs → 桶区间 [dispMs+OFFSET, dispMs+1+OFFSET)
  const bucketAt = (dispMs: number) => Math.floor((dispMs + WAVEFORM_VISUAL_OFFSET_MS) / peaks.msPerBucket);
  const hit = Math.max(peaks.max[bucketAt(480)], peaks.max[bucketAt(481)]);
  assert(hit > 0.8, `T2 显示 480-481ms 处采到 500ms 冲激 (max=${hit.toFixed(2)}; 1ms 分桶量化 ±1 桶)`);
  assert(peaks.max[bucketAt(460)] < 0.01 && peaks.max[bucketAt(500)] < 0.01, `T2 显示 460/500ms 处无冲激 (偏移量恰 20ms, 不多不少)`);
  assert(Math.floor(500 / peaks.msPerBucket) === 500, 'T2 sanity: 无偏移时冲激在 500 桶 (v106 归 0 期望位)');
}

// ---- T3: 频谱显示映射 — 列时间 t+20 取频谱: 显示 480ms 列 = 500ms 冲激列 (窗口居中保持, 不引入半窗右偏) ----
{
  const sr = 44100, n = sr;
  const d = new Float32Array(n);
  d[Math.round(sr * 0.5)] = 0.9;
  const buf: AudioBufferLike = { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
  const colMax = (col: Float32Array) => { let m = 0; for (const v of col) m = Math.max(m, v); return m; };
  const at480 = colMax(getSpectroColumn(buf, 480 + WAVEFORM_VISUAL_OFFSET_MS));
  const at460 = colMax(getSpectroColumn(buf, 460 + WAVEFORM_VISUAL_OFFSET_MS));
  const at500 = colMax(getSpectroColumn(buf, 500 + WAVEFORM_VISUAL_OFFSET_MS));
  assert(at480 > 0.15, `T3 显示 480ms 列冲激显著 (${at480.toFixed(3)})`);
  assert(at460 < at480 * 0.5 && at500 < at480 * 0.5, `T3 显示 460/500ms 列弱 (居中窗口 ±20ms 出主瓣) (${at460.toFixed(3)}/${at500.toFixed(3)})`);
}

console.log(failures ? `\nV112_TESTS_FAILED: ${failures}` : '\nV112_TESTS_PASSED');
process.exit(failures ? 1 : 0);
