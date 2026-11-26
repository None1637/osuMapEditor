import { store } from '../../src/osu/store';
import type { Beatmap } from '../../src/osu/parser';

const bm = {
  general: { previewTime: 0 }, editor: { bookmarks: [] }, metadata: {}, difficulty: {},
  timingPoints: [], hitObjects: [],
} as unknown as Beatmap;
let failures = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };

store.playing = true;
store.load(bm, null);
ok(!store.playing, '普通 load 换图仍统一暂停');

store.playing = true;
store.load(bm, null, null, undefined, null, null, false, true);
ok(store.playing, 'preservePlayback=true 的刷新保留播放状态');
store.pause();

console.log(failures ? `V600_TESTS_FAILED: ${failures}` : 'V600_TESTS_PASSED');
if (failures) process.exit(1);
