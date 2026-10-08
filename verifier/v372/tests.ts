// 验证器 v372 纯函数测试: sampleSetCode / rangeTimes / fmtTpPrec
import { sampleSetCode, rangeTimes, fmtTpPrec } from '@/osu/timingEdit';

let failures = 0;
function eq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) { failures++; console.error('  FAIL:', msg, `(得 ${JSON.stringify(a)}, 期望 ${JSON.stringify(b)})`); }
  else console.log('  ok:', msg);
}

// sampleSetCode (stable F6 合并显示)
eq(sampleSetCode(1, 0), 'N', 'Normal+0 → N');
eq(sampleSetCode(2, 0), 'S', 'Soft+0 → S');
eq(sampleSetCode(2, 1), 'S:C1', 'Soft+1 → S:C1');
eq(sampleSetCode(2, 2), 'S:C2', 'Soft+2 → S:C2');
eq(sampleSetCode(3, 0), 'D', 'Drum+0 → D');
eq(sampleSetCode(3, 5), 'D:C5', 'Drum+5 → D:C5');
eq(sampleSetCode(1, 3), 'N:C3', 'Normal+3 → N:C3');

// rangeTimes (Shift 范围选择)
const vis = [100, 200, 300, 400, 500];
eq(rangeTimes(vis, 200, 400), [200, 300, 400], '正向范围 200→400');
eq(rangeTimes(vis, 400, 200), [200, 300, 400], '反向范围 400→200');
eq(rangeTimes(vis, 300, 300), [300], '锚=目标 → 单行');
eq(rangeTimes(vis, 999, 200), null, '锚点不可见 → null');
eq(rangeTimes([], 100, 200), null, '空可见列表 → null');

// fmtTpPrec (13 位有效小数, 去浮点噪声)
eq(fmtTpPrec(180), '180', '整数原样');
eq(fmtTpPrec(0.1 + 0.2), '0.3', '浮点噪声去除');
eq(fmtTpPrec(1 / 3), '0.3333333333333', '1/3 → 13 位有效数字');
eq(fmtTpPrec(1.23456789012345), '1.234567890123', '13 位有效数字截断');
eq(fmtTpPrec(-100 / -125), '0.8', 'SV 0.8');

if (failures) { console.error(`V372_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V372_TESTS_ALL_PASSED');
