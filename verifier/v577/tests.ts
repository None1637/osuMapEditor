// v577: 暂停时不足 120px 的滚轮短手势在一帧后补步, 不再等待 90ms
import { store } from '../../src/osu/store';
import type { Beatmap, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const red: TimingPoint = { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 };
const wheelStore = store as unknown as { resetWheelGesture(): void };
function reset() {
  wheelStore.resetWheelGesture();
  store.beatmap = { hitObjects: [], timingPoints: [red], difficulty: { sliderMultiplier: 1.4 }, editor: { beatDivisor: 4 }, general: {}, metadata: {} } as unknown as Beatmap;
  store.beatSnap = 4;
  store.currentTime = 5000;
  store.playing = false;
  store.audio = null;
}

reset();
store.wheelSeek(40, 0);
assert(store.currentTime === 5000, '单个小增量仍在事件内累积, 不同步重复步进');
await sleep(50);
assert(store.currentTime === 5125, `50ms 内已补一步, 不经过旧 90ms 延迟 (实际 ${store.currentTime})`);

reset();
store.wheelSeek(40, 0); store.wheelSeek(40, 0);
await sleep(50);
assert(store.currentTime === 5125, `连续小增量合并后只补一步 (实际 ${store.currentTime})`);

reset();
store.wheelSeek(40, 0); store.wheelSeek(40, 0); store.wheelSeek(40, 0);
assert(store.currentTime === 5125, '累计满 120px 仍立即只走一步');
await sleep(50);
assert(store.currentTime === 5125, '已出刻度的手势不在帧末重复补步');

reset();
store.wheelSeek(-40, 0);
await sleep(50);
assert(store.currentTime === 4875, `负方向同样在一帧后响应 (实际 ${store.currentTime})`);
wheelStore.resetWheelGesture();

if (failures) { console.error(`V577_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V577_TESTS_PASSED');
