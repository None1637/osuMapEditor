// v290 数值测试: 曲库搜索查询解析/匹配 (librarySearch) + 轻量索引解析 (parseIndexEntry)
// 语义对齐 lazer FilterQueryParser.cs / BeatmapCarouselFilterMatching.cs
import { parseLibraryQuery, matchLibraryEntry } from '../../src/osu/librarySearch';
import { parseIndexEntry, type LibraryIndexEntry } from '../../src/osu/libraryIndex';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// 条目工厂 (缺省值可被覆盖)
function entry(over: Partial<LibraryIndexEntry> = {}): LibraryIndexEntry {
  return {
    dirName: '12345 xi - Halcyon', fileName: 'xi - Halcyon (mapper) [Insane].osu',
    title: 'Halcyon', titleUnicode: '', artist: 'xi', artistUnicode: '', creator: 'mapper',
    version: 'Insane', mode: 0, tags: 'tag1 tag2', source: '', beatmapID: '12345', beatmapSetID: '6789',
    hp: 6, cs: 4, od: 8, ar: 9, bpm: 120, lengthMs: 90000, star: null,
    size: 1000, lastModified: 1,
    ...over,
  };
}
const hit = (q: string, e: LibraryIndexEntry) => matchLibraryEntry(parseLibraryQuery(q), e);

// ---------- 键值对过滤 ----------
assert(hit('ar>8', entry({ ar: 9 })) && !hit('ar>8', entry({ ar: 8 })), 'ar>8 数值大于 (容差外)');
assert(hit('bpm<=180 ar=9', entry({ bpm: 180, ar: 9 })), 'bpm<=180 ar=9 双条件 AND');
assert(!hit('bpm<=180 ar=9', entry({ bpm: 181, ar: 9 })), 'bpm<=180 超界不命中');
assert(Math.abs(9.04 - 9) <= 0.05 && hit('ar=9', entry({ ar: 9.04 })) && !hit('ar=9', entry({ ar: 9.1 })), 'ar=9 容差 0.05');

// creator="xi" 引号值文本键
{
  const q = parseLibraryQuery('creator="xi"');
  assert(q.filters.length === 1 && q.filters[0]!.key === 'creator' && q.filters[0]!.value === 'xi', 'creator="xi" 解析为文本过滤');
  assert(matchLibraryEntry(q, entry({ creator: 'xi' })) && !matchLibraryEntry(q, entry({ creator: 'other' })), 'creator="xi" 匹配/排除');
}

// 自由文本
assert(hit('halcyon', entry()) && !hit('nonexistent', entry()), '自由文本子串匹配/排除');
assert(hit('hello world', entry({ title: 'say hello world again' })), '多 term AND (同字段顺序无关)');
assert(!hit('hello missing', entry({ title: 'say hello again' })), '多 term AND 缺一不命中');
assert(hit('"hello world"', entry({ title: 'say hello world again' })), '"短语" 词边界短语命中');
assert(!hit('"ello worl"', entry({ title: 'say hello world again' })), '"短语" 非词边界不命中');
assert(hit('"xi"!', entry({ artist: 'xi' })), '"..."! 整字段相等命中');
assert(!hit('"xi"!', entry({ artist: 'xi feat. someone' })), '"..."! 整字段不等不命中');

// [Insane] → diff 过滤
{
  const q = parseLibraryQuery('[Insane]');
  assert(q.diff === 'Insane', '[Insane] 段解析为 diff 过滤');
  assert(matchLibraryEntry(q, entry({ version: 'Insane' })) && !matchLibraryEntry(q, entry({ version: 'Hard' })), '[Insane] 匹配难度名');
}

// star=5.5 容差 0.005; 无星级不命中
assert(hit('star=5.5', entry({ star: 5.504 })), 'star=5.5 容差内命中');
assert(!hit('star=5.5', entry({ star: 5.51 })), 'star=5.5 容差外不命中');
assert(!hit('star=5.5', entry({ star: null })), 'star: 无星级数据不命中');
assert(hit('star>5', entry({ star: 5.2 })) && !hit('star>5', entry({ star: 5.0 })), 'star> 比较');

// length=1:30 (90000ms ± 500)
assert(hit('length=1:30', entry({ lengthMs: 90300 })) && !hit('length=1:30', entry({ lengthMs: 91000 })), 'length=1:30 容差=最小单位一半 (0.5s)');
assert(hit('length=90', entry({ lengthMs: 90000 })), 'length 纯秒格式');

// keys=7 仅 mania (mode=3), 精确
assert(hit('keys=7', entry({ mode: 3, cs: 7 })), 'keys=7 mania 条目命中');
assert(!hit('keys=7', entry({ mode: 0, cs: 7 })), 'keys=7 非 mania 不命中');
assert(!hit('keys=7', entry({ mode: 3, cs: 4 })), 'keys=7 键数不符不命中');

// mode=std / 反选
assert(hit('mode=std', entry({ mode: 0 })) && !hit('mode=std', entry({ mode: 3 })), 'mode=std');
assert(hit('mode!=std', entry({ mode: 3 })) && !hit('mode!=std', entry({ mode: 0 })), 'mode!=std 反选');
assert(hit('mode=3', entry({ mode: 3 })), 'mode 数字值');

