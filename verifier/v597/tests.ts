import { store } from '../../src/osu/store';
import type { Beatmap } from '../../src/osu/parser';

let failures = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const bm = {
  general: {}, editor: { bookmarks: [] }, metadata: {}, difficulty: {}, timingPoints: [], hitObjects: [],
} as unknown as Beatmap;
store.beatmap = bm;

store.addBookmark(2000.2);
store.addBookmark(1000.6);
ok(bm.editor.bookmarks.join(',') === '1001,2000', '添加书签取整并按时间排序');
store.addBookmark(1001);
ok(bm.editor.bookmarks.length === 2, '同一时刻重复添加不生成重复书签');

store.removeBookmarkNear(3000);
ok(bm.editor.bookmarks.join(',') === '1001', '删除离当前位置最近的书签');
store.removeBookmarkNear(3001);
ok(bm.editor.bookmarks.length === 0, 'lazer 2000ms 边界内允许删除');

store.addBookmark(4000);
store.removeBookmarkNear(6001);
ok(bm.editor.bookmarks.join(',') === '4000', '超过 2000ms 不误删远处书签');
store.beatmap = null;

console.log(failures ? `V597_TESTS_FAILED: ${failures}` : 'V597_TESTS_PASSED');
if (failures) process.exit(1);
