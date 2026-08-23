// 验证器 v76 纯函数测试: pendingPhantomPoint (放置预览幻影尾点判定, computePendingPath 与渲染共用)
import { pendingPhantomPoint, computePendingPath } from '../../src/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

section('pendingPhantomPoint: 幻影尾点判定');
{
  const pend = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  assert(pendingPhantomPoint(pend, null) === null, '无 cursor => null');
  assert(pendingPhantomPoint([], { x: 50, y: 50 }) !== null, '空 pend => cursor 即幻影点 (与 computePendingPath 原判定一致)');
  assert(pendingPhantomPoint(pend, { x: 201, y: 101 }) === null, 'cursor 距末点 <=2 => 无幻影点');
  const far = pendingPhantomPoint(pend, { x: 300, y: 160 });
  assert(far !== null && far.x === 300 && far.y === 160, 'cursor 远离末点 => 幻影点 = cursor');
}

section('computePendingPath: 幻影点经 pendingPhantomPoint 计入路径');
{
  const pend = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  const near = computePendingPath(pend, { x: 201, y: 101 });
  const nearEnd = near.raw[near.raw.length - 1];
  assert(Math.abs(nearEnd.x - 200) < 1 && Math.abs(nearEnd.y - 100) < 1, '近 cursor 不计入 (路径尾 = 末点)');
  const far = computePendingPath(pend, { x: 300, y: 100 });
  const farEnd = far.raw[far.raw.length - 1];
  assert(Math.abs(farEnd.x - 300) < 1 && Math.abs(farEnd.y - 100) < 1, '远 cursor 计入 (路径尾 = cursor)');
}

if (failures) { console.error(`\nTESTS_V76_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V76_ALL_PASSED');
