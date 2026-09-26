// v105 源码接线断言: 波形窗右侧竖标题条 + 右上角模式按钮 + 半透明背景
// 运行: node verifier/v105/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

// v127 适配: WaveformPanel 废弃 (右侧竖标题条/浮层按钮随面板删除), 半透明绘制层移到 waveformDraw.ts
const wp = read('src/osu/waveformDraw.ts');


// 半透明背景
assert(/WAVE_BG = 'rgba\(20,20,20,0\.55\)'/.test(wp), '波形背景半透明 rgba(20,20,20,0.55)');
assert(/const spectroBgAlpha = \(\) => 40/.test(wp), '频谱底 alpha 40 (v284 适配: 开关移除, 固定; 原 SPECTRO_BG_ALPHA=140 分支删除)');
assert(/bgA \+ t \* \(255 - bgA\)/.test(wp), '频谱像素 alpha 随强度 bgA→255 (v271 适配: 底 alpha 随半透明开关 140/70)');
assert(/g\.clearRect\(0, 0, W, H\); \/\/ v105: 半透明底/.test(wp), '波形每帧先清屏防累积');
assert(/g\.clearRect\(0, 0, W, H\); \/\/ v105: 半透明 —/.test(wp), '频谱主画布每帧先清屏防累积');
assert(/globalCompositeOperation = 'copy'/.test(wp), '滚动平移用 copy 合成 (防半透明二次叠加)');
assert(/globalCompositeOperation = 'source-over'/.test(wp), '平移后恢复 source-over');

console.log(failures ? `\nV105_CHECK_FAILED: ${failures}` : '\nV105_CHECK_PASSED');
process.exit(failures ? 1 : 0);
