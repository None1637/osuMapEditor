// 验证器 v54 纯函数测试: 旋转手柄基准尺寸 (lazer SelectionBoxRotationHandle.Size=15, hover ScaleTo(1.5))
import { ROT_HANDLE_SIZE, ROT_HANDLE_OUT, rotationHandlePoints } from '../../src/osu/selectionBox';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

section('旋转手柄常量 (lazer)');
assert(ROT_HANDLE_SIZE === 15, `基准 Size=15 (实际 ${ROT_HANDLE_SIZE})`);
assert(ROT_HANDLE_OUT === 12.5, `角外偏移 12.5 (实际 ${ROT_HANDLE_OUT})`);

section('rotationHandlePoints: 四角外扩 12.5px/轴');
{
  const pts = rotationHandlePoints({ x: 100, y: 50, w: 200, h: 100 });
  const br = pts.find(p => p.corner === 'br')!;
  assert(br.x === 312.5 && br.y === 162.5, `br = (312.5,162.5) (实际 ${br.x},${br.y})`);
}

if (failures) { console.error(`\nTESTS_V54_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V54_ALL_PASSED');
