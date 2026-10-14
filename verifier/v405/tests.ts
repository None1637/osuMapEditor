// v405 单元断言: 旋转/缩放窗口 stable 式布局的纯函数 (transform.ts)
import { axisScaleFactors, angleForDirection, directionForAngle } from '../../src/osu/transform';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}

// ---- axisScaleFactors: 未勾选轴按倍率 1 计算 ----
{
  const both = axisScaleFactors(1.5, 0.5, true, true);
  assert(both.sx === 1.5 && both.sy === 0.5, '两轴都勾: 各自倍率生效');
  const xOnly = axisScaleFactors(1.5, 0.5, true, false);
  assert(xOnly.sx === 1.5 && xOnly.sy === 1, '仅 X 轴: y 按 1');
  const yOnly = axisScaleFactors(1.5, 0.5, false, true);
  assert(yOnly.sx === 1 && yOnly.sy === 0.5, '仅 Y 轴: x 按 1');
  const none = axisScaleFactors(1.5, 0.5, false, false);
  assert(none.sx === 1 && none.sy === 1, '都不勾: 双轴 1 (no-op)');
}

// ---- angleForDirection: 选方向 = 角度取符号绝对值 ----
{
  assert(angleForDirection(30, 'cw') === 30, '顺时针: 正角不变');
  assert(angleForDirection(-30, 'cw') === 30, '顺时针: 负角翻正');
  assert(angleForDirection(30, 'ccw') === -30, '逆时针: 正角翻负');
  assert(angleForDirection(-30, 'ccw') === -30, '逆时针: 负角不变');
  assert(angleForDirection(0, 'ccw') === -0 || angleForDirection(0, 'ccw') === 0, '0 度选方向仍是 0');
}

// ---- directionForAngle: 输入角度反推方向 (0 保持原方向) ----
{
  assert(directionForAngle(45, 'ccw') === 'cw', '正角 -> 顺时针');
  assert(directionForAngle(-45, 'cw') === 'ccw', '负角 -> 逆时针');
  assert(directionForAngle(0, 'ccw') === 'ccw', '0 度保持原方向 (ccw)');
  assert(directionForAngle(0, 'cw') === 'cw', '0 度保持原方向 (cw)');
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');
