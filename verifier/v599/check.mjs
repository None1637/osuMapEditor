// v599: 原生 BASS Tempo 慢放接线与打包契约 (行为测试见 native-smoke/e2e)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sidecar = read('native/BassAudioSidecar/Program.cs');
const audio = read('electron/bassAudio.cjs');
const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');
const bridge = read('src/osu/electronBridge.ts');
const store = read('src/osu/store.ts');
const pack = read('package.json');
const builder = read('electron-builder.yml');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

ok(sidecar.includes('BassFx.TempoCreate') && sidecar.includes('ChannelAttribute.Tempo'), '侧车使用 lazer 同源 BASS FX Tempo');
ok(sidecar.includes('(rate - 1) * 100') && !sidecar.includes('ChannelAttribute.Pitch'), 'Tempo 相对百分比且不改音高');
ok(sidecar.includes('Console.InputEncoding') && sidecar.includes('BassFlags.Unicode'), '中文/Unicode 音频路径支持');
ok(audio.includes('bass-audio-cache') && audio.includes('createHash'), '非曲库音频按原始字节哈希落临时文件');
ok(main.includes('ipcMain.handle("bass-play"') && preload.includes('bassPlay:') && bridge.includes('bassPlay(payload'), '主进程/preload/类型桥接完整');
ok(store.includes('bassWanted && this.startBass(offset)') && store.includes('this.stopBass()') && store.includes('bassVolume(musicGain())'), '播放/停止/音量接入原生支路');
ok(store.includes('this.destroyTempoNode(); this.destroyRateNode()'), 'BASS 与 Web Audio 音乐引擎互斥');
ok(pack.includes('"build:bass"') && pack.includes('--self-contained true'), '侧车自包含 .NET 发布');
ok(builder.includes('extraResources:') && builder.includes('to: native/BassAudioSidecar'), '便携 exe 包含原生 BASS 侧车');

execSync('node verifier/v599/native-smoke.mjs', { cwd: root, stdio: 'inherit' });
console.log(failures ? `VERIFIER_V599_FAILED: ${failures}` : 'VERIFIER_V599_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
