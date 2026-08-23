// 验证器 v93 纯函数测试: thumbBaseId — 缩略图合成物件 id 段 (防撞 pathCache/bodyCache)
import { thumbBaseId } from '../../src/components/patternThumb';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

section('thumbBaseId');
{
  const a = thumbBaseId('pattern-1');
  assert(a === thumbBaseId('pattern-1'), '同 id 多次调用稳定 (缓存命中正确)');
  assert(a < 0, `负 id 段 (实际 ${a}) — 不与真实物件正 id 冲突`);
  assert((a + 1) % 4096 === 0, '段内 4096 槽位对齐');
  const ids = ['p1', 'p2', 'pattern-1', 'pattern-2', '滑条收藏', 'abc', 'xyz'];
  const bases = new Set(ids.map(thumbBaseId));
  assert(bases.size === ids.length, `不同 pattern id 段互不重叠 (${bases.size}/${ids.length})`);
  // 段内物件: base - i (i < 4096) 仍在负段且不跨入其他段 (段间隔 4096)
  const b = thumbBaseId('p1');
  assert(b - 4095 < 0 && (b - 4095) > b - 4096, '段内偏移保持负 id');
}

if (failures) { console.error(`\nTESTS_V93_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V93_ALL_PASSED');
