// 验证器 v506 纯函数段: 拍数占比 <3% 的短段不报疑似变速 (替代时长过滤)
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

// ① 开头短异速段 (强 onset 但仅 8/136 拍 ≈5.9%? 需 <3%) → 不报
{
  const early = beatsOf(173, 2); // 仅 2 拍 (<3%)
  const rest = beatsOf(128, 98, early[early.length - 1] + 60000 / 173);
  const c = extractConstantTempo(detectBpm(clickTrack([...early, ...rest], dur(rest))))!;
  assert(c.variableSections.every(v => v.time >= 30000), `① <3% 拍点短段不报 (实际 ${c.variableSections.map(v => `${v.time}@${v.bpm.toFixed(0)}`).join(' ') || '(无)'})`);
}

// ② 较长真变速段 (24 拍 173) → 仍报
{
  const a = beatsOf(128, 40);
  const mid = beatsOf(173, 24, a[a.length - 1] + 60000 / 128);
  const rest = beatsOf(128, 36, mid[mid.length - 1] + 60000 / 173);
  const c = extractConstantTempo(detectBpm(clickTrack([...a, ...mid, ...rest], dur(rest))))!;
  assert(c.variableSections.length >= 1, `② 真变速段应报 (实际 ${c.variableSections.length})`);
}

console.log(failures ? `\nV506_PURE_FAILED: ${failures}` : '\nV506_PURE_PASSED');
process.exit(failures ? 1 : 0);
