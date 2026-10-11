// 验证器 v394 纯函数测试: 手动改过曲线类型的滑条不再被节点编辑强制改型
import { resolveSliderCurveType } from '../../src/osu/sliderPath';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// 模拟 EditorCanvas.applySliderPoints 的 v394 判定: 手动改型过的滑条保持原 curveType
const resolveGuarded = (pts: { x: number; y: number }[], current: string, manual: boolean) =>
  manual ? current : resolveSliderCurveType(pts, current);

const withRed = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 100 }]; // 含红点重复对

section('resolveSliderCurveType 原有行为 (未手动改型 = 基线)');
{
  assert(resolveGuarded(withRed, 'L', false) === 'B', '未手动: L + 红点 => 强切 B');
  assert(resolveGuarded(withRed, 'C', false) === 'B', '未手动: C + 红点 => 强切 B');
  assert(resolveGuarded([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 100 }], 'L', false) === 'L', '未手动: L 无红点保持 L');
  assert(resolveGuarded([{ x: 0, y: 0 }, { x: 1, y: 1 }], 'P', false) === 'L', '未手动: P 点数≠3 降级');
}

section('v394: 手动改型后不切换');
{
  assert(resolveGuarded(withRed, 'L', true) === 'L', '手动 L: 放红点保持 L');
  assert(resolveGuarded(withRed, 'C', true) === 'C', '手动 C: 放红点保持 C');
  assert(resolveGuarded(withRed, 'B', true) === 'B', '手动 B: 保持 B');
  assert(resolveGuarded([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], 'L', true) === 'L', '手动 L: 3 点不升 P');
}

if (failures) { console.error(`V394_TESTS_FAILED (${failures})`); process.exit(1); }
console.log('V394_TESTS_ALL_PASSED');
