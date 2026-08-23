// 验证器 v150 纯函数测试: hitcircleSpriteWidth — hitcircle 族精灵按贴图固有尺寸显示
// (lazer LegacyMainCirclePiece: AutoSize + WithMaximumSize(OBJECT_DIMENSIONS*2=256))
import { hitcircleSpriteWidth, skinSpriteWidth } from '../../src/osu/skin';
import type { SkinImage } from '../../src/osu/skin';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

// WeakMap key 只需对象语义; helper 不读 .width (宽度在登记时换算好)
const fakeImg = () => ({}) as unknown as SkinImage;
const registered = (w128box: number): SkinImage => { const i = fakeImg(); skinSpriteWidth.set(i, w128box); return i; };

section('hitcircleSpriteWidth: 固有宽度 (128-box 单位), 上限 256');
{
  // 未登记 (默认皮肤 / 程序化回退) → 128 = 撑满 2r 盒子 (旧行为不变)
  assert(hitcircleSpriteWidth(fakeImg()) === 128, '未登记回退 128 (2r 盒子)');

  // altruism v1 实际贴图: hitcircle.png 150px 1x → 显示 150/128 倍盒子 (旧逻辑压回 128 显得偏小)
  assert(hitcircleSpriteWidth(registered(150)) === 150, '150px 1x → 150 (150/128 倍盒子)');

  // hitcircle@2x.png 300px → 登记处 ÷ ScaleAdjust(2) = 150 → 透传
  assert(hitcircleSpriteWidth(registered(300 / 2)) === 150, '300px@2x → 150 (ScaleAdjust=2)');

  // hitcircleoverlay.png 120px 1x → 120 (比盒子略小, 与 stable 一致)
  assert(hitcircleSpriteWidth(registered(120)) === 120, '120px overlay → 120');

  // 标准 128px → 128 (无视觉变化)
  assert(hitcircleSpriteWidth(registered(128)) === 128, '128px 标准 → 128');

  // 超大贴图封顶 256 (lazer WithMaximumSize(OBJECT_DIMENSIONS*2))
  assert(hitcircleSpriteWidth(registered(300)) === 256, '300px 1x → 封顶 256');
  assert(hitcircleSpriteWidth(registered(512 / 2)) === 256, '512px@2x (固有 256) → 256 不封顶边界');
}

section('渲染尺寸换算: drawSize = 2r * width/128');
{
  // CS4 → r ≈ 54.4 (csToRadius), 盒子 size = 2r; 150px 贴图应为盒子的 1.171875 倍
  const r = 54.4, size = r * 2;
  const w = hitcircleSpriteWidth(registered(150));
  const draw = size * w / 128;
  assert(Math.abs(draw - size * 1.171875) < 1e-9, `150px → 绘制尺寸 = 盒子*1.171875 (实际 ${draw})`);
}

if (failures) { console.error(`V150_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V150_TESTS_PASSED');
