// 验证器 v100 纯函数测试: resolveSliderCircleFallback (滑条头尾贴图回退, lazer LegacyMainCirclePiece 语义)
import { resolveSliderCircleFallback } from '../../src/osu/skin';
import type { Skin, SkinImage } from '../../src/osu/skin';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// node 环境无 canvas: 用可辨识的桩贴图
const stub = (tag: number): SkinImage => ({ width: tag, height: tag }) as unknown as SkinImage;
const EMPTY = stub(1);
const HC = stub(101), OV = stub(102), SS = stub(201), SSO = stub(202), SE = stub(203), SEO = stub(204), PROC = stub(255);

function fakeSkin(): Skin {
  return {
    hitcircle: HC, hitcircleoverlay: OV,
    approachcircle: PROC, reversearrow: PROC,
    sliderstartcircle: PROC, sliderstartcircleoverlay: PROC,
    sliderendcircle: PROC, sliderendcircleoverlay: PROC,
    sliderb: PROC, sliderfollowcircle: PROC, sliderscorepoint: PROC,
    followpoint: PROC, followpointFrames: [], followpointFrameMs: 1000,
    spinnerCircle: PROC, spinnerApproach: PROC, spinnerBackground: PROC,
    default0: [], filesLoaded: false,
  };
}

section('皮肤只有 hitcircle/overlay (用户场景: note 全透明) -> 滑条头尾整组回退');
{
  const s = fakeSkin();
  resolveSliderCircleFallback(s, k => k === 'hitcircle' || k === 'hitcircleoverlay', EMPTY);
  assert(s.sliderstartcircle === HC, 'sliderstartcircle -> hitcircle (不再是程序化实心盘)');
  assert(s.sliderstartcircleoverlay === OV, 'sliderstartcircleoverlay -> hitcircleoverlay');
  assert(s.sliderendcircle === HC, 'sliderendcircle -> hitcircle');
  assert(s.sliderendcircleoverlay === OV, 'sliderendcircleoverlay -> hitcircleoverlay');
}

section('前缀 circle 存在但 overlay 缺失 -> overlay 为空 (不回退 hitcircleoverlay)');
{
  const s = fakeSkin();
  s.sliderstartcircle = SS;
  resolveSliderCircleFallback(s, k => k === 'hitcircle' || k === 'hitcircleoverlay' || k === 'sliderstartcircle', EMPTY);
  assert(s.sliderstartcircle === SS, 'sliderstartcircle 保留皮肤贴图');
  assert(s.sliderstartcircleoverlay === EMPTY, 'sliderstartcircleoverlay = 空 (lazer: 不显示 overlay)');
  assert(s.sliderendcircle === HC, 'sliderendcircle 缺失 -> 回退 hitcircle');
}

section('前缀 circle + overlay 都有 -> 全部保留皮肤贴图 (默认皮肤路径, 行为不变)');
{
  const s = fakeSkin();
  s.sliderstartcircle = SS; s.sliderstartcircleoverlay = SSO;
  s.sliderendcircle = SE; s.sliderendcircleoverlay = SEO;
  resolveSliderCircleFallback(s, () => true, EMPTY);
  assert(s.sliderstartcircle === SS && s.sliderstartcircleoverlay === SSO, 'start 组保留');
  assert(s.sliderendcircle === SE && s.sliderendcircleoverlay === SEO, 'end 组保留');
}

if (failures) { console.error(`\nTESTS_V100_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_V100_ALL_PASSED');
