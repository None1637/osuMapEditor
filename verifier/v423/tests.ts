// v423 数值测试: break 休息段解析与命中查询
import { parseBreaks, breakAt } from '../../src/osu/gameplay/hud';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// ---- parseBreaks ----
assert(parseBreaks(undefined).length === 0, '无 Events 原文 = 空');
assert(parseBreaks([]).length === 0, '空数组 = 空');
{
  const ev = [
    '//Background and Video events',
    '2,5000,9000',
    'Break,12000,15000',
    'break,20000,21000', // 大小写兼容
    '// 注释行',
    '0,0,"bg.jpg",0,0', // 背景行不是 break
    '3,100,200', // 其他事件号不算
    '2,9000,5000', // 倒置丢弃
  ];
  const bs = parseBreaks(ev);
  assert(bs.length === 3, `解析 3 段 (实际 ${bs.length})`);
  assert(bs[0].start === 5000 && bs[0].end === 9000, '数字 2 形式');
  assert(bs[1].start === 12000 && bs[1].end === 15000, 'Break 关键字形式');
  assert(bs[2].start === 20000 && bs[2].end === 21000, '小写 break 兼容');
}

// ---- breakAt ----
const bs = parseBreaks(['2,5000,9000']);
assert(breakAt(bs, 4999) === null, '段前 null');
assert(breakAt(bs, 5000)?.start === 5000, '段起点命中 (含边界)');
assert(breakAt(bs, 7000) !== null, '段中命中');
assert(breakAt(bs, 9000) !== null, '段终点命中 (含边界)');
assert(breakAt(bs, 9001) === null, '段后 null');
assert(breakAt([], 100) === null, '无 break 段恒 null');

if (failures) { console.error(`\nV423_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV423_TESTS_PASSED');
