// v603: BASS 实际位置与输出缓冲同步锚点
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sidecar = read('native/BassAudioSidecar/Program.cs');
const store = read('src/osu/store.ts');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
ok(sidecar.includes('var seconds = Bass.ChannelBytes2Seconds'), 'play-ack 返回 BASS 实际秒数');
ok(store.includes('this.clock.onStartedAtCtxTime(this.actx.currentTime, r.seconds * 1000)'), 'v607: 起播直接按秒数锚定, 不再扣缓冲');
ok(store.includes('this.scheduler?.resync()') && store.includes('this.resyncLoops()'), '同步后重排 hitsound 与滑条循环');
ok(store.includes('bassSync: { seconds: number; bufferMs: number; atMs: number }'), '暴露同步锚点供真实播放回归');
console.log(failures ? `VERIFIER_V603_FAILED: ${failures}` : 'VERIFIER_V603_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
