// 验证器 v155 纯函数测试: parser [Editor] Bookmarks 解析/序列化 round-trip
import { parseOsu, serializeOsu } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const BASE = `osu file format v14

[General]
AudioFilename: a.mp3
PreviewTime: 12345

[Editor]
DistanceSpacing: 1.2
BeatDivisor: 4
GridSize: 8
TimelineZoom: 2
BOOKMARKS_PLACEHOLDER
[Metadata]
Title: t

[Difficulty]
HPDrainRate: 5

[TimingPoints]
0,500,4,1,0,80,1,0

[HitObjects]
256,192,1000,1,0,0:0:0:0:
`;

section('parseOsu: [Editor] Bookmarks');
{
  const bm = parseOsu(BASE.replace('BOOKMARKS_PLACEHOLDER', 'Bookmarks: 1000,2500,4000\n'));
  assert(JSON.stringify(bm.editor.bookmarks) === '[1000,2500,4000]', '逗号分隔书签解析为 number[]');
  assert(bm.general.previewTime === 12345, 'PreviewTime 不受影响');

  const bm2 = parseOsu(BASE.replace('BOOKMARKS_PLACEHOLDER', ''));
  assert(Array.isArray(bm2.editor.bookmarks) && bm2.editor.bookmarks.length === 0, '无 Bookmarks 行 → 默认空数组');

  const bm3 = parseOsu(BASE.replace('BOOKMARKS_PLACEHOLDER', 'Bookmarks: abc,500, ,700x\n'));
  assert(JSON.stringify(bm3.editor.bookmarks) === '[500,700]', '非法项被过滤 (abc/空 → NaN 滤除; 700x → parseInt 取 700)');
}

section('serializeOsu: Bookmarks 条件写出 + round-trip');
{
  const bm = parseOsu(BASE.replace('BOOKMARKS_PLACEHOLDER', 'Bookmarks: 1000,2500,4000\n'));
  const out = serializeOsu(bm);
  assert(out.includes('Bookmarks: 1000,2500,4000'), '有书签时写出 Bookmarks 行');

  const bm2 = parseOsu(BASE.replace('BOOKMARKS_PLACEHOLDER', ''));
  assert(!serializeOsu(bm2).includes('Bookmarks:'), '空书签不写出该行');

  const bm3 = parseOsu(serializeOsu(bm));
  assert(JSON.stringify(bm3.editor.bookmarks) === '[1000,2500,4000]', 'round-trip 书签保持');
}

if (failures) { console.error(`V155_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V155_TESTS_PASSED');
