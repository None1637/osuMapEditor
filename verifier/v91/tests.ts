// 验证器 v91 纯函数测试: geoDragCorrection — 拖物件吸附辅助线/点 (与物件修正取更近者)
import { geoDragCorrection } from '@/osu/geometryHelpers';
import type { Pt } from '@/osu/objectSnap';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// 辅助线 y=300 上 x=250 处的吸附点 (距 6.4 内命中)
const snap = (p: Pt) => Math.abs(p.x - 250) <= 6.4 && Math.abs(p.y - 300) <= 6.4 ? { x: 250, y: 300 } : null;

{
  // 单拖拽点 (100,100) + 位移 (150,195) => (250,295), 命中 => 修正位移 (150,200)
  const r = geoDragCorrection([{ x: 100, y: 100 }], 150, 195, snap, null);
  assert(r !== null && r.dx === 150 && r.dy === 200, `命中 => 修正 (150,200) (实际 ${JSON.stringify(r)})`);
}
{
  // 物件修正更近 (2 < 5) => 不覆盖
  const r = geoDragCorrection([{ x: 100, y: 100 }], 150, 195, snap, 2);
  assert(r === null, '物件修正更近 => 不覆盖');
}
{
  // 物件修正更远 (8 > 5) => 覆盖
  const r = geoDragCorrection([{ x: 100, y: 100 }], 150, 195, snap, 8);
  assert(r !== null && r.dy === 200, '辅助修正更近 => 覆盖');
}
{
  // 多拖拽点取最近命中: (100,100)+(150,195)=(250,295) dist 5; (150,150)+(100,145)=(250,295) 同点
  const r = geoDragCorrection([{ x: 100, y: 100 }, { x: 200, y: 100 }], 150, 195, snap, null);
  // 第二点 (200,100)+(150,195) = (350,295) 不命中; 第一点命中 => dx=150(不变), dy=200
  assert(r !== null && r.dx === 150 && r.dy === 200, '多拖拽点取命中者');
}
{
  // 无命中 => null
  const r = geoDragCorrection([{ x: 100, y: 100 }], 10, 10, snap, null);
  assert(r === null, '无命中 => null');
}
{
  // 取整: 命中点带小数 => 修正位移取整
  const snap2 = () => ({ x: 250.4, y: 299.6 });
  const r = geoDragCorrection([{ x: 100, y: 100 }], 150, 195, snap2, null);
  assert(r !== null && r.dx === 150 && r.dy === 200, `取整 (实际 ${JSON.stringify(r)})`);
}

if (failures) { console.error(`\nTESTS_V91_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V91_ALL_PASSED');
