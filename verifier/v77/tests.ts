// 验证器 v77 纯函数测试: pushRecent (最近难度列表维护)
import { pushRecent } from '../../server/recentsCore.mjs';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const e = (folderRel: string, file: string) => ({ folderRel, file, label: `${folderRel}/${file}` });

section('pushRecent: 新条目置顶 + 同键去重 + 上限');
{
  const r1 = pushRecent([], e('a', 'x.osu'));
  assert(r1.length === 1 && r1[0].file === 'x.osu', '空列表 => 单条');
  const r2 = pushRecent(r1, e('b', 'y.osu'));
  assert(r2.length === 2 && r2[0].file === 'y.osu' && r2[1].file === 'x.osu', '新条目置顶');
  const r3 = pushRecent(r2, e('a', 'x.osu'));
  assert(r3.length === 2 && r3[0].file === 'x.osu' && r3[1].file === 'y.osu', '同 (folderRel,file) 去重并提到最前');
  const r4 = pushRecent(r3, e('a', 'z.osu'));
  assert(r4.length === 3 && r4[0].file === 'z.osu' && r4.filter(x => x.folderRel === 'a').length === 2, '同文件夹不同文件不去重');
  let big: ReturnType<typeof e>[] = [];
  for (let i = 0; i < 15; i++) big = pushRecent(big, e('f', `${i}.osu`));
  assert(big.length === 10 && big[0].file === '14.osu' && big[9].file === '5.osu', `上限 10 条 (实际 ${big.length})`);
  const dedupLabel = pushRecent([e('a', 'x.osu')], { folderRel: 'a', file: 'x.osu', label: '新标题' });
  assert(dedupLabel.length === 1 && dedupLabel[0].label === '新标题', '去重时采用新 label');
}

if (failures) { console.error(`\nTESTS_V77_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V77_ALL_PASSED');
