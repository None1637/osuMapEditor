// 验证器 v12: 皮肤系统
//  - public/skin/ 关键贴图存在且为有效 PNG (osu!droid gfx 同款)
//  - skin.ts: 文件加载 + 程序化回退 + tintedSprite/withAlpha
//  - renderer.ts: hitcircle 着色 / overlay 原色 / 距离制 tick / reversearrow 朝右
//  - Timelines.tsx: 皮肤贴图渲染物件
import fs from 'fs';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function section(name) { console.log('== ' + name); }

const SKIN_FILES = [
  'hitcircle.png', 'hitcircleoverlay.png', 'approachcircle.png', 'reversearrow.png',
  'sliderstartcircle.png', 'sliderstartcircleoverlay.png', 'sliderendcircle.png', 'sliderendcircleoverlay.png',
  'sliderb0.png', 'sliderfollowcircle.png', 'sliderscorepoint.png',
  'spinner-circle.png', 'spinner-approachcircle.png', 'spinner-background.png',
  ...Array.from({ length: 10 }, (_, i) => `default-${i}.png`),
];

section('皮肤贴图文件 (public/skin/, 来源 osu!droid gfx)');
{
  assert(SKIN_FILES.length === 24, `共 ${SKIN_FILES.length} 个文件`);
  for (const f of SKIN_FILES) {
    const p = new URL(`../../public/skin/${f}`, import.meta.url);
    assert(fs.existsSync(p), `存在: ${f}`);
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      const isPng = buf.length > 100 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      assert(isPng, `${f} 有效 PNG (${buf.length}B)`);
    }
  }
}

section('skin.ts: 文件加载 + 回退 + 着色工具');
{
  const src = fs.readFileSync(new URL('../../src/osu/skin.ts', import.meta.url), 'utf8');
  assert(src.includes('SKIN_FILES') && src.includes('filesLoaded'), '文件皮肤加载机制');
  assert(src.includes('getSkin') && src.includes('singleton'), '共享单例 (EditorCanvas/Timelines 共用)');
  assert(src.includes('tintedSprite') && src.includes("'multiply'") && src.includes("'destination-in'"), 'tintedSprite 乘算着色');
  assert(src.includes('withAlpha'), 'withAlpha 透明度工具');
  assert(src.includes('sliderb0.png') && src.includes('spinner-circle.png'), '关键皮肤文件映射');
}

section('renderer.ts: osu! 着色规则与皮肤物件');
{
  const src = fs.readFileSync(new URL('../../src/osu/renderer.ts', import.meta.url), 'utf8');
  // hitcircle 着色 + overlay 原色 (不能反过来)
  assert(src.includes('tintedSprite(skin.hitcircle, bodyColor)'), 'hitcircle 乘算 combo 色 (v200: 经 bodyColor, 暂留命中后变白)');
  assert(!src.includes('tintedSprite(skin.hitcircleoverlay'), 'overlay 不着色');
  assert(src.includes('sliderstartcircle') && src.includes('sliderendcircle'), '滑条头尾专用贴图');
  assert(src.includes('sliderTickPoints') && src.includes('sliderscorepoint'), '距离制 tick 渲染');
  assert(src.includes('skin.sliderfollowcircle') && src.includes('skin.sliderb'), '滑条球与跟随圈');
  assert(src.includes('spinnerBackground') && src.includes('spinnerApproach'), '转盘三件套');
  // reversearrow 皮肤图朝右: 旋转量应直接为切线角 (不再有 +PI 修正)
  const arrow = src.match(/drawSprite\(g, skin\.reversearrow[^)]*\)/)?.[0] ?? '';
  assert(arrow.includes('ang)') && !arrow.includes('Math.PI'), `reversearrow 直接按切线角旋转: ${arrow}`);
}

section('Timelines.tsx: 时间轴物件渲染 (v28 起改为 stable 双行大圆布局)');
{
  const src = fs.readFileSync(new URL('../../src/components/Timelines.tsx', import.meta.url), 'utf8');
  assert(src.includes('computeCombos'), '时间轴 combo 序号 (computeCombos)');
  // v28: 对齐 stable (RAD=24 大圆 + roundRect 连体条 + 五色节拍 tick), 不再用皮肤贴图
  assert(src.includes('fillRect') && src.includes('RAD = 24'), 'stable 大圆 + 矩形连体条布局 (v33: 胶囊改矩形消接缝缺角)');
  assert(!src.includes('skin.reversearrow'), '折返不用贴图 (连体条上的白色小圆点)');
}

console.log(failures === 0 ? '\n全部断言通过' : `\n${failures} 条断言失败`);
if (failures > 0) process.exit(1);
