// 验证器 v378 纯函数部分: 旋转手柄偏移参数化 (需求 6 — 偏移改固定屏幕 px, 由调用方按缩放换算传入)
import { rotationHandlePoints, hitRotationHandle, ROT_HANDLE_OUT } from '../../src/osu/selectionBox';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name: string) { console.log('== ' + name); }

section('v378: rotationHandlePoints / hitRotationHandle 自定义偏移 out');
{
  const dq = { x: 100, y: 50, w: 200, h: 100 };
  const d0 = rotationHandlePoints(dq); // 默认 = ROT_HANDLE_OUT (v50 行为不变)
  assert(ROT_HANDLE_OUT === 12.5, `ROT_HANDLE_OUT 仍为 12.5 (实际 ${ROT_HANDLE_OUT})`);
  assert(d0[0].x === 87.5 && d0[0].y === 37.5, '默认偏移不变 (v50 兼容)');
  const d1 = rotationHandlePoints(dq, ROT_HANDLE_OUT / 2); // 模拟游玩区 2x 缩放后的换算值
  assert(d1[0].x === 93.75 && d1[0].y === 43.75, `out=6.25 时 tl 偏移减半 (${d1[0].x},${d1[0].y})`);
  assert(d1[3].x === 306.25 && d1[3].y === 156.25, 'out=6.25 时 br 偏移减半');
  assert(hitRotationHandle(dq, { x: 93.75, y: 43.75 }, 4, ROT_HANDLE_OUT / 2) === 'tl', '命中与绘制同一 out (缩放后手柄位置)');
  assert(hitRotationHandle(dq, { x: 87.5, y: 37.5 }, 4, ROT_HANDLE_OUT / 2) === null, '旧偏移位置不再命中 (缩放后不漂移)');
  assert(hitRotationHandle(dq, { x: 310, y: 165 }, 8) === 'br', '默认 out 命中不变 (v50 兼容)');
}

if (failures) { console.error(`\nTESTS_V378_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V378_ALL_PASSED');
