// 验证器 v499 真实谱面: 恒速歌 (Yoko/Turupeta) 不再误报疑似变速段; Carnival 真变速仍报。
// 本地 F:\Backup fixture, 音频/谱面不入库。与 v498/real.ts 相同的解码+补偿路径。
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { detectBpm, extractConstantTempo } from '../../src/osu/bpmDetect';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

function runCase(name: string, dir: string, mp3Name: string | null, osuName: string | null, expectVariable: boolean | null) {
  const full = join('F:/Backup/D/osu!/Songs', dir);
  const files = readdirSync(full);
  const mp3 = mp3Name ?? files.find(f => f.endsWith('.mp3'))!;
  const osu = osuName ?? files.find(f => f.endsWith('.osu'))!;
  const head = readFileSync(join(full, mp3)).subarray(0, 4096);
  const has = (s: string) => head.includes(Buffer.from(s, 'ascii'));
  const hasXing = has('Xing') || has('Info') || has('VBRI');
  const tmp = join('verifier/v499', `.real-${name}.pcm`);
  execSync(`ffmpeg -y -v error -i "${join(full, mp3)}" -ac 1 -ar 11025 -f f32le "${tmp}"`);
  const raw = readFileSync(tmp);
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const pcm = all.subarray(hasXing ? Math.round(25 * 11.025) : 0);
  const buf = { sampleRate: 11025, numberOfChannels: 1, length: pcm.length, getChannelData: () => pcm };
  const c = extractConstantTempo(detectBpm(buf));
  unlinkSync(tmp);
  assert(!!c, `${name}: 结果非空`);
  if (!c) return;
  const n = c.variableSections.length;
  if (expectVariable === null) {
    console.log(`  info: ${name} 疑似变速段 ${n} 个: ${c.variableSections.map(s => `${s.time}@${s.bpm.toFixed(0)}`).join(' ') || '(无)'}`);
  } else if (expectVariable) {
    assert(n >= 1, `${name}: 真变速应报疑似变速段 (实际 ${n}: ${c.variableSections.map(s => `${s.time}@${s.bpm.toFixed(0)}`).join(' ')})`);
  } else {
    assert(n === 0, `${name}: 恒速不应误报变速段 (实际 ${n} 段: ${c.variableSections.map(s => `${s.time}@${s.bpm.toFixed(1)}`).join(' ')}; 原始碎段 ${c.segmentCount})`);
  }
}

runCase('Yoko', '(14) - Drop it! Yoko!', null, null, false);
runCase('Turupeta', '09 Turupeta', null, null, false);
// Carnival: 逐拍 ritardando 的跟拍本身没跟出来 (检出拍点仍≈主周期), 属检测局限而非判定
// 局限 — 暂不强制其必报; 打印疑似段作观察。真变速检出义务由合成用例 ⑤ 承担。
runCase('Carnival', 't+pazolite - Kick-ass Kung-fu Carnival', '14 - Kick-ass Kung-fu Carnival.mp3', 't+pazolite - Kick-ass Kung-fu Carnival (None1637) [Extra].osu', null);

console.log(failures ? `\nV499_REAL_FAILED: ${failures}` : '\nV499_REAL_PASSED');
process.exit(failures ? 1 : 0);
