import { store } from '../../src/osu/store';
import type { Beatmap } from '../../src/osu/parser';

const bm = {
  general: { previewTime: 0 }, editor: { bookmarks: [] }, metadata: {}, difficulty: {},
  timingPoints: [], hitObjects: [],
} as unknown as Beatmap;
store.playing = true;
store.load(bm, null);
if (store.playing) { console.error('V584_TESTS_FAILED: 换谱后仍在播放'); process.exit(1); }
console.log('V584_TESTS_PASSED: 换谱统一暂停');
