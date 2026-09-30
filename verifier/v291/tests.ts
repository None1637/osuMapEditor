// v291 数值测试: placeholderFromDirName 目录名 → 占位条目解析
import { placeholderFromDirName } from '../../src/osu/libraryIndex';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// 标准命名: "setid Artist - Title"
const a = placeholderFromDirName('12345 xi - FREEDOM DiVE');
assert(a.beatmapSetID === '12345', 'setid 提取');
assert(a.artist === 'xi' && a.title === 'FREEDOM DiVE', 'artist/title 拆分');
assert(a.fileName === '' && a.star === null && a.bpm === 0, '占位标记 (fileName 空)');

// 无 setid
const b = placeholderFromDirName('Camellia - Exit This Earth');
assert(b.beatmapSetID === '-1' && b.artist === 'Camellia' && b.title === 'Exit This Earth', '无 setid 目录');

// 无 " - " 分隔
const c = placeholderFromDirName('some random folder');
assert(c.artist === '' && c.title === 'some random folder', '无分隔符 → 整名为 title');

// 标题含 " - " 只按第一个拆分
const d = placeholderFromDirName('678 Artist - Title - Sub');
assert(d.artist === 'Artist' && d.title === 'Title - Sub', '仅第一个 " - " 为界');

// setid 后无 artist
const e = placeholderFromDirName('999 JustTitle');
assert(e.beatmapSetID === '999' && e.artist === '' && e.title === 'JustTitle', 'setid+无分隔');

if (failures) { console.error(`\nV291_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV291_TESTS_PASSED');
