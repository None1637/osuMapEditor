// v102 纯函数单测: 时间轴框选/边缘滚动/绿线命中 (lazer TimelineDragBox + handleScrollViaDrag)
import {
  edgeScrollVelocity, edgeScrollRamp, marqueeObjectIds, marqueeGreenTimes, bandHit,
  EDGE_TOLERANCE_PX, EDGE_MAX_VELOCITY, EDGE_RAMP_MS, GREEN_PILL_TOP, PILL_HEIGHT,
} from '../../src/osu/timelineSelect';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// 1. lazer 常量
assert(EDGE_TOLERANCE_PX === 40 && EDGE_MAX_VELOCITY === 10 && EDGE_RAMP_MS === 5000,
  `lazer 常量 40/10/5000 (实际 ${EDGE_TOLERANCE_PX}/${EDGE_MAX_VELOCITY}/${EDGE_RAMP_MS})`);

// 2. 边缘滚动基础速度: 容差内 = 0
{
  const W = 1000;
  assert(edgeScrollVelocity(500, W) === 0, '中央不滚动');
  assert(edgeScrollVelocity(40, W) === 0, '左容差边界上不滚动');
  assert(edgeScrollVelocity(960, W) === 0, '右容差边界上不滚动');
  assert(near(edgeScrollVelocity(39, W), -1), '左超 1px => -1 (平方曲线)');
  assert(near(edgeScrollVelocity(38, W), -4), '左超 2px => -4 (平方曲线)');
}

// 3. 速度曲线: sign*min(10, overshoot²), overshoot 上限 40; overshoot ≥√10≈3.2px 即达满速 (lazer 原式如此)
{
  const W = 1000;
  const v5 = edgeScrollVelocity(40 - 5, W); // 左超 5px
  assert(near(v5, -10), `左超 5px => cap 10 (25>10, 实际 ${v5})`);
  const v40 = edgeScrollVelocity(W - 40 + 40, W); // 右超 40px
  assert(near(v40, 10), `右超 40px => cap 10 (实际 ${v40})`);
  const v100 = edgeScrollVelocity(W - 40 + 100, W); // 右超 100px 仍 clamp 40
  assert(near(v100, 10), `右超 100px 仍 cap 10 (实际 ${v100})`);
}

// 4. ramp: 5 秒线性到满速, 0 起步 (调用方在速度非 0 时累计, 避免 ramp=0 死锁)
{
  assert(near(edgeScrollRamp(0), 0), 'ramp(0) = 0');
  assert(near(edgeScrollRamp(EDGE_RAMP_MS / 2), 0.5), 'ramp(2500) = 0.5');
  assert(near(edgeScrollRamp(EDGE_RAMP_MS * 2), 1), 'ramp 封顶 1');
  assert(near(edgeScrollVelocity(0, 1000) * edgeScrollRamp(EDGE_RAMP_MS / 2), -5), '合成: 半 ramp 半速');
}

// 5. 框选物件: 时长区间相交即中 (v45 语义)
{
  const objs = [
    { id: 1, time: 1000 }, { id: 2, time: 2000 }, { id: 3, time: 3000 },
  ];
  const endOf = (o: { id: number; time: number }) => o.time + (o.id === 2 ? 800 : 0);
  assert(JSON.stringify(marqueeObjectIds(objs, endOf, 1500, 1900)) === '[]', '区间不相交不中');
  assert(JSON.stringify(marqueeObjectIds(objs, endOf, 1500, 2100)) === '[2]', '头在区间内中');
  assert(JSON.stringify(marqueeObjectIds(objs, endOf, 2500, 2700)) === '[2]', '尾在区间内也中 (相交语义)');
  assert(JSON.stringify(marqueeObjectIds(objs, endOf, 0, 4000)) === '[1,2,3]', '全覆盖全中');
}

// 6. 框选绿线: 只取绿线 (非红线), 含端点
{
  const tps = [
    { time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
    { time: 1000, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 },
    { time: 2000, beatLength: -50, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 },
    { time: 3000, beatLength: 400, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 },
  ];
  assert(JSON.stringify(marqueeGreenTimes(tps, 1000, 2000)) === '[1000,2000]', '端点含入, 红线排除');
  assert(JSON.stringify(marqueeGreenTimes(tps, 1001, 1999)) === '[]', '开区间外不中');
}

// 7. bandHit 纵带相交
{
  assert(bandHit(0, 10, 0, 60), '物件行内相交');
  assert(!bandHit(70, 90, 0, 60), '纵跨不及物件行不相交');
  assert(bandHit(70, 90, GREEN_PILL_TOP, PILL_HEIGHT), '覆盖绿线药丸带相交');
  assert(bandHit(0, 92, GREEN_PILL_TOP, PILL_HEIGHT), '全高度框覆盖药丸带');
}

if (failures) { console.error(`\nV102_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV102_TESTS_PASSED');
