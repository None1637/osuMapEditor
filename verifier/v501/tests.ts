// 验证器 v501 纯函数段: 合并后红线列 (lines) — 恒速只有一条主线, 不再列出碎段
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

// ① 恒速 128 → 只有一条主恒速线
{
  const b = beatsOf(128, 100);
  const c = extractConstantTempo(detectBpm(clickTrack(b, dur(b))))!;
  assert(c.lines.length === 1 && Math.abs(c.lines[0].bpm - 128) < 0.64, `① 恒速 128: lines=1 (实际 ${JSON.stringify(c.lines)})`);
}

// ② 恒速+半程 breakdown → 仍只有一条主线
{
  const b = beatsOf(128, 100);
  const sparse = b.filter((_, i) => i < 40 || i >= 60 || i % 2 === 0);
  const c = extractConstantTempo(detectBpm(clickTrack(sparse, dur(b))))!;
  assert(c.lines.length === 1, `② breakdown: lines=1 (实际 ${c.lines.length})`);
}

// ③ 20 段变速 → 多条线但远少于原始碎段, 且主线+疑似变速段构成
{
  const bpms = [128, 200, 90, 175, 440, 60, 150, 222, 105, 300, 128, 180, 75, 250, 140, 330, 95, 210, 160, 120];
  const beats: number[] = [];
  let t = 500;
  for (let i = 0; i < bpms.length; i++) {
    const spb = 60000 / bpms[i];
    const n = 8 + (i % 9);
    for (let k = 0; k < n; k++) { beats.push(t); t += spb; }
  }
  const r = detectBpm(clickTrack(beats, t + 500));
  const c = extractConstantTempo(r)!;
  assert(c.lines.length >= 2 && c.lines.length < r.segments.length, `③ 变速: lines=${c.lines.length} (原始 ${r.segments.length} 段)`);
  assert(c.lines.length === 1 + c.variableSections.length, '③ lines = 主线 + 疑似变速段数');
  for (let i = 1; i < c.lines.length; i++) assert(c.lines[i].time >= c.lines[i - 1].time, '③ lines 按时间排序');
}

console.log(failures ? `\nV501_PURE_FAILED: ${failures}` : '\nV501_PURE_PASSED');
process.exit(failures ? 1 : 0);
