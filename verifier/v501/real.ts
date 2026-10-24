// 验证器 v501 真实谱面: 恒速歌合并后只有一条主恒速线; Nare outro 真变速独立证据
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

function detectSong(dir: string, mp3Name: string | null) {
  const full = join('F:/Backup/D/osu!/Songs', dir);
  const files = readdirSync(full);
  const mp3 = mp3Name ?? files.find(f => f.endsWith('.mp3'))!;
  const head = readFileSync(join(full, mp3)).subarray(0, 4096);
  const has = (s: string) => head.includes(Buffer.from(s, 'ascii'));
  const hasXing = has('Xing') || has('Info') || has('VBRI');
  const tmp = join('verifier/v501', '.real.pcm');
  execSync(`ffmpeg -y -v error -i "${join(full, mp3)}" -ac 1 -ar 11025 -f f32le "${tmp}"`);
  const raw = readFileSync(tmp);
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const pcm = all.subarray(hasXing ? Math.round(25 * 11.025) : 0);
  const buf = { sampleRate: 11025, numberOfChannels: 1, length: pcm.length, getChannelData: () => pcm };
  const c = extractConstantTempo(detectBpm(buf));
  unlinkSync(tmp);
  return c;
}

for (const [name, dir] of [['Yoko', '(14) - Drop it! Yoko!'], ['Turupeta', '09 Turupeta']] as const) {
  const c = detectSong(dir, null)!;
  assert(c.lines.length === 1, `${name}: 恒速合并后 lines=1 (实际 ${c.lines.length}: ${c.lines.map(l => `${l.time}@${l.bpm.toFixed(1)}`).join(' ')})`);
}

// Nare: 主区 145 (检出 290=2×), outro (~208s) 独立 ACF 证实 173.7 — 真变速, 应保留两条线
{
  const c = detectSong('1041086 YURRY CANON - Dareka no Shinzou ni Nareta Nara', null)!;
  assert(c.lines.length <= 3, `Nare: 合并后 lines≤3 (实际 ${c.lines.length})`);
  assert(c.lines.length === 1 + c.variableSections.length, 'Nare: lines = 主线 + 疑似变速段');
  console.log('  info: Nare lines =', c.lines.map(l => `${l.time}@${l.bpm.toFixed(1)}`).join(' '), '(outro 173.7 独立 ACF 证据, 非误报)');
}

console.log(failures ? `\nV501_REAL_FAILED: ${failures}` : '\nV501_REAL_PASSED');
process.exit(failures ? 1 : 0);
