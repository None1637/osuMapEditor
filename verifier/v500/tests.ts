// 验证器 v500 纯函数段: 容差 ms 参数行为
// ① 默认容差与旧版完全一致 (tolMs=15 ≡ 旧 min(15, P/24) 行为);
// ② 容差影响覆盖率 (大抖动轨: tolMs=3 覆盖率 < tolMs=30);
// ③ 恒速/变速判定在容差可调后仍成立 (恒速 128 不误报, 20 段变速至少报 1 段)。
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';
import type { AudioBufferLike } from '../../src/osu/waveformData';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

function clickTrack(beatTimesMs: number[], durMs: number, sr = 44100): AudioBufferLike {
  const n = Math.ceil((durMs / 1000) * sr);
  const data = new Float32Array(n);
  const put = (t: number, amp: number) => {
    const start = Math.round((t / 1000) * sr);
    const len = Math.round(0.03 * sr);
    for (let i = 0; i < len && start + i < n; i++) {
      const tt = i / sr;
      data[start + i] += Math.sin(2 * Math.PI * 2000 * tt) * Math.exp(-tt / 0.006) * amp;
    }
  };
  for (let i = 0; i < beatTimesMs.length; i++) {
    put(beatTimesMs[i], 0.9);
    const half = i + 1 < beatTimesMs.length ? (beatTimesMs[i] + beatTimesMs[i + 1]) / 2 : beatTimesMs[i] + 150;
    put(half, 0.35);
  }
  return { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => data };
}

function beatsOf(bpm: number, count: number, startMs = 500): number[] {
  const spb = 60000 / bpm;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(startMs + i * spb);
  return out;
}
const dur = (b: number[]) => b[b.length - 1] + 500;

// 大抖动轨 (±12ms + 随机缺拍) 供容差对比
function jitterTrack() {
  const b = beatsOf(128, 140);
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  return b.filter(() => rnd() > 0.06).map(t => t + (rnd() * 2 - 1) * 12);
}

// ① 默认与显式 tolMs=15 一致
{
  const b = jitterTrack();
  const r = detectBpm(clickTrack(b, dur(b)));
  const c1 = extractConstantTempo(r)!;
  const c2 = extractConstantTempo(r, 0.1, 15)!;
  assert(JSON.stringify(c1) === JSON.stringify(c2), '① 默认容差 ≡ 显式 15ms (向后兼容)');
}

// ② 容差单调影响覆盖率
{
  const b = jitterTrack();
  const r = detectBpm(clickTrack(b, dur(b)));
  const lo = extractConstantTempo(r, 0.1, 3)!;
  const hi = extractConstantTempo(r, 0.1, 30)!;
  assert(lo.coverage < hi.coverage, `② 容差 3ms 覆盖率 < 30ms (${(lo.coverage * 100).toFixed(1)}% < ${(hi.coverage * 100).toFixed(1)}%)`);
}

// ③ 判定回归 (恒速不误报 / 变速能报)
{
  const b = beatsOf(128, 100);
  const c = extractConstantTempo(detectBpm(clickTrack(b, dur(b))), 0.1, 20)!;
  assert(c.variableSections.length === 0, '③a 恒速 128 容差 20ms 不误报');
  const bpms = [128, 200, 90, 175, 440, 60, 150, 222, 105, 300, 128, 180, 75, 250, 140, 330, 95, 210, 160, 120];
  const beats: number[] = [];
  let t = 500;
  for (let i = 0; i < bpms.length; i++) {
    const spb = 60000 / bpms[i];
    const n = 8 + (i % 9);
    for (let k = 0; k < n; k++) { beats.push(t); t += spb; }
  }
  const c2 = extractConstantTempo(detectBpm(clickTrack(beats, t + 500)), 0.1, 15)!;
  assert(c2.variableSections.length >= 1, `③b 20 段变速至少报 1 段 (实际 ${c2.variableSections.length})`);
}

console.log(failures ? `\nV500_PURE_FAILED: ${failures}` : '\nV500_PURE_PASSED');
process.exit(failures ? 1 : 0);
