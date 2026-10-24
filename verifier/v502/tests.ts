// 验证器 v502 纯函数段: 立体声分声道独立检测选最优 (coverage×拍点数)
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';
import type { AudioBufferLike } from '../../src/osu/waveformData';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

function clickChannel(beatTimesMs: number[], durMs: number, sr = 44100): Float32Array {
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
  return data;
}
function beatsOf(bpm: number, count: number, startMs = 500): number[] {
  const spb = 60000 / bpm;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(startMs + i * spb);
  return out;
}
const dur = (b: number[]) => b[b.length - 1] + 500;

function stereoBuf(left: Float32Array, right: Float32Array, sr = 44100): AudioBufferLike {
  return {
    sampleRate: sr,
    numberOfChannels: 2,
    length: left.length,
    getChannelData: (ch: number) => (ch === 0 ? left : right),
  };
}

// ① 左 128 / 右 90 (混合会互相干扰) → 应选左声道 128
{
  const b1 = beatsOf(128, 100), b2 = beatsOf(90, 100);
  const end = Math.max(dur(b1), dur(b2));
  const r = detectBpm(stereoBuf(clickChannel(b1, end), clickChannel(b2, end)));
  const c = extractConstantTempo(r)!;
  assert(Math.abs(c.bpm - 128) <= 0.64 || Math.abs(c.bpm - 256) <= 1.28 || Math.abs(c.bpm - 64) <= 0.32,
    `① 左 128 右 90: 选左声道 (实际 ${c.bpm}, coverage=${(c.coverage * 100).toFixed(0)}%)`);
}

// ② 左 128 / 右静音 → 仍选左 (静音不得拖垮检出)
{
  const b1 = beatsOf(128, 100);
  const r = detectBpm(stereoBuf(clickChannel(b1, dur(b1)), new Float32Array(clickChannel([], dur(b1)).length)));
  const c = extractConstantTempo(r)!;
  assert(Math.abs(c.bpm - 128) <= 0.64, `② 左 128 右静音: 选左声道 (实际 ${c.bpm})`);
}

// ③ 左右同轨 128 → 结果与单声道一致
{
  const b1 = beatsOf(128, 100);
  const ch = clickChannel(b1, dur(b1));
  const c = extractConstantTempo(detectBpm(stereoBuf(ch, ch)))!;
  assert(Math.abs(c.bpm - 128) <= 0.64 && c.lines.length === 1, `③ 双同轨: ${c.bpm}, lines=${c.lines.length}`);
}

console.log(failures ? `\nV502_PURE_FAILED: ${failures}` : '\nV502_PURE_PASSED');
process.exit(failures ? 1 : 0);
