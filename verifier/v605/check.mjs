// v605/v607: 实时 pendingBytes 方案已由「不扣缓冲」取代, 避免 130ms 偏差与卡顿
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sidecar = read('native/BassAudioSidecar/Program.cs');
const store = read('src/osu/store.ts');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
ok(!sidecar.includes('DataFlags.Available'), 'v607: 不再读取动态待播放字节数');
ok(store.includes('this.bassSync = { ...this.nativeBassPosition, bufferMs: 0 }'), '位置锚点缓冲固定为 0, 不重复扣减');
ok(store.includes('this.nativeBassPosition.seconds * 1000'), 'positionMs 按最新实际秒数推进');
console.log(failures ? `VERIFIER_V605_FAILED: ${failures}` : 'VERIFIER_V605_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
