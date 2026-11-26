// v599: 原生 BASS 侧车真实初始化 + Tempo 播放/位置/停止协议冒烟测试
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publishExe = path.join(root, 'native/BassAudioSidecar/publish/BassAudioSidecar.exe');
const exe = process.env.BASS_EXE ?? (fs.existsSync(publishExe) ? publishExe : path.join(root, 'native/BassAudioSidecar/bin/Release/net8.0/BassAudioSidecar.exe'));
const wavPath = path.join(root, 'verifier/v599/tone.wav');
const sampleRate = 48000, frames = sampleRate;
const dataSize = frames * 4;
const wav = Buffer.alloc(44 + dataSize);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(dataSize, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 10000), 44 + i * 2);
fs.writeFileSync(wavPath, wav);

const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
child.stdout.on('data', d => { stdout += d.toString(); });
child.stderr.on('data', d => process.stderr.write(d));
const send = value => child.stdin.write(JSON.stringify(value) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const exit = new Promise(resolve => child.once('exit', resolve));
try {
  for (let i = 0; i < 50 && !stdout.includes('"ready"'); i++) await sleep(100);
  ok(stdout.includes('"ready"'), `BASS 初始化 (${stdout.trim() || '无 ready 输出'})`);
  send({ type: 'play', path: wavPath, offset: 0, rate: 0.5, volume: 0 });
  for (let i = 0; i < 50 && !stdout.includes('"play-ack"'); i++) await sleep(100);
  ok(stdout.includes('"play-ack","ok":true'), `0.5x Tempo 起播 (${stdout.trim()})`);
  await sleep(400);
  send({ type: 'position' });
  await sleep(100);
  ok(/"playing":true/.test(stdout), '播放状态为 playing');
  const positions = [...stdout.matchAll(/"seconds":([0-9.]+)/g)].map(m => Number(m[1]));
  const pos = positions.at(-1) ?? 0;
  ok(pos > 0.05 && pos < 0.5, `0.5x 播放位置按半速推进 (${pos.toFixed(3)}s)`);
  send({ type: 'stop' });
  for (let i = 0; i < 30 && !stdout.includes('"stop-ack"'); i++) await sleep(100);
  ok(stdout.includes('"stop-ack"'), '停止协议');
  send({ type: 'shutdown' });
  await Promise.race([exit, sleep(3000)]);
} finally {
  if (child.exitCode === null) child.kill();
  fs.rmSync(wavPath, { force: true });
}
console.log(failures ? `V599_NATIVE_FAILED: ${failures}` : 'V599_NATIVE_PASSED');
process.exit(failures ? 1 : 0);
