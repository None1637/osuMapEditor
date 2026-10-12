// 验证器 v403 纯函数测试: 曲库骨架条目 (partial, 纯文件名解析) 按文件名信息可搜 + 等待索引提示条件
import { parseLibraryQuery, matchLibraryEntry, matchLibraryEntryPartial, partialQueryNeedsIndex } from '../../src/osu/librarySearch';
import { difficultyFromFileName } from '../../src/osu/libraryIndex';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// 骨架: "cygnus - Book of Dark Magic (None1637) [Magic].osu"
const skel = difficultyFromFileName('12345 cygnus - Book of Dark Magic', 'cygnus - Book of Dark Magic (None1637) [Magic].osu');
const full = { ...skel, partial: false, bpm: 180, ar: 9, cs: 4, od: 8, hp: 6, lengthMs: 120000, tags: 'dark magic', source: '', mode: 0 };

section('骨架字段来自文件名');
{
  assert(skel.partial === true, '骨架 partial=true');
  assert(skel.artist === 'cygnus' && skel.title === 'Book of Dark Magic', 'artist/title 解析');
  assert(skel.creator === 'None1637' && skel.version === 'Magic', 'creator/version 解析');
}

section('骨架可搜: 文件名可答条件 (v403 核心)');
{
  const hit = (q: string) => matchLibraryEntryPartial(parseLibraryQuery(q), skel);
  assert(hit('book of'), '自由文本命中标题');
  assert(hit('cygnus'), '自由文本命中艺术家');
  assert(hit('none1637'), '自由文本命中 mapper');
  assert(hit('[magic]'), '[diff] 段命中难度名');
  assert(!hit('[insane]'), '[diff] 段排除不符难度');
  assert(hit('artist=cygnus'), 'artist 键命中');
  assert(hit('title="dark magic"'), 'title 键短语命中');
  assert(hit('creator=None1637'), 'creator 键命中');
  assert(hit('mapper=None1637'), 'mapper 别名命中');
  assert(hit('diff=magic'), 'diff 键命中');
  assert(!hit('artist=other'), 'artist 键排除');
  assert(hit('12345'), '纯数字兜底 beatmapSetID (目录名前缀解析)');
}

section('骨架不可答条件: 排除 + 提示等待索引');
{
  const no = (q: string) => !matchLibraryEntryPartial(parseLibraryQuery(q), skel);
  assert(no('bpm>100'), 'bpm 条件骨架不命中');
  assert(no('ar=9'), 'ar 条件骨架不命中');
  assert(no('length>1:00'), 'length 条件骨架不命中');
  assert(no('mode=std'), 'mode 条件骨架不命中 (文件名无 mode 信息)');
  assert(no('tag=dark'), 'tag 条件骨架不命中');
  assert(no('keys=4'), 'keys 条件骨架不命中');
  assert(partialQueryNeedsIndex(parseLibraryQuery('bpm>100')), 'partialQueryNeedsIndex: bpm 需要索引');
  assert(partialQueryNeedsIndex(parseLibraryQuery('cygnus bpm>100')), '混合查询含数值键 → 需要索引');
  assert(!partialQueryNeedsIndex(parseLibraryQuery('cygnus')), '纯文本不需要索引');
  assert(!partialQueryNeedsIndex(parseLibraryQuery('[magic]')), '[diff] 段不需要索引');
  assert(!partialQueryNeedsIndex(parseLibraryQuery('artist=cygnus')), 'artist 键不需要索引');
}

section('完整条目行为不变 (matchLibraryEntry 未动)');
{
  assert(matchLibraryEntry(parseLibraryQuery('bpm>100'), full), '完整条目 bpm 命中');
  assert(matchLibraryEntry(parseLibraryQuery('[magic] cygnus'), full), '完整条目 [diff]+文本命中');
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');
