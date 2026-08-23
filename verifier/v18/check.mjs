// 验证器 v18: 物件尺寸对齐 lazer + 上方时间轴 lazer 布局 + 选中滑条控制点连接线
// 依据 (ppy/osu master):
//  - OsuHitObject.OBJECT_RADIUS=64, Radius=64*Scale, Scale=(1-0.7*(CS-5)/5)/2 -> 直径 = 2*(54.4-4.48*CS)
//  - LegacyMainCirclePiece: hitcircle/overlay 贴图盒子 = OBJECT_DIMENSIONS (=2r), 不做补偿放大; 数字 52px/128 盒子
//  - DrawableSliderBall: 球 = OBJECT_DIMENSIONS, 跟随圈 = FOLLOW_AREA(2.4) x; LegacyReverseArrow: 盒子 = 2r
//  - TimelineHitObjectBlueprint: circle_size=32 圆角条, 时长物件水平渐变 Lighten(0.4), repeat tick = circle_size/4, 选中黄框
//  - PathControlPointConnection: PathRadius=1 (2px) 白线依次连接全部控制点
// 运行: cd app && node verifier/v18/check.mjs; node verifier/v18/cdp-visual.mjs (需 7100 dev server)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: 物件尺寸 = lazer 2r 贴图盒子 (无补偿放大)');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(!src.includes('1.12'), '不再使用 1.12 补偿放大');
  assert(src.includes('const size = r * 2;'), 'hitcircle/滑条头盒子 = 2r');
  // v173 适配: 数字改传 128 盒子 (r*2), 高度 = 贴图逻辑高/128 — 经典 52px 贴图结果不变
  assert(src.includes('drawNumber(g, skin, num, x, y, r * 2)'), '数字按贴图固有逻辑尺寸 (v173; 经典皮肤 52px/128 盒子不变)');
  assert(/box \* \(gl\.height \/ \(skinScaleAdjust\.get\(gl\) \?\? 1\)\) \/ 128/.test(src), '数字高 = 贴图逻辑高 / 128 盒子 (v173)');
  assert(src.includes('33 / 35'), '字距 = 字宽 + HitCircleOverlap(-2)');
  assert(src.includes('size * 2.4'), '跟随圈 = FOLLOW_AREA(2.4) x');
  assert(src.includes('1 + hitFade * 0.4'), '命中放大 1.4x (lazer legacy_fade)');
  const arrow = src.match(/drawSprite\(g, skin\.reversearrow[^)]*\)/)?.[0] ?? '';
  assert(arrow.includes('size') && arrow.includes('ang'), `折返箭头盒子 = 2r 且按切线角旋转: ${arrow}`);
}

section('renderer.ts: 选中滑条控制点连接线 (lazer PathControlPointConnection)');
{
  const src = readSrc('src/osu/renderer.ts');
  const blk = src.match(/PathControlPointConnection[\s\S]*?g\.stroke\(\);/)?.[0] ?? '';
  assert(blk.length > 0, '存在控制点连接线绘制块');
  assert(blk.includes("g.strokeStyle = '#ffffff'") && blk.includes('g.lineWidth = 2'), '2px 白线 (PathRadius=1)');
  assert(blk.includes('moveTo') && blk.includes('lineTo'), '依次连接全部控制点');
  assert(src.indexOf('PathControlPointConnection') < src.indexOf('可拖拽的控制点手柄'), '连接线画在手柄点之前 (衬底)');
}

section('EditorCanvas.tsx: 幽灵预览同步 2r');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(!src.includes('1.12'), '幽灵预览不再使用 1.12');
}

section('Timelines.tsx: 上方时间轴 (v28 起改为 stable 双行大圆布局, 取代 lazer TimelineHitObjectBlueprint)');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(src.includes('RAD = 24'), '物件圆半径 = stable 大圆 24px');
  assert(src.includes('fillRect'), '滑条/转盘连体条 (v33 起矩形, 胶囊圆角在尾圆接缝缺角)');
  assert(src.includes("'#ffcc22'"), '选中 = 黄色环 (沿用 lazer OsuColour.Yellow)');
  assert(src.includes('comboColor') && src.includes("'#ffffff'"), 'combo 染色填充 + 白色 combo 数字 (v31 起; 回归: 透明底黑字不可见)');
  assert(src.includes('beatTicks') && src.includes('TICK_COLORS'), '节拍 tick 五色分级 (beatTicks.ts)');
  assert(src.includes('h-[92px]'), '双行布局 (物件行 60 + tick 行 32)');
}

if (failures) { console.error(`\nVERIFIER_V18_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V18_ALL_TESTS_PASSED');
