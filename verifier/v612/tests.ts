import { parseOsu } from '../../src/osu/parser';
import { createDifficultyCopy, saveBeatmap, type MapSource } from '../../src/osu/saveMap';

let failures = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const bm = parseOsu(`osu file format v14

[General]
AudioFilename: song.mp3

[Metadata]
Title:Song
Artist:Artist
Creator:Mapper
Version:Insane

[Difficulty]
CircleSize:4

[HitObjects]
256,192,1000,1,0
`);
const draft = structuredClone(bm);
draft.metadata.version = 'Expert';
draft.difficulty.cs = 7;
const cleared = createDifficultyCopy(draft, true);
ok(cleared.fileName === 'Artist - Song (Mapper) [Expert].osu', `新难度名进入 stable 文件名 (${cleared.fileName})`);
ok(cleared.beatmap.hitObjects.length === 0, '确认清空时副本物件为空');
ok(cleared.beatmap.difficulty.cs === 7, 'Song Setup 修改写入副本');
ok(draft.hitObjects.length === 1 && bm.hitObjects.length === 1 && bm.metadata.version === 'Insane', '清空副本不修改草稿或原谱面');
const kept = createDifficultyCopy(draft, false);
ok(kept.beatmap.hitObjects.length === 1, '选择保留时复制原有物件');

const writes = new Map<string, string>();
const dir: MapSource['dir'] = {
  kind: 'directory', name: 'song',
  async *entries() { },
  async getFileHandle() { throw new Error('not needed'); },
  async writeFile(name, content) { writes.set(name, content); },
};
await saveBeatmap(cleared.beatmap, { dir, fileName: cleared.fileName });
ok(writes.size === 1 && writes.has(cleared.fileName), '只写新难度文件, 不写原文件名');
const text = writes.get(cleared.fileName) ?? '';
ok(text.includes('Version: Expert') && text.includes('CircleSize: 7'), '落盘包含新难度名和设置');
ok(!text.includes('256,192,1000'), '清空后的新文件不包含原物件');

console.log(failures ? 'TESTS_V612_FAILED' : 'TESTS_V612_ALL_PASSED');
if (failures) process.exit(1);
