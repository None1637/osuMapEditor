// 验证器 v502 真实谱面: Carnival 48kHz 立体声 (与 app decodeAudioData 同路径) — 主区 220
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const dir = 'F:/Backup/D/osu!/Songs/t+pazolite - Kick-ass Kung-fu Carnival';
execSync(`ffmpeg -y -v error -i "${dir}/14 - Kick-ass Kung-fu Carnival.mp3" -ac 2 -ar 48000 -f f32le verifier/v502/.stereo.pcm`);
const raw = readFileSync('verifier/v502/.stereo.pcm');
const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const pcm = all.subarray(Math.round(25 * 96)); // 25ms × 48000 × 2声道 = 2400 floats
const n = pcm.length / 2;
const buf = {
  sampleRate: 48000,
  numberOfChannels: 2,
  length: n,
  getChannelData: (ch: number) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = pcm[i * 2 + ch];
    return out;
  },
};
const c = extractConstantTempo(detectBpm(buf))!;
assert(Math.abs(c.bpm - 220) <= 1.1 || Math.abs(c.bpm - 110) <= 0.55 || Math.abs(c.bpm - 440) <= 2.2,
  `Carnival 立体声: 主区 220 (实际 ${c.bpm}, coverage=${(c.coverage * 100).toFixed(0)}%)`);

// 恒速区 (0~187s) 单红线网格 ≥99%
const osu = readFileSync(dir + '/t+pazolite - Kick-ass Kung-fu Carnival (None1637) [Extra].osu', 'utf8');
const tp = osu.split('[TimingPoints]')[1].split('[')[0];
const reds: { time: number; beatLength: number }[] = [];
for (const line of tp.split('\n')) {
  const f = line.trim().split(',');
  if (f.length >= 8 && Number(f[6]) === 1 && Number(f[1]) > 0) reds.push({ time: Number(f[0]), beatLength: Number(f[1]) });
}
const songEnd = pcm.length / 48000 * 1000 + 25;
const det: number[] = [];
const half = 30000 / c.bpm;
for (let t = c.offsetMs; t < songEnd; t += half) det.push(t);
for (let t = c.offsetMs - half; t > 0; t -= half) det.push(t);
det.sort((a, b) => a - b);
let ok = 0, tot = 0;
for (let i = 0; i < reds.length; i++) {
  const to = i + 1 < reds.length ? reds[i + 1].time : songEnd;
  for (let t = reds[i].time; t < to; t += reds[i].beatLength / 2) {
    if (t >= 187000) continue;
    tot++;
    let lo = 0, hi = det.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (det[m] < t) lo = m + 1; else hi = m; }
    const d = Math.min(Math.abs(det[lo] - t), lo > 0 ? Math.abs(det[lo - 1] - t) : 1e9);
    if (d < 15) ok++;
  }
}
assert(ok / tot >= 0.99, `Carnival 恒速区网格 ≥99% (实际 ${(ok / tot * 100).toFixed(1)}% ${ok}/${tot})`);

console.log(failures ? `\nV502_REAL_FAILED: ${failures}` : '\nV502_REAL_PASSED');
process.exit(failures ? 1 : 0);
