// v134/v139 单元断言: distGuideSnap — 间距辅助线吸附
// v139 语义修正: 参考点 (物件头/尾中心) 直接吸附到可见环带 (target = distR),
//   不再外扩 dragR (v134 边缘贴环带语义下吸附带在环带外侧一个物件半径处, 感觉不到吸附)
import { distGuideSnap } from '../../src/osu/geometryHelpers';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// 基准: CS 半径 r=50, geoDistValue=10 -> distR=60 (绘制环带半径 = snap 目标)
const TARGET = 60;

// --- 单点源 ---
{
  // p 距源心 65 (差 5 < 6.4) -> 吸附到 60 径向投射点
  const s = distGuideSnap({ x: 65, y: 0 }, TARGET, [{ x: 0, y: 0 }], []);
  assert(!!s && near(s.x, TARGET) && near(s.y, 0), '单点源: 65 -> 吸附到 60 (径向投射, 目标 = 可见环带)');
  // 内侧同样吸附: 55 -> 60
  const s2 = distGuideSnap({ x: 0, y: 55 }, TARGET, [{ x: 0, y: 0 }], []);
  assert(!!s2 && near(s2.y, TARGET), '单点源: 内侧 55 -> 吸附到 60');
  // 超阈值: 67 (差 7 > 6.4) -> null
  assert(distGuideSnap({ x: 67, y: 0 }, TARGET, [{ x: 0, y: 0 }], []) === null, '单点源: 差 7 > 阈值 6.4 不吸附');
  // 远距离 -> null
  assert(distGuideSnap({ x: 300, y: 0 }, TARGET, [{ x: 0, y: 0 }], []) === null, '单点源: 远处不吸附');
  // 更近者胜: 两源 (0,0)/(100,0), p=(164,0) 距第二源环带 (160) 差 4, 距第一源环带 (60) 差 104 -> 吸附到 160
  const s3 = distGuideSnap({ x: 164, y: 0 }, TARGET, [{ x: 0, y: 0 }, { x: 100, y: 0 }], []);
  assert(!!s3 && near(s3.x, 160), '多源取更近修正 (164 -> 160, 第二源)');
}

// --- 滑条源 (直线路径 (0,0)->(100,0)) ---
const line = [[{ x: 0, y: 0 }, { x: 100, y: 0 }]];
{
  // 中段法向: (50,55) 最近点 (50,0) d=55 差 5 -> 候选 (50,60)
  const s = distGuideSnap({ x: 50, y: 55 }, TARGET, [], line);
  assert(!!s && near(s.x, 50) && near(s.y, TARGET), '滑条中段: 55 -> 吸附到 60 (法向投射)');
  // 另一侧: (50,-55) -> (50,-60)
  const s2 = distGuideSnap({ x: 50, y: -55 }, TARGET, [], line);
  assert(!!s2 && near(s2.y, -TARGET), '滑条中段另一侧吸附');
  // 端帽 (半圆): 近端点 (100,0) 的等距目标半径 = 60; (100,63) 差 3 -> 吸附候选距端点 60; (100,8) 差 52 不吸附
  assert(distGuideSnap({ x: 100, y: 8 }, TARGET, [], line) === null, '端点附近远者不吸附');
  const s3 = distGuideSnap({ x: 100, y: 63 }, TARGET, [], line);
  assert(!!s3 && near(Math.hypot(s3.x - 100, s3.y), TARGET), '端帽: 吸附候选在端点半圆等距线上 (距端点 60)');
  // p 在路径上 (法向不定) -> null (不崩溃)
  assert(distGuideSnap({ x: 50, y: 0 }, TARGET, [], line) === null, 'p 在路径上 -> null (除零保护)');
  // 空来源 -> null
  assert(distGuideSnap({ x: 50, y: 55 }, TARGET, [], []) === null, '无来源 -> null');
}

if (failures) { console.error(`\nV134_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV134_TESTS_ALL_PASSED');
