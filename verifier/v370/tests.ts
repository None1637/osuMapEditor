// 验证器 v370 纯函数测试: dragToScale 的 Shift 锁比只对 4 个斜角生效 (lazer:
// shouldLockAspectRatio = isCornerAnchor(anchor) && ShiftPressed;
// isCornerAnchor = !anchor.HasFlag(x1) && !anchor.HasFlag(y1) — 两轴都不居中才是真角)。
// 修复前: isCorner 只查第二字符, cl/cr (左右边中点) 被误判为角 → Shift+拉左右边时
// sy 已清零仍被锁比 ((sx+1)/2 同赋两轴) → X 倍率减半 (手柄脱离游标) + Y 凭空缩放。
import { dragToScale, anchorAxis, type ScaleAnchor } from '@/osu/selectionBox';

let failures = 0;
function eq(a: number, b: number, msg: string) {
  if (Math.abs(a - b) > 1e-9) { failures++; console.error('  FAIL:', msg, `(得 ${a}, 期望 ${b})`); }
  else console.log('  ok:', msg);
}

const ANCHORS: ScaleAnchor[] = ['tl', 'tc', 'tr', 'cl', 'cr', 'bl', 'bc', 'br'];
const W = 100, H = 200;

// 无 Shift: 8 手柄全量行为基线 (边 = 单轴, 角 = 双轴, 上/左方向取反)
{
  const dx = 20, dy = 60;
  // tl: 左上 → 两轴取反: sx=1-0.2=0.8, sy=1-0.3=0.7
  let s = dragToScale('tl', W, H, dx, dy, false);
  eq(s.x, 0.8, 'tl 无 Shift sx'); eq(s.y, 0.7, 'tl 无 Shift sy');
  // tc: X 清零, Y 取反
  s = dragToScale('tc', W, H, dx, dy, false);
  eq(s.x, 1, 'tc 无 Shift sx=1 (X 轴清零)'); eq(s.y, 0.7, 'tc 无 Shift sy');
  // cl: Y 清零, X 取反
  s = dragToScale('cl', W, H, dx, dy, false);
  eq(s.x, 0.8, 'cl 无 Shift sx'); eq(s.y, 1, 'cl 无 Shift sy=1 (Y 轴清零)');
  // br: 不取反
  s = dragToScale('br', W, H, dx, dy, false);
  eq(s.x, 1.2, 'br 无 Shift sx'); eq(s.y, 1.3, 'br 无 Shift sy');
}

// Shift: 只有 4 个斜角锁比 (取均值), 4 个边中点完全不变
{
  const dx = 20, dy = 60;
  for (const a of ANCHORS) {
    const noShift = dragToScale(a, W, H, dx, dy, false);
    const withShift = dragToScale(a, W, H, dx, dy, true);
    const corner = a === 'tl' || a === 'tr' || a === 'bl' || a === 'br';
    if (corner) {
      const m = (noShift.x + noShift.y) / 2;
      eq(withShift.x, m, `${a} Shift 锁比 sx=均值`);
      eq(withShift.y, m, `${a} Shift 锁比 sy=均值`);
    } else {
      eq(withShift.x, noShift.x, `${a} Shift 无效 sx 不变`);
      eq(withShift.y, noShift.y, `${a} Shift 无效 sy 不变`);
    }
  }
}

// 回归: 边手柄轴向划分不变 (上下→Y, 左右→X, 角→Both)
{
  eq(anchorAxis('tc') === 'y' ? 1 : 0, 1, 'anchorAxis tc=y');
  eq(anchorAxis('bc') === 'y' ? 1 : 0, 1, 'anchorAxis bc=y');
  eq(anchorAxis('cl') === 'x' ? 1 : 0, 1, 'anchorAxis cl=x');
  eq(anchorAxis('cr') === 'x' ? 1 : 0, 1, 'anchorAxis cr=x');
  eq(anchorAxis('tl') === 'both' ? 1 : 0, 1, 'anchorAxis tl=both');
}

if (failures) { console.error(`V370_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V370_TESTS_ALL_PASSED');
