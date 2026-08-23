// v176 源码接线断言: 滑条球补回 CS 缩放因子 (size/128) — 修复 v175 后几乎所有皮肤球偏大的回归
// v175 改为按固有宽高比绘制时丢掉了 v131 的 size*(sbW/128) 中的 size/128 因子,
// 导致低 CS (大物件... 反之高 CS 小物件) 谱面上球不随物件缩放, 视觉上比滑条头/物件大一圈。
// lazer 出处: DrawableSliderBall.cs — ball (SkinnableDrawable) 无 RelativeSizeAxes, 保持贴图固有逻辑尺寸,
//             但整个 DrawableSliderBall 位于 DrawableSlider/DrawableHitObject 内, 随 HitObject.Scale (= CS 缩放) 缩放。
// 运行: node verifier/v176/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const rn = read('src/osu/renderer.ts');

// 1. CS 缩放因子存在且参与滑条球绘制
assert(/const csK = size \/ 128;/.test(rn), 'csK = size/128 CS 缩放因子 (v176)');
assert(/drawSpriteRect\(g, skin\.sliderb, bp\.x, bp\.y, natW \* bk \* csK, natH \* bk \* csK, ballAng\)/.test(rn), '滑条球宽/高均乘 csK (v176)');
assert(!/drawSpriteRect\(g, skin\.sliderb, bp\.x, bp\.y, natW \* bk, natH \* bk, ballAng\)/.test(rn), 'v175 无 csK 的旧调用已移除');

// 2. v175 的宽高比/旋转语义保持 (本修复不改变)
assert(/const natW = \(skinSpriteWidth\.get\(skin\.sliderb\) \?\? 128\);/.test(rn), '固有宽度语义保持 (v175)');
assert(/const ballAng = Math\.atan2\(t1\.y - t0\.y, t1\.x - t0\.x\);/.test(rn), '切线旋转保持 (v175)');
assert(/const bk = natH > 384 \? 384 \/ natH : 1;/.test(rn), '384 上限保持 (v175)');

console.log(failures ? '\nV176_CHECK_FAILED: ' + failures : '\nV176_CHECK_PASSED');
process.exit(failures ? 1 : 0);
