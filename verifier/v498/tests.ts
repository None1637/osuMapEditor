// 验证器 v498 纯函数段入口: 合成点击轨测 bpmDetect + extractConstantTempo (esbuild bundle 后 node 跑)
// 用例: ①恒速 128 (单红线网格 ≥99%); ②20 段变速 (回归监控, 非验收线);
//       ③160 歧义; ④恒速 128 + 半程 breakdown (1/8 细分合并后仍单红线 ≥99%)
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';
import type { AudioBufferLike } from '../../src/osu/waveformData';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

/** 合成点击轨: 节拍时刻放 2kHz 指数衰减正弦 (10ms 衰减), 近似鼓点瞬态;
 *  offbeat=true 时在半拍处加 0.35 幅度的弱击 (真实音乐的八分音符能量, 供倍/半程歧义裁决) */
export function clickTrack(beatTimesMs: number[], durMs: number, sr = 44100, offbeat = false): AudioBufferLike {
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
    if (offbeat) {
      const half = i + 1 < beatTimesMs.length ? (beatTimesMs[i] + beatTimesMs[i + 1]) / 2 : beatTimesMs[i] + 150;
      put(half, 0.35);
    }
  }
  return { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => data };
}

/** 变速段列 → 节拍时刻列 (段间无缝拼接: 每段从上一段末拍时刻开始) */
export function beatsOfSegments(segs: { bpm: number; beats: number }[], startMs = 500): { beats: number[]; segStart: number[] } {
  const beats: number[] = [];
  const segStart: number[] = [];
  let t = startMs;
  for (const s of segs) {
    segStart.push(t);
    const spb = 60000 / s.bpm;
    for (let k = 0; k < s.beats; k++) { beats.push(t); t += spb; }
  }
  return { beats, segStart };
}

/** 单红线网格覆盖率: 参考 1/2 细分点 vs 检出恒速网格 (bpm 翻倍/减半时网格天然兼容, 用户认可) */
function constantGridMatch(refBeats: number[], endMs: number, bpm: number, offsetMs: number): number {
  const det: number[] = [];
  const half = 30000 / bpm;
  for (let t = offsetMs; t < endMs; t += half) det.push(t);
  for (let t = offsetMs - half; t > 0; t -= half) det.push(t);
  det.sort((a, b) => a - b);
  let ok = 0;
  for (const t of refBeats) {
    let lo = 0, hi = det.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (det[m] < t) lo = m + 1; else hi = m; }
    const d = Math.min(Math.abs(det[lo] - t), lo > 0 ? Math.abs(det[lo - 1] - t) : 1e9);
    if (d < 15) ok++;
  }
  return ok / refBeats.length;
}

// ---------- ① 恒速 128 BPM: 单红线覆盖 ≥99% ----------
{
  const { beats } = beatsOfSegments([{ bpm: 128, beats: 100 }]);
  const dur = beats[beats.length - 1] + 500;
  const r = detectBpm(clickTrack(beats, dur, 44100, true));
  const c = extractConstantTempo(r);
  assert(!!c, '① 恒速结果非空');
  if (c) {
    const ref: number[] = [];
    for (let i = 0; i < beats.length; i++) ref.push(beats[i], beats[i] + (60000 / 128) / 2);
    const cov = constantGridMatch(ref, dur, c.bpm, c.offsetMs);
    assert(cov >= 0.99, `① 恒速 128: 单红线 1/2 网格 ≥99% (实际 ${(cov * 100).toFixed(1)}%; bpm=${c.bpm} offset=${c.offsetMs})`);
  }
}

// ---------- ② 20 段变速 (回归监控, 非验收线: 逐拍/短段变速超出恒速范围) ----------
{
  const bpms = [128, 200, 90, 175, 440, 60, 150, 222, 105, 300, 128, 180, 75, 250, 140, 330, 95, 210, 160, 120];
  const segs = bpms.map((bpm, i) => ({ bpm, beats: 8 + (i % 9) }));
  const { beats, segStart } = beatsOfSegments(segs);
  const dur = beats[beats.length - 1] + 500;
  const r = detectBpm(clickTrack(beats, dur, 44100, true));
  const half = (ss: { time: number; bpm: number }[], end: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < ss.length; i++) {
      const to = i + 1 < ss.length ? ss[i + 1].time : end;
      for (let t = ss[i].time; t < to; t += 30000 / ss[i].bpm) out.push(t);
    }
    return out;
  };
  const refSegs = segs.map((s, i) => ({ time: segStart[i], bpm: s.bpm }));
  const ref = half(refSegs, dur), det = half(r.segments, dur);
  let ok = 0;
  for (const t of ref) if (det.some(x => Math.abs(x - t) < 15)) ok++;
  const pct = ok / ref.length;
  assert(pct >= 0.75, `② 变速 20 段 (回归监控): 1/2 细分点 ≥75% (实际 ${(pct * 100).toFixed(1)}%; ${r.segments.length} 段)`);
}

// ---------- ③ 160 BPM: 单红线覆盖 ≥99% (倍/半程由用户认可, 只考网格) ----------
{
  const { beats } = beatsOfSegments([{ bpm: 160, beats: 120 }]);
  const dur = beats[beats.length - 1] + 500;
  const r = detectBpm(clickTrack(beats, dur, 44100, true));
  const c = extractConstantTempo(r);
  assert(!!c, '③ 恒速结果非空');
  if (c) {
    const ref: number[] = [];
    for (let i = 0; i < beats.length; i++) ref.push(beats[i], beats[i] + (60000 / 160) / 2);
    const cov = constantGridMatch(ref, dur, c.bpm, c.offsetMs);
    assert(cov >= 0.99, `③ 160: 单红线 1/2 网格 ≥99% (实际 ${(cov * 100).toFixed(1)}%; bpm=${c.bpm})`);
  }
}

// ---------- ④ 恒速 128 + 半程 breakdown (第 40~59 拍只有隔拍强音): 1/8 细分合并 ----------
{
  const { beats } = beatsOfSegments([{ bpm: 128, beats: 100 }]);
  const dur = beats[beats.length - 1] + 500;
  // breakdown 区间只保留隔拍强音 (音乐上半程感, 但底层 BPM 不变)
  const sparse = beats.filter((b, i) => i < 40 || i >= 60 || i % 2 === 0);
  const r = detectBpm(clickTrack(sparse, dur, 44100, true));
  const c = extractConstantTempo(r);
  assert(!!c, '④ 恒速结果非空');
  if (c) {
    const ref: number[] = [];
    for (let i = 0; i < beats.length; i++) ref.push(beats[i], beats[i] + (60000 / 128) / 2);
    const cov = constantGridMatch(ref, dur, c.bpm, c.offsetMs);
    assert(cov >= 0.99, `④ 恒速+半程 breakdown: 单红线 1/2 网格 ≥99% (实际 ${(cov * 100).toFixed(1)}%; bpm=${c.bpm} segs=${c.segmentCount} cov=${(c.coverage * 100).toFixed(0)}%)`);
  }
}

console.log(failures ? `\nV498_PURE_FAILED: ${failures}` : '\nV498_PURE_PASSED');
process.exit(failures ? 1 : 0);
