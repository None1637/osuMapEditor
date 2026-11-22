import { store } from '../../src/osu/store';
import type { Beatmap, HitObject } from '../../src/osu/parser';

const circle = (id: number, time: number): HitObject => ({ id, type: 'circle', x: 0, y: 0, time, hitSound: 4 });
const slider: HitObject = { id: 4, type: 'slider', x: 0, y: 0, time: 1500, hitSound: 4, curveType: 'L', curvePoints: [{ x: 100, y: 100 }], slides: 1, length: 100, edgeSoundsRaw: '4|4' };
const bm = {
  general: {}, editor: { bookmarks: [1000, 2000] }, metadata: {}, difficulty: {}, timingPoints: [],
  hitObjects: [circle(1, 500), circle(2, 1000), circle(3, 1500), slider],
} as unknown as Beatmap;
store.beatmap = bm;
store.currentTime = 1500;
store.lockNotes = false;
const objects = store.bookmarkHitSoundObjects();
if (objects.map(o => o.id).join(',') !== '2,3,4') { console.error(`V585_TESTS_FAILED: 区间物件 ${objects.map(o => o.id)}`); process.exit(1); }
store.applyBookmarkHitSound([2], { normalSet: 2, additionSet: 3, customIndex: 7, volume: 65 });
if (!objects.every(o => (o.hitSound ?? 0) === 2)) { console.error('V585_TESTS_FAILED: hitsound 位未统一'); process.exit(1); }
if (!objects.every(o => o.hitSampleRaw?.startsWith('2:3:7:65:'))) { console.error(`V585_TESTS_FAILED: 采样字段 ${objects[0].hitSampleRaw}`); process.exit(1); }
if (slider.edgeSoundsRaw !== '2|2') { console.error(`V585_TESTS_FAILED: 滑条边缘未同步 ${slider.edgeSoundsRaw}`); process.exit(1); }
if (bm.hitObjects[0].hitSound !== 4) { console.error('V585_TESTS_FAILED: 区间外物件被修改'); process.exit(1); }
store.beatmap = null;
console.log('V585_TESTS_PASSED');
