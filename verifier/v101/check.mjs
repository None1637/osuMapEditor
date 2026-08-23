// v101 源码接线断言: hitsound 总线 + 并发上限
// 运行: node verifier/v101/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const store = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
const limiter = fs.readFileSync(path.join(root, 'src/osu/clock/voiceLimiter.ts'), 'utf8');

// voiceLimiter 模块
assert(/export const SAMPLE_CONCURRENCY = 6/.test(limiter), 'voiceLimiter: SAMPLE_CONCURRENCY = 6 (lazer OsuGameBase)');
assert(/export class VoiceLimiter/.test(limiter), 'voiceLimiter: VoiceLimiter 类导出');
assert(/while \(sounding\.length \+ 1 > this\.cap\)/.test(limiter), 'voiceLimiter: 同时发声超限逐出最老 (v122: 只数发声中 voice, 预排程未来 voice 不占名额)');
assert(/register\(key: K, v: V, start: number, end: number\)/.test(limiter), 'voiceLimiter: register 带发声区间 (start/end)');

// store 接线
assert(/import \{ SAMPLE_CONCURRENCY, VoiceLimiter \} from '\.\/clock\/voiceLimiter'/.test(store), 'store: 引入 voiceLimiter');
assert(/export const HITSOUND_BUS_GAIN = 0\.8/.test(store), 'store: HITSOUND_BUS_GAIN = 0.8 (总线余量)');
assert(/private hitBus: GainNode \| null = null/.test(store), 'store: hitBus 字段');
assert(/this\.hitBus\.gain\.value = HITSOUND_BUS_GAIN/.test(store), 'store: 总线增益生效');
assert(/this\.hitBus\.connect\(this\.actx\.destination\)/.test(store), 'store: 总线接 destination');
assert(/private voiceLimiter = new VoiceLimiter<AudioBuffer, \{ src: AudioBufferSourceNode; gain: GainNode \}>\(SAMPLE_CONCURRENCY\)/.test(store), 'store: voiceLimiter 实例 (按 buffer 计, 上限 6; v122 记录 gain 供淡出)');
assert(/private trackVoice\(buf: AudioBuffer, src: AudioBufferSourceNode, gain: GainNode, startCtx: number/.test(store), 'store: trackVoice 辅助 (v122: 带发声区间)');
assert(/addEventListener\('ended'/.test(store), 'store: ended 注销 voice');

// 三处出声点 (一次性 hitsound + sliderslide 循环 + v156 节拍器) 都必须走总线 + 计入并发上限
const busConnects = store.match(/gain\.connect\(this\.ensureHitBus\(\)\)/g) ?? [];
assert(busConnects.length === 3, `三处出声点都接 hitsound 总线 (v156 新增节拍器; 实际 ${busConnects.length} 处)`);
const tracks = store.match(/this\.trackVoice\(buf, src, gain,/g) ?? [];
assert(tracks.length === 3, `三处出声点都计入并发上限 (v156 新增节拍器; 实际 ${tracks.length} 处)`);

// hitsound 路径不再直连 destination (音乐路径除外: 只允许 ensureHitBus + ensureMusicBus 两处 destination)
const destConnects = store.match(/connect\(this\.actx\.destination\)/g) ?? [];
assert(destConnects.length === 2, `store 内只剩两条总线直连 destination (v144 新增音乐总线; 实际 ${destConnects.length} 处: ${destConnects.join('; ')})`);

if (failures) { console.error(`\nV101_CHECK_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV101_CHECK_PASSED');
