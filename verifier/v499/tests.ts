// 验证器 v499: 变速/恒速高概率区分 — 逐拍 1/8、1/6 细分解释 + 未解释拍点聚簇判定
// ① 恒速 128 → 不报变速; ② 恒速+半程 breakdown → 不报; ③ 恒速+大抖动碎段 → 不报;
// ④ 同 BPM 相位重置段 → 不报 (同 BPM 不是变速); ⑤ 20 段变速 → 至少报 1 段。
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';
import type { AudioBufferLike } from '../../src/osu/waveformData';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

function clickTrack(beatTimesMs: number[], durMs: number, sr = 44100, offbeat = true): AudioBufferLike {
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

function beatsOf(bpm: number, count: number, startMs = 500): number[] {
  const spb = 60000 / bpm;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(startMs + i * spb);
  return out;
}

const dur = (b: number[]) => b[b.length - 1] + 500;

// ① 恒速 128
{
  const b = beatsOf(128, 100);
  const c = extractConstantTempo(detectBpm(clickTrack(b, dur(b))))!;
  assert(c.variableSections.length === 0, `① 恒速 128: 不报变速 (实际 ${c.variableSections.length} 段, 原始碎段 ${c.segmentCount})`);
}

// ② 恒速+半程 breakdown (第 40~59 拍只留隔拍强音)
{
  const b = beatsOf(128, 100);
  const sparse = b.filter((_, i) => i < 40 || i >= 60 || i % 2 === 0);
  const c = extractConstantTempo(detectBpm(clickTrack(sparse, dur(b))))!;
  assert(c.variableSections.length === 0, `② 半程 breakdown: 不报变速 (实际 ${c.variableSections.length} 段, 原始碎段 ${c.segmentCount})`);
}

// ③ 恒速+大抖动碎段 (逐拍 ±12ms 抖动 + 随机缺拍, 制造大量碎段)
{
  const b = beatsOf(128, 140);
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const jit = b.filter(() => rnd() > 0.06).map(t => t + (rnd() * 2 - 1) * 12);
  const c = extractConstantTempo(detectBpm(clickTrack(jit, dur(b))))!;
  assert(c.variableSections.length === 0, `③ 恒速大抖动: 不报变速 (实际 ${c.variableSections.length} 段, 原始碎段 ${c.segmentCount})`);
}

// ④ 同 BPM 相位重置 (第 50~69 拍整体平移 0.2 拍, 不同相位但同 BPM → 不是变速)
{
  const b = beatsOf(128, 100);
  const shifted = b.map((t, i) => i >= 50 && i < 70 ? t + (60000 / 128) * 0.2 : t);
  const c = extractConstantTempo(detectBpm(clickTrack(shifted, dur(b))))!;
  assert(c.variableSections.length === 0, `④ 同 BPM 相位重置: 不报变速 (实际 ${c.variableSections.length} 段)`);
}

// ⑤ 20 段变速 → 至少报 1 段真变速
{
  const bpms = [128, 200, 90, 175, 440, 60, 150, 222, 105, 300, 128, 180, 75, 250, 140, 330, 95, 210, 160, 120];
  const beats: number[] = [];
  let t = 500;
  for (let i = 0; i < bpms.length; i++) {
    const spb = 60000 / bpms[i];
    const n = 8 + (i % 9);
    for (let k = 0; k < n; k++) { beats.push(t); t += spb; }
  }
  const c = extractConstantTempo(detectBpm(clickTrack(beats, t + 500)))!;
  assert(c.variableSections.length >= 1, `⑤ 20 段变速: 至少报 1 段 (实际 ${c.variableSections.length} 段: ${c.variableSections.map(s => `${s.time}@${s.bpm.toFixed(0)}`).join(' ')})`);
}

console.log(failures ? `\nV499_PURE_FAILED: ${failures}` : '\nV499_PURE_PASSED');
process.exit(failures ? 1 : 0);
