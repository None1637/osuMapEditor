// v175 源码接线断言: 滑条球 (sliderb) 保持贴图固有宽高比 + 沿路径切线旋转
// 针对皮肤 "kongehund mapping 2.0": sliderb@2x.png 为 1500x236 宽幅技巧贴图 (品红圆环 + 贯穿横线,
// 模拟 stable 球随路径旋转时的轨迹线效果); 旧代码压进方形盒子 → 球环被拉成竖椭圆
// lazer 出处: LegacySliderBall.cs — AutoSize = 贴图逻辑尺寸 (px / ScaleAdjust), 父级带 Rotation
//             (注释 "undo rotation on layers which should not be rotated" 证明球随方向旋转),
//             上限 MAX_FOLLOW_CIRCLE_AREA_SIZE = OBJECT_DIMENSIONS*3 = 384 (lazer 居中裁剪, 此处从简为等比缩小)
// 运行: node verifier/v175/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const rn = read('src/osu/renderer.ts');

// 1. drawSpriteRect 辅助函数 (带旋转的矩形绘制)
assert(/function drawSpriteRect\(g: CanvasRenderingContext2D, img: SkinImage, x: number, y: number, w: number, h: number, rot/.test(rn), 'drawSpriteRect 辅助函数存在 (支持旋转)');
assert(/g\.rotate\(rot\);/.test(rn), 'drawSpriteRect 内部执行旋转');
assert(/g\.drawImage\(img, -w \/ 2, -h \/ 2, w, h\);/.test(rn), 'drawSpriteRect 以中心绘制 w x h 矩形');

// 2. 滑条球: 固有宽高比 (宽取 skinSpriteWidth 登记值, 高取贴图实际高度 / ScaleAdjust)
assert(/const adjB = skinScaleAdjust\.get\(skin\.sliderb\) \?\? 1;/.test(rn), 'sliderb 取 ScaleAdjust (@2x = 2)');
assert(/const natW = \(skinSpriteWidth\.get\(skin\.sliderb\) \?\? 128\);/.test(rn), '球宽 = 登记固有宽度 (回退 128)');
assert(/const natH = skinSpriteWidth\.has\(skin\.sliderb\) \? skin\.sliderb\.height \/ adjB : 128;/.test(rn), '球高 = 贴图实际高 / ScaleAdjust (未登记回退 128)');
assert(/const bk = natH > 384 \? 384 \/ natH : 1;/.test(rn), '高 >384 上限等比缩小 (lazer MAX_FOLLOW_CIRCLE_AREA_SIZE)');

// 3. 沿路径切线旋转 (球位置前后各 1.5px 取方向)
assert(/const t0 = path\.positionAt\(Math\.max\(0, alongC - 1\.5\)\);/.test(rn), '切线采样点 t0 (球前 1.5px, 下限 0)');
assert(/const t1 = path\.positionAt\(Math\.min\(slideLen, alongC \+ 1\.5\)\);/.test(rn), '切线采样点 t1 (球后 1.5px, 上限 slideLen)');
assert(/const ballAng = Math\.atan2\(t1\.y - t0\.y, t1\.x - t0\.x\);/.test(rn), '球旋转角 = 路径切线方向');
assert(/drawSpriteRect\(g, skin\.sliderb, bp\.x, bp\.y, natW \* bk \* csK, natH \* bk \* csK, ballAng\)/.test(rn), '滑条球按固有宽高比 + 切线旋转绘制 (v176 起乘 csK = size/128 CS 缩放因子)');

// 4. 旧的方形压盒子绘制已移除
assert(!/drawSprite\(g, skin\.sliderb, bp\.x, bp\.y, size\)/.test(rn), '旧的压盒子 drawSprite(skin.sliderb, ...size) 已移除');

console.log(failures ? '\nV175_CHECK_FAILED: ' + failures : '\nV175_CHECK_PASSED');
process.exit(failures ? 1 : 0);
