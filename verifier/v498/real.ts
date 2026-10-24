// 验证器 v498 真实谱面验收 (node + ffmpeg 解码, 不经 app):
// 恒速歌 Drop it! Yoko! / 09 Turupeta 全图单红线网格 ≥99%;
// Carnival (变速) 只验收恒速区 (0~187s 主速度段) ≥99%, 全曲打印作参考。
// 编码延迟: Xing/Info/VBRI 头帧会被 ffmpeg 解码成静音帧, stable(BASS) 跳过 → 补偿 25ms。
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

function decodeMp3(mp3: string, tmp: string): { pcm: Float32Array; trimmedMs: number } {
  const head = readFileSync(mp3).subarray(0, 4096);
  const has = (s: string) => head.includes(Buffer.from(s, 'ascii'));
  const hasXing = has('Xing') || has('Info') || has('VBRI');
  execSync(`ffmpeg -y -v error -i "${mp3}" -ac 1 -ar 11025 -f f32le "${tmp}"`);
  const raw = readFileSync(tmp);
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const trimMs = hasXing ? 25 : 0;
  return { pcm: all.subarray(Math.round(trimMs * 11.025)), trimmedMs: trimMs };
}

function redLines(osuPath: string): { time: number; beatLength: number }[] {
  const txt = readFileSync(osuPath, 'utf8');
  const tp = txt.split('[TimingPoints]')[1]?.split('[')[0] ?? '';
  const reds: { time: number; beatLength: number }[] = [];
  for (const line of tp.split('\n')) {
    const f = line.trim().split(',');
    if (f.length >= 8 && Number(f[6]) === 1 && Number(f[1]) > 0) reds.push({ time: Number(f[0]), beatLength: Number(f[1]) });
  }
  return reds;
}

function matchZones(reds: { time: number; beatLength: number }[], songEnd: number, bpm: number, offsetMs: number, zones: [number, number][]): { ok: number; tot: number } {
  const det: number[] = [];
  const half = 30000 / bpm;
  for (let t = offsetMs; t < songEnd; t += half) det.push(t);
  for (let t = offsetMs - half; t > 0; t -= half) det.push(t);
  det.sort((a, b) => a - b);
  let ok = 0, tot = 0;
  for (let i = 0; i < reds.length; i++) {
    const to = i + 1 < reds.length ? reds[i + 1].time : songEnd;
    for (let t = reds[i].time; t < to; t += reds[i].beatLength / 2) {
      if (!zones.some(([lo, hi]) => t >= lo && t < hi)) continue;
      tot++;
      let lo = 0, hi = det.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (det[m] < t) lo = m + 1; else hi = m; }
      const d = Math.min(Math.abs(det[lo] - t), lo > 0 ? Math.abs(det[lo - 1] - t) : 1e9);
      if (d < 15) ok++;
    }
  }
  return { ok, tot };
}

function runCase(name: string, dir: string, mp3Name: string | null, zones: [number, number][], minPct: number, osuName: string | null = null) {
  const full = join('F:/Backup/D/osu!/Songs', dir);
  const files = readdirSync(full);
  const mp3 = mp3Name ?? files.find(f => f.endsWith('.mp3'))!;
  const osu = osuName ?? files.find(f => f.endsWith('.osu'))!;
  const reds = redLines(join(full, osu));
  const tmp = join('verifier/v498', `.real-${name.replace(/[^\w]/g, '_')}.pcm`);
  const { pcm, trimmedMs } = decodeMp3(join(full, mp3), tmp);
  const buf = { sampleRate: 11025, numberOfChannels: 1, length: pcm.length, getChannelData: () => pcm };
  const r = detectBpm(buf);
  const c = extractConstantTempo(r);
  unlinkSync(tmp);
  assert(!!c, `${name}: 恒速结果非空`);
  if (!c) return;
  const songEnd = pcm.length / 11025 * 1000 + trimmedMs;
  const { ok, tot } = matchZones(reds, songEnd, c.bpm, c.offsetMs, zones);
  const pct = ok / tot * 100;
  assert(pct >= minPct, `${name}: 单红线网格 ≥${minPct}% (实际 ${pct.toFixed(1)}% ${ok}/${tot}; bpm=${c.bpm} offset=${c.offsetMs} cov=${(c.coverage * 100).toFixed(0)}% segs=${c.segmentCount})`);
  if (name.includes('Carnival')) {
    const all = matchZones(reds, songEnd, c.bpm, c.offsetMs, [[0, Infinity]]);
    console.log(`  info: Carnival 全曲(含逐拍 ritardando/相位重置段, 非验收线): ${(all.ok / all.tot * 100).toFixed(1)}%`);
  }
}

runCase('Yoko', '(14) - Drop it! Yoko!', null, [[0, Infinity]], 99);
runCase('Turupeta', '09 Turupeta', null, [[0, Infinity]], 99);
runCase('Carnival', 't+pazolite - Kick-ass Kung-fu Carnival', '14 - Kick-ass Kung-fu Carnival.mp3', [[0, 187000]], 99, 't+pazolite - Kick-ass Kung-fu Carnival (None1637) [Extra].osu');

console.log(failures ? `\nV498_REAL_FAILED: ${failures}` : '\nV498_REAL_PASSED');
process.exit(failures ? 1 : 0);
