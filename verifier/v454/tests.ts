// 验证器 v454 纯函数测试: svRestoreTargetAt — Alt+拖滑条尾改 SV 时恢复绿线的插入时刻决策
// (后续滑条头; 无后续滑条或 (当前滑条头, 后续滑条头] 内已有红/绿线则不插)
import { svRestoreTargetAt } from '@/osu/timingSv';
import type { TimingPoint } from '@/osu/parser';

const green = (time: number): TimingPoint =>
  ({ time, beatLength: -100, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: false, effects: 0 });
const red = (time: number): TimingPoint =>
  ({ time, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 });
const slider = (time: number) => ({ type: 'slider', time });
const circle = (time: number) => ({ type: 'circle', time });

let failures = 0;
function eq(actual: number | null, expect: number | null, msg: string) {
  if (actual === expect) console.log(`  ok: ${msg} (实际 ${actual})`);
  else { failures++; console.error(`  FAIL: ${msg} — 期望 ${expect}, 实际 ${actual}`); }
}

// 1) 无后续滑条 → null (完全不插)
eq(svRestoreTargetAt([], [slider(1000)], 1000), null, '无后续滑条不插');
eq(svRestoreTargetAt([], [slider(1000), circle(2000)], 1000), null, '后续只有圆圈也不插');

// 2) 有后续滑条且区间无线 → 插到后续滑条头
eq(svRestoreTargetAt([], [slider(1000), slider(3000)], 1000), 3000, '无遮挡 → 后续滑条头');
eq(svRestoreTargetAt([red(0)], [slider(1000), circle(2000), slider(3000)], 1000), 3000,
  '中间有圆圈不算遮挡 (圆圈不是 timing 线)');

// 3) 多条后续滑条 → 取第一条
eq(svRestoreTargetAt([], [slider(1000), slider(5000), slider(2500)], 1000), 2500, '多条后续滑条取最早者');

// 4) 区间内绿线 → null (硬边界挡住)
eq(svRestoreTargetAt([green(2000)], [slider(1000), slider(3000)], 1000), null, '中间绿线挡住, 不插');

// 5) 区间内红线 → null (红线也重置 SV, v227 stable 语义)
eq(svRestoreTargetAt([red(2000)], [slider(1000), slider(3000)], 1000), null, '中间红线挡住, 不插');

// 6) 后续滑条头处恰有绿线 → null (头前已有绿线无需插)
eq(svRestoreTargetAt([green(3000)], [slider(1000), slider(3000)], 1000), null, '后续滑条头恰有绿线, 不插');

// 7) 边界: 线恰在当前滑条头 (afterTime, 如本次新建的头绿线) → 不算遮挡
eq(svRestoreTargetAt([green(1000)], [slider(1000), slider(3000)], 1000), 3000, '头处线 (含本次头绿线) 不算遮挡');

// 8) 线在后续滑条头之后 → 不算遮挡
eq(svRestoreTargetAt([green(4000)], [slider(1000), slider(3000)], 1000), 3000, '后续滑条头之后的线不算遮挡');

// 9) 同刻堆叠滑条 (time == afterTime) 不算"后续"
eq(svRestoreTargetAt([], [slider(1000), slider(1000)], 1000), null, '同刻滑条不算后续滑条');

if (failures) { console.error(`V454_TESTS_FAILED (${failures})`); process.exit(1); }
console.log('V454_TESTS_ALL_PASSED');
