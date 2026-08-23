// 验证器 v174: 圈内数字补 stable/lazer 的 0.8x 统一缩放
// (OsuLegacySkinTransformer.HitCircleText: hitcircle_text_scale = 0.8f + MaxSizePerGlyph = 320)
// 效果: "数字即圈"皮肤 (default-N = 160x160) 160×0.8 = 128 正好一圈大小; 经典 52px 数字 = box*52*0.8/128
// 运行: node verifier/v174/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: hitcircle_text_scale = 0.8');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/const TEXT_SCALE = 0\.8;/.test(src), 'TEXT_SCALE = 0.8 (lazer hitcircle_text_scale)');
  assert(/box \* \(gl\.height \/ \(skinScaleAdjust\.get\(gl\) \?\? 1\)\) \/ 128 \* TEXT_SCALE/.test(src),
    '字形高 = 固有逻辑高/128 × 0.8');
  assert(/skin\.hitCircleOverlap \* box \/ 128 \* TEXT_SCALE/.test(src), 'overlap 同样乘 0.8 换算');
  // 数值核对: 160px 整圈贴图 × 0.8 = 128 = 正好盒子; 经典 52px → 41.6/128
  assert(160 * 0.8 === 128, '160×0.8=128 (数字即圈皮肤正好一圈)');
}

console.log(failures ? `\nV174 FAILED: ${failures}` : '\nV174 ALL PASSED');
process.exit(failures ? 1 : 0);
