// v312 纯函数单测: computePeaks 非整除采样率 (44100Hz) 分桶零漂移
// 运行: npx esbuild verifier/v312/tests.ts --bundle --platform=node --outfile=/tmp/v312.cjs && node /tmp/v312.cjs
import { computePeaks, type AudioBufferLike } from '../../src/osu/waveformData';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

// ---- T1: 44100Hz 远端冲激落桶精确 (旧实现 spb=round(44.1)=44, 50s 处漂到 50113 桶 ≈ +113ms) ----
{
  const sr = 44100, n = sr * 60; // 60s
  const d = new Float32Array(n);
  d[Math.round(sr * 50)] = 0.9; // 50000ms 冲激
  const buf: AudioBufferLike = { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
  const p = computePeaks(buf, 1);
  assert(Math.abs(p.max[50000] - 0.9) < 1e-6, `T1 50s 冲激在 50000 桶 (实际所在桶 max=${p.max[50000].toFixed(2)})`);
  assert(p.max[50113] === 0, 'T1 旧实现的漂移落桶位 (50113) 为空');
  assert(p.buckets === 60000, `T1 60s@1ms = 60000 桶 (实际 ${p.buckets}; 旧实现 61363 桶, 尾部 2.3% 是虚空)`);
}

// ---- T2: 44100Hz 全程无漂移 — 每 10s 一个冲激, 全部落在精确桶 ----
{
  const sr = 44100, n = sr * 60;
  const d = new Float32Array(n);
  for (let s = 0; s < 60; s += 10) d[s * sr] = 0.5;
  const buf: AudioBufferLike = { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
  const p = computePeaks(buf, 1);
  let ok = true;
  for (let s = 0; s < 60; s += 10) if (p.max[s * 1000] !== 0.5) ok = false;
  assert(ok, 'T2 0/10/20/30/40/50s 冲激全部落在精确毫秒桶 (任何采样率下零漂移)');
}

// ---- T3: 48000Hz 设备回归 (spb=48 整数, 新旧实现应一致) ----
{
  const sr = 48000, n = sr * 60;
  const d = new Float32Array(n);
  d[Math.round(sr * 50)] = 0.9;
  const buf: AudioBufferLike = { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
  const p = computePeaks(buf, 1);
  assert(Math.abs(p.max[50000] - 0.9) < 1e-6 && p.buckets === 60000, 'T3 48000Hz 落桶/桶数不变 (开发机无回归)');
}

// ---- T4: msPerBucket=10 非整除 (44100: 441 采样/桶 恰好整数; 用 22050 验证半速率场景) ----
{
  const sr = 22050, n = sr * 60; // 22.05k: 1ms = 22.05 采样 (旧实现 round→22, 漂移 0.227%)
  const d = new Float32Array(n);
  d[Math.round(sr * 50)] = 0.9;
  const buf: AudioBufferLike = { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => d };
  const p = computePeaks(buf, 1);
  assert(Math.abs(p.max[50000] - 0.9) < 1e-6, `T4 22050Hz 50s 冲激在 50000 桶 (实际 max=${p.max[50000].toFixed(2)})`);
}

console.log(failures ? `\nV312_TESTS_FAILED: ${failures}` : '\nV312_TESTS_PASSED');
process.exit(failures ? 1 : 0);
