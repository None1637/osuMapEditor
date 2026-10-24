// 验证器 v503 纯函数段: 短段误报过滤 (<4s 且 <16 拍不报疑似变速)
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

// ① 安静前奏的短异速段 (弱 onset) → 不报 (绝对支撑阈值, 而非时长过滤)
function mixClicks(parts: { beats: number[]; scale: number }[], durMs: number, sr = 44100): AudioBufferLike {
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
  for (const part of parts) {
    for (let i = 0; i < part.beats.length; i++) {
      put(part.beats[i], 0.9 * part.scale);
      const half = i + 1 < part.beats.length ? (part.beats[i] + part.beats[i + 1]) / 2 : part.beats[i] + 150;
      put(half, 0.35 * part.scale);
    }
  }
  return { sampleRate: sr, numberOfChannels: 1, length: n, getChannelData: () => data };
}
{
  const early = beatsOf(167, 8);
  const rest = beatsOf(128, 92, early[early.length - 1] + 60000 / 167);
  const buf = mixClicks([{ beats: early, scale: 0.07 }, { beats: rest, scale: 1 }], rest[rest.length - 1] + 500);
  const c = extractConstantTempo(detectBpm(buf))!;
  assert(c.variableSections.length === 0, `① 安静前奏短异速段不报 (实际 ${c.variableSections.map(v => `${v.time}@${v.bpm.toFixed(0)}`).join(' ') || '(无)'})`);
}

// ② 长真变速段 (中段 24 拍 167) → 仍应报
{
  const a = beatsOf(128, 40);
  const mid = beatsOf(167, 24, a[a.length - 1] + 60000 / 128);
  const rest = beatsOf(128, 36, mid[mid.length - 1] + 60000 / 167);
  const beats = [...a, ...mid, ...rest];
  const c = extractConstantTempo(detectBpm(clickTrack(beats, dur(beats))))!;
  assert(c.variableSections.length >= 1, `② 长真变速段应报 (实际 ${c.variableSections.length})`);
}

console.log(failures ? `\nV503_PURE_FAILED: ${failures}` : '\nV503_PURE_PASSED');
process.exit(failures ? 1 : 0);
