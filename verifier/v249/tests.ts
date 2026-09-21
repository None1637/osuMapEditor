// v249: dialogFit 纯函数边界
import { dialogFit } from '@/osu/uiZoom';

let failures = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

assert(dialogFit(300, 264, 1280, 720) === 1, '视口够大 → 1 (自然大小)');
assert(dialogFit(300, 264, 2560, 1440) === 1, '设计分辨率 → 1');
{
  // 对应 CDP 场景 C 实测内容区 344x241 (Electron 360x280 窗口含边框)
  const f = dialogFit(300, 264, 344, 241);
  assert(Math.abs(f - Math.min(336 / 300, 233 / 264)) < 1e-9, `极小窗口等比缩小 (${f.toFixed(3)})`);
  assert(f < 1, 'fit < 1');
}
assert(dialogFit(300, 264, 308, 272) === 1, '恰好多 8px 边距 → 1');
{
  const f = dialogFit(300, 264, 307, 272);
  assert(Math.abs(f - 299 / 300) < 1e-9, '宽度差 1px → 按宽缩');
}

if (failures) { console.error(`V249_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V249_TESTS_PASSED');
