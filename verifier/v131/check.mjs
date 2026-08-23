// v131 源码接线断言: 皮肤修复 — followpoint 序列帧优先 (lazer GetTextures 语义) + 滑条球按贴图固有尺寸
// 针对皮肤 "- (RX) Fantastical Evening Star": followpoint.png 为 1x1 占位图, 真实内容在 followpoint-{n} 序列帧;
// sliderb.png 170px 含透明内边距 (球内容 128px), 压进 2r 盒子会小 25%
// 运行: node verifier/v131/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const skin = read('src/osu/skin.ts');
const rn = read('src/osu/renderer.ts');

// 1. followpoint: 序列帧优先 (lazer LegacySkinExtensions.GetTextures: 有 followpoint-0 即整组动画, 静态图忽略)
assert(/v131: 序列帧优先/.test(skin), 'v131 序列帧优先注释 (lazer GetTextures 语义)');
const framesIdx = skin.indexOf('const frames: SkinImage[] = [];');
const singleIdx = skin.indexOf("for (const name of ['followpoint@2x.png', 'followpoint.png'])");
assert(framesIdx > 0 && singleIdx > framesIdx, '帧加载在静态单图之前 (帧优先, 单图回退)');
assert(/无序列帧才回退单图/.test(skin), '单图仅作无帧回退');
assert(/skin\.followpointFrameMs = iniRate > 0 \? 1000 \/ iniRate : 1000 \/ frames\.length/.test(skin), '默认帧时长 1000/帧数 (v143 修正: lazer getFrameLength applyConfigFrameRate 无 ini 时整组 1 秒/轮, 非 SIXTY_FRAME_TIME)');

// 2. sliderb 固有宽度登记 (v150: 登记条件从 key === 'sliderb' 扩为 INTRINSIC_SIZE_KEYS 集合, 含 hitcircle 族)
assert(/export const skinSpriteWidth = new WeakMap<SkinImage, number>\(\)/.test(skin), 'skinSpriteWidth WeakMap 导出');
assert(/if \(INTRINSIC_SIZE_KEYS\.has\(key\)\) skinSpriteWidth\.set\(img, img\.width \/ \(name\.toLowerCase\(\)\.endsWith\('@2x\.png'\) \? 2 : 1\)\)/.test(skin), '皮肤目录固有尺寸精灵登记固有宽度 (@2x 半尺寸; v150 扩为集合, 含 sliderb)');
assert(/'sliderb'/.test(skin.slice(skin.indexOf('INTRINSIC_SIZE_KEYS = new Set'), skin.indexOf('])', skin.indexOf('INTRINSIC_SIZE_KEYS = new Set')))), 'INTRINSIC_SIZE_KEYS 集合仍含 sliderb');
assert(/skinSpriteWidth\.set\(sliderb, 128\)/.test(skin), '程序化回退 sliderb 登记 128 (= 2r 盒子)');

// 3. renderer: 滑条球按固有尺寸绘制 (v175 适配: 宽/高分开取固有值, 宽高比保持 + 沿路径切线旋转; 上限语义从宽度 cap 改为高度 cap 等比缩小)
assert(/skinSpriteWidth/.test(rn), 'renderer 引入 skinSpriteWidth');
assert(/const natW = \(skinSpriteWidth\.get\(skin\.sliderb\) \?\? 128\);/.test(rn), '球宽仍取固有宽度 (未登记回退 128)');
assert(/const natH = skinSpriteWidth\.has\(skin\.sliderb\) \? skin\.sliderb\.height \/ adjB : 128;/.test(rn), '球高 = 贴图实际高 / ScaleAdjust (v175)');
assert(/const bk = natH > 384 \? 384 \/ natH : 1;/.test(rn), '高 >384 时等比缩小 (lazer MAX_FOLLOW_CIRCLE_AREA_SIZE = OBJECT_DIMENSIONS*3; lazer 为居中裁剪, 从简)');
assert(/drawSpriteRect\(g, skin\.sliderb, bp\.x, bp\.y, natW \* bk \* csK, natH \* bk \* csK, ballAng\)/.test(rn), '球按固有宽高比绘制并旋转 (v175; v176 补 csK 因子)');
assert(!/drawSprite\(g, skin\.sliderb, bp\.x, bp\.y, size\)/.test(rn), '旧的压盒子绘制已移除');

console.log(failures ? '\nV131_CHECK_FAILED: ' + failures : '\nV131_CHECK_PASSED');
process.exit(failures ? 1 : 0);
