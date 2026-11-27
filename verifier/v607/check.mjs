// v607: 不扣缓冲 + 50ms 位置回传, 消除固定偏差与高频卡顿
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sidecar = read('native/BassAudioSidecar/Program.cs');
const store = read('src/osu/store.ts');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
ok(sidecar.includes('}, null, 0, 50)') && !sidecar.includes('DataFlags.Available'), '50ms 位置回传且不再读取动态缓冲');
ok(store.includes('this.nativeBassPosition = { seconds: msg.seconds, atMs: performance.now() }'), '渲染端只使用位置秒数和时间戳');
ok(store.includes('+ (performance.now() - this.nativeBassPosition.atMs) * this.playbackRate'), 'positionMs 不再重复扣缓冲');
ok(store.includes('const bufferMs = 0') && store.includes('this.clock.onStartedAtCtxTime(this.actx.currentTime, r.seconds * 1000)'), '起播锚点不再扣缓冲');
console.log(failures ? `VERIFIER_V607_FAILED: ${failures}` : 'VERIFIER_V607_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
