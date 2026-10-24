// 验证器 v506 真实谱面: Carnival 开头 30s 内无误报变速线
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const dir = 'F:/Backup/D/osu!/Songs/t+pazolite - Kick-ass Kung-fu Carnival';
execSync(`ffmpeg -y -v error -i "${dir}/14 - Kick-ass Kung-fu Carnival.mp3" -ac 1 -ar 11025 -f f32le verifier/v506/.c.pcm`);
const raw = readFileSync('verifier/v506/.c.pcm');
const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const pcm = all.subarray(Math.round(25 * 11.025));
const buf = { sampleRate: 11025, numberOfChannels: 1, length: pcm.length, getChannelData: () => pcm as Float32Array };
const c = extractConstantTempo(detectBpm(buf))!;
assert(c.variableSections.every(v => v.time >= 30000), `Carnival 开头 30s 内无误报变速线 (实际 ${c.variableSections.map(v => `${v.time}@${v.bpm.toFixed(0)}`).join(' ') || '(无)'})`);
console.log('  info: lines =', c.lines.map(l => `${l.time}@${l.bpm.toFixed(1)}`).join(' '));
console.log(failures ? `\nV506_REAL_FAILED: ${failures}` : '\nV506_REAL_PASSED');
process.exit(failures ? 1 : 0);
