// v618: 保留 v600 轻量慢放, 仅按 play-ack 的实际 BASS 位置重锚一次
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sidecar = read('native/BassAudioSidecar/Program.cs');
const store = read('src/osu/store.ts');
const bridge = read('src/osu/electronBridge.ts');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
ok(sidecar.includes('var seconds = Bass.ChannelBytes2Seconds') && sidecar.includes('ok = true, rate, seconds'), 'play-ack 返回实际 BASS 起播位置');
ok(sidecar.includes('now - lastBufferSampleMs >= 1000'), 'v620 Available 降为每秒校准, 位置包保持轻量');
ok(store.includes('this.clock.onStartedAtCtxTime(this.actx.currentTime, r.seconds * 1000 - this.bassBufferMs)'), 'ack 时按实际可闻位置重锚 AudioClock (v620)');
ok(store.includes('this.scheduler?.resync()') && store.includes('this.resyncLoops()'), '重锚后重排 hitsound 与滑条循环');
ok(store.includes('bassSync') && store.includes('nativeBassPosition'), 'v619 BASS 唯一时间源状态');
ok(bridge.includes('seconds?: number') && bridge.includes('onBassPosition'), '桥接 seconds 与轻量位置订阅');
console.log(failures ? `VERIFIER_V618_FAILED: ${failures}` : 'VERIFIER_V618_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
