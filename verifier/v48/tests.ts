// 验证器 v48 纯函数测试: followpoint maxSize (128,64) 上限 = lazer WithMaximumSize 居中裁剪 (非等比缩放)
import { followPointCrop, FP_MAX_W, FP_MAX_H } from '../../src/osu/followPoints';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

section('常量对齐 lazer OsuLegacySkinTransformer: maxSize = (OBJECT_RADIUS*2, OBJECT_RADIUS)');
{
  assert(FP_MAX_W === 128 && FP_MAX_H === 64, 'FP_MAX_W=128, FP_MAX_H=64');
}

section('followPointCrop: WithMaximumSize 语义 (逐轴独立 min + 居中 Crop, ScaleAdjust 换算)');
{
  // 用户皮肤帧: 128x128 @1x -> 高度超限, 居中裁出 128x64 横带, 显示 128x64 (不缩宽度!)
  const a = followPointCrop(128, 128, 1);
  assert(a.sw === 128 && a.sh === 64 && a.sx === 0 && a.sy === 32, '128x128 -> 裁剪 (0,32,128,64)');
  assert(a.dw === 128 && a.dh === 64, '128x128 -> 显示 128x64 osu px (v47 错误等比缩放为 64x64)');
  // @2x 256x256: ScaleAdjust=2 -> 显示 128x128 仍超高, 裁 256x128, 显示 128x64
  const b = followPointCrop(256, 256, 2);
  assert(b.sw === 256 && b.sh === 128 && b.sx === 0 && b.sy === 64, '@2x 256x256 -> 裁剪 (0,64,256,128)');
  assert(b.dw === 128 && b.dh === 64, '@2x 256x256 -> 显示 128x64');
  // 未超限: 原样 (不裁剪不放大)
  const c = followPointCrop(64, 32, 1);
  assert(c.sw === 64 && c.sh === 32 && c.sx === 0 && c.sy === 0 && c.dw === 64 && c.dh === 32, '64x32 未超限原样');
  const c2 = followPointCrop(128, 64, 1);
  assert(c2.sw === 128 && c2.sh === 64 && c2.dw === 128 && c2.dh === 64, '恰好 128x64 边界原样');
  // 只超宽: 逐轴独立, 高度不动 (WithMaximumSize 注释: 避免 weird aspect 被放大)
  const d = followPointCrop(512, 32, 1);
  assert(d.sw === 128 && d.sh === 32 && d.sx === 192 && d.sy === 0, '512x32 -> 裁宽 (192,0,128,32)');
  assert(d.dw === 128 && d.dh === 32, '512x32 -> 显示 128x32 (高度保持 32, 非等比)');
  // 两轴都超: 各取 min
  const e = followPointCrop(200, 100, 1);
  assert(e.sw === 128 && e.sh === 64 && e.sx === 36 && e.sy === 18 && e.dw === 128 && e.dh === 64, '200x100 -> 裁剪 (36,18,128,64)');
  // @2x 未超限: 显示尺寸 = 像素/2
  const f = followPointCrop(64, 64, 2);
  assert(f.sw === 64 && f.sh === 64 && f.dw === 32 && f.dh === 32, '@2x 64x64 -> 显示 32x32 不裁');
}

if (failures) { console.error(`\nTESTS_V48_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V48_ALL_PASSED');
