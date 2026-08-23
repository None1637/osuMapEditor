// v140 单元断言: dirtyFingerprint — 脏标记内容指纹
// 核心语义: 数据变更 -> 指纹变; 撤销回保存态/无实际改动 -> 指纹不变 (与保存基准一致, 不显示未保存)
import { dirtyFingerprint } from '../../src/osu/dirtyFingerprint';
import type { Beatmap } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

const mkBm = () => ({
  hitObjects: [{ id: 1, type: 'circle', x: 100, y: 100, time: 1000, newCombo: true, hitSound: 0 }],
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 }],
  difficulty: { hp: 5, cs: 4, od: 8, ar: 9, sliderMultiplier: 1.4, sliderTickRate: 1 },
  editor: { bookmarks: [], distanceSpacing: 1, beatDivisor: 4, gridSize: 4, timelineZoom: 1 },
  general: { audioFilename: 'a.mp3', audioLeadIn: 0, previewTime: -1, countdown: 0, sampleSet: 'Normal', stackLeniency: 0.7, mode: 0, letterbox: false, widescreenStoryboard: false },
  metadata: { title: 't', titleUnicode: 't', artist: 'a', artistUnicode: 'a', creator: 'c', version: 'v', source: '', tags: [], beatmapId: 0, beatmapSetId: 0 },
} as unknown as Beatmap);

{
  const bm = mkBm();
  const base = dirtyFingerprint(bm);
  assert(typeof base === 'string' && base.length > 0, '指纹为非空字符串');
  assert(dirtyFingerprint(bm) === base, '未改动 -> 指纹不变 (幂等)');

  // 深拷贝同内容 -> 指纹相同 (undo restore 走 deepCopy, 撤销回保存态指纹必须一致)
  const clone = JSON.parse(JSON.stringify(bm)) as Beatmap;
  assert(dirtyFingerprint(clone) === base, '同内容深拷贝 -> 指纹相同 (撤销回保存态 = 干净)');

  // 实际改动 -> 指纹变
  bm.hitObjects[0]!.x = 200;
  assert(dirtyFingerprint(bm) !== base, '改物件位置 -> 指纹变 (脏)');
  bm.hitObjects[0]!.x = 100;
  assert(dirtyFingerprint(bm) === base, '改回原值 -> 指纹回到基准 (无实际改动 = 不脏)');

  bm.timingPoints[0]!.beatLength = 600;
  assert(dirtyFingerprint(bm) !== base, '改 timing -> 指纹变');
  bm.timingPoints[0]!.beatLength = 500;

  bm.difficulty.cs = 5;
  assert(dirtyFingerprint(bm) !== base, '改难度参数 -> 指纹变');
  bm.difficulty.cs = 4;

  bm.editor.bookmarks = [12345];
  assert(dirtyFingerprint(bm) !== base, '改书签 ([Editor] 段会写入文件) -> 指纹变');
  bm.editor.bookmarks = [];

  assert(dirtyFingerprint(bm) === base, '全部改回 -> 指纹回到基准');
}

if (failures) { console.error(`\nV140_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV140_TESTS_ALL_PASSED');
