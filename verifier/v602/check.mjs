// v602: lazer TrackBass vs 本项目 BASS 参数路径 — 0.25x 多频+瞬态逐样本对照
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
execSync('dotnet build native/LazerAudioProbe/LazerAudioProbe.csproj -c Release', { cwd: root, stdio: 'inherit' });
const out = execSync(`"${path.join(root, 'native/LazerAudioProbe/bin/Release/net8.0/LazerAudioProbe.exe')}"`, { cwd: root, encoding: 'utf8' });
process.stdout.write(out);
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
ok(/different=0\/96000/.test(out), '0.25x 多频+瞬态全部 96000 个浮点样本零差异');
ok(/maxAbs=0 rms=0/.test(out), '最大绝对差与 RMS 均为 0');
const sidecar = fs.readFileSync(path.join(root, 'native/BassAudioSidecar/Program.cs'), 'utf8');
ok(sidecar.includes('ChannelAttribute.TempoUseQuickAlgorithm, 1')
  && sidecar.includes('ChannelAttribute.TempoOverlapMilliseconds, 4')
  && sidecar.includes('ChannelAttribute.TempoSequenceMilliseconds, 30')
  && sidecar.includes('(ChannelAttribute)65559, 1'), '正式侧车已应用反编译得到的 lazer Tempo 参数');
console.log(failures ? `VERIFIER_V602_FAILED: ${failures}` : 'VERIFIER_V602_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