// 未知键不退化: 留作自由文本 term
{
  const q = parseLibraryQuery('foo=bar');
  assert(q.filters.length === 0 && q.terms.some(t => t.text === 'foo=bar'), '未知键 foo=bar 留作自由文本');
}

// 纯数字 term → beatmapID/beatmapSetID 兜底
assert(hit('12345', entry({ beatmapID: '12345' })), '纯数字 term 兜底匹配 beatmapID');
assert(hit('6789', entry({ beatmapSetID: '6789' })), '纯数字 term 兜底匹配 beatmapSetID');
assert(!hit('99999', entry()), '纯数字 term 无命中');

// != 反选 (数值 + 文本)
assert(hit('ar!=9', entry({ ar: 8 })) && !hit('ar!=9', entry({ ar: 9 })), 'ar!=9 数值反选');
assert(hit('creator!=xi', entry({ creator: 'other' })) && !hit('creator!=xi', entry({ creator: 'xi' })), 'creator!=xi 文本反选');

// tag 词级子串
assert(hit('tag=tag1', entry({ tags: 'tag1 tag2' })), 'tag= 词级子串命中');
assert(hit('tag=ag1', entry({ tags: 'tag1 tag2' })), 'tag= 词内子串亦命中 (lazer 同语义: 逐词 contains)');
assert(!hit('tag=ag3', entry({ tags: 'tag1 tag2' })), 'tag= 无匹配词不命中');

// hp/dr 同义 + dirName 参与自由文本
assert(hit('dr=6', entry({ hp: 6 })), 'dr 同义 hp');
assert(hit('halcyon', entry({ title: '', dirName: '12345 xi - Halcyon' })), 'dirName 兼容旧目录名搜索');

// ---------- parseIndexEntry 轻解析 ----------
const osuText = [
  'osu file format v14',
  '',
  '[General]',
  'AudioFilename:audio.mp3',
  'Mode:0',
  '',
  '[Metadata]',
  'Title:Halcyon',
  'TitleUnicode:Halcyon JP',
  'Artist:xi',
  'ArtistUnicode:xi JP',
  'Creator:mapper',
  'Version:Insane',
  'Source:sourceX',
  'Tags:tag1 tag2',
  'BeatmapID:12345',
  'BeatmapSetID:6789',
  '',
  '[Difficulty]',
  'HPDrainRate:6.5',
  'CircleSize:4',
  'OverallDifficulty:8',
  'ApproachRate:9.2',
  '',
  '[TimingPoints]',
  '1000,500,4,2,1,50,1,0',
  '2000,500,4,2,1,50,1,0',
  '3000,400,4,2,1,50,1,0',
  '4000,-100,4,2,1,50,0,0',
  '',
  '[HitObjects]',
  '64,64,5000,1,0,0:0:0:0:',
  '256,192,6000,2,0,B|200:200,1,100',
  '300,300,7000,12,0,9000,0:0:0:0:',
  '',
].join('\n');

{
  const e = parseIndexEntry(osuText, '12345 xi - Halcyon', 'a.osu', 1000, 42);
  assert(e.title === 'Halcyon' && e.titleUnicode === 'Halcyon JP', 'parseIndexEntry: Title/TitleUnicode');
  assert(e.artist === 'xi' && e.artistUnicode === 'xi JP', 'parseIndexEntry: Artist/ArtistUnicode');
  assert(e.creator === 'mapper' && e.version === 'Insane', 'parseIndexEntry: Creator/Version');
  assert(e.tags === 'tag1 tag2' && e.source === 'sourceX', 'parseIndexEntry: Tags/Source');
  assert(e.beatmapID === '12345' && e.beatmapSetID === '6789', 'parseIndexEntry: BeatmapID/BeatmapSetID');
  assert(e.hp === 6.5 && e.cs === 4 && e.od === 8 && e.ar === 9.2, 'parseIndexEntry: HP/CS/OD/AR');
  assert(e.bpm === 120, 'parseIndexEntry: BPM 取众数 beatLength (500ms×2 > 400ms×1 → 120)');
  assert(e.lengthMs === 4000, 'parseIndexEntry: lengthMs 用 spinner end time (9000-5000)');
  assert(e.star === null && e.size === 1000 && e.lastModified === 42, 'parseIndexEntry: star 初始 null + size/lastModified');
  assert(e.mode === 0, 'parseIndexEntry: Mode');
}

// 无非继承 timing point → 回退第一个正值; AR 缺省 = OD
{
  const t2 = osuText
    .replace('[TimingPoints]\n1000,500,4,2,1,50,1,0\n2000,500,4,2,1,50,1,0\n3000,400,4,2,1,50,1,0\n4000,-100,4,2,1,50,0,0', '[TimingPoints]\n1000,-50,4,2,1,50,0,0')
    .replace('ApproachRate:9.2\n', '');
  const e = parseIndexEntry(t2, 'd', 'b.osu');
  assert(e.bpm === 0, 'parseIndexEntry: 无非继承点 → bpm=0');
  assert(e.ar === 8, 'parseIndexEntry: AR 缺省回退 OD');
}

if (failures) { console.error(`\nV290_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV290_TESTS_PASSED');
