// v514: 滚轮短手势结束补步 + 显式 seek 取消补步/解除 resumeFloor 钳制
import { store } from '../../src/osu/store';
import type { Beatmap, TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const red: TimingPoint = { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 };
const wheelStore = store as unknown as { resetWheelGesture(): void };
function reset(t = 5000) {
  wheelStore.resetWheelGesture();
  store.beatmap = { hitObjects: [], timingPoints: [red], difficulty: { sliderMultiplier: 1.4 }, editor: { beatDivisor: 4 }, general: {}, metadata: {} } as unknown as Beatmap;
  store.beatSnap = 4;
  store.currentTime = t;
  store.playing = false;
  store.audio = null;
  store.resumeFloorMs = null;
}

console.log('== 40+40: 连续事件不立即动，静默后补一步');
{
  reset();
  store.wheelSeek(40, 0); store.wheelSeek(40, 0);
  assert(store.currentTime === 5000, '不足 120px 时不立即 seek');
  await sleep(130);
  assert(store.currentTime === 5125, `90ms 后补 +1 网格 (实际 ${store.currentTime})`);
}

console.log('== 40+40+40 / 160: 已出刻度的手势不多补');
for (const deltas of [[40, 40, 40], [160]]) {
  reset();
  for (const d of deltas) store.wheelSeek(d, 0);
  assert(store.currentTime === 5125, `${deltas.join('+')} 立即只走一步 (实际 ${store.currentTime})`);
  await sleep(130);
  assert(store.currentTime === 5125, `${deltas.join('+')} 静默后仍只有一步 (实际 ${store.currentTime})`);
}

console.log('== LINE 模式与负方向短手势');
{
  reset();
  store.wheelSeek(3, 1); // 99px，旧逻辑第一次不动
  assert(store.currentTime === 5000, '3 行不立即 seek');
  await sleep(130);
  assert(store.currentTime === 5125, `3 行静默后补一步 (${store.currentTime})`);
  reset();
  store.wheelSeek(-40, 0);
  await sleep(130);
  assert(store.currentTime === 4875, `负方向补 -1 网格 (${store.currentTime})`);
}

console.log('== 显式 seek / 新手势取消过期补步');
{
  reset();
  store.wheelSeek(40, 0);
  store.seek(10000);
  await sleep(130);
  assert(store.currentTime === 10000, `显式 seek 后旧余量不补跳 (${store.currentTime})`);
  store.wheelSeek(40, 0);
  await sleep(130);
  assert(store.currentTime === 10125, `新手势独立补一步 (${store.currentTime})`);
}

console.log('== 播放中显式 seek 清 resumeFloorMs');
{
  reset(5000);
  store.playing = true;
  store.resumeFloorMs = 5000;
  store.seekWhilePlaying(4500);
  assert(store.currentTime === 4500, `播放中重定位生效 (${store.currentTime})`);
  assert(store.resumeFloorMs === null, '旧暂停点下限已清除，不再钳回');
  store.playing = false;
}
wheelStore.resetWheelGesture();

if (failures) { console.error(`V514_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V514_TESTS_PASSED');
