// v606/v607: 冻结校准方案已由「不扣缓冲」取代, 避免 130ms 固定偏差与卡顿
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const store = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
ok(!store.includes('bassLatencySamples') && !store.includes('bassLatencyMs'), 'v607: 已移除冻结缓冲校准状态');
ok(store.includes('this.nativeBassPosition = { seconds: msg.seconds, atMs: performance.now() }'), '位置事件只使用 BASS 秒数和时间戳');
ok(store.includes('this.bassSync = { ...this.nativeBassPosition, bufferMs: 0 }'), '调试锚点缓冲固定为 0');
console.log(failures ? `VERIFIER_V606_FAILED: ${failures}` : 'VERIFIER_V606_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
