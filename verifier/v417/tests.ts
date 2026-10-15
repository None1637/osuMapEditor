// v417 数值测试: 背景图 cover 适配矩形 (铺满 512×384, 居中)
import { coverRect } from '../../src/osu/gameplay/hud';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// 16:9 图 (1920×1080) → 按高度铺满, 水平溢出居中裁剪
{
  const r = coverRect(1920, 1080, 512, 384);
  const s = 384 / 1080;
  assert(Math.abs(r.h - 384) < 1e-9 && Math.abs(r.w - 1920 * s) < 1e-9, '16:9: 高度铺满');
  assert(Math.abs(r.y - 0) < 1e-9 && Math.abs(r.x - (512 - 1920 * s) / 2) < 1e-9, '16:9: 水平居中 (x<0 裁剪两侧)');
}
// 竖图 (800×1200) → 按宽度铺满, 垂直居中
{
  const r = coverRect(800, 1200, 512, 384);
  const s = 512 / 800;
  assert(Math.abs(r.w - 512) < 1e-9 && Math.abs(r.h - 1200 * s) < 1e-9, '竖图: 宽度铺满');
  assert(Math.abs(r.x - 0) < 1e-9 && Math.abs(r.y - (384 - 1200 * s) / 2) < 1e-9, '竖图: 垂直居中');
}
// 同比例图 → 恰好铺满无裁剪
{
  const r = coverRect(1024, 768, 512, 384);
  assert(r.x === 0 && r.y === 0 && r.w === 512 && r.h === 384, '同比例: 恰好铺满');
}
// 退化尺寸 → 回退整盒 (防 NaN)
{
  const r = coverRect(0, 0, 512, 384);
  assert(r.w === 512 && r.h === 384, '0 尺寸回退整盒');
}

if (failures) { console.error(`\nV417_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV417_TESTS_PASSED');
