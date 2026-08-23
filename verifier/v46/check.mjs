// 验证器 v46: 皮肤目录 followpoint 读取修正 — 序列帧命名 (followpoint-0.png) + @2x 半尺寸 (ScaleAdjust)
// 运行: cd app && node verifier/v46/check.mjs; node verifier/v46/cdp-v46.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('skin.ts: followpoint 序列帧读取 (v47 起升级为专用通道, 见 v47)');
{
  const src = readSrc('src/osu/skin.ts');
  // v47: followpoint 改走专用通道 (单图优先 -> followpoint-{n} 序列帧), 不再经 fileVariants
  assert(/`followpoint-\$\{i\}@2x\.png`, `followpoint-\$\{i\}\.png`/.test(src),
    'followpoint-{n} 序列帧候选 (只有序列帧的皮肤也能读到)');
  assert(/export const skinScaleAdjust = new WeakMap<SkinImage, number>/.test(src), '导出 skinScaleAdjust (@2x 半尺寸系数)');
  assert(/endsWith\('@2x\.png'\)\) skinScaleAdjust\.set\(img, 2\)/.test(src), '@2x 候选加载成功时记录 ScaleAdjust=2');
}

section('renderer.ts: follow point 尺寸应用 ScaleAdjust 与 maxSize 约束');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/skinScaleAdjust\.get\(img\) \?\? 1/.test(src), '读取 ScaleAdjust (默认 1)');
  assert(/followPointCrop\(img\.width, img\.height, adj\)/.test(src), '@2x 贴图经 followPointCrop 按 ScaleAdjust 半尺寸 (v48 起)');
  assert(/FP_MAX_W|128, 64|WithMaximumSize/.test(src), 'lazer maxSize (128,64) 上限约束 (v48 起为居中裁剪, 见 followPointCrop)');
}

if (failures) { console.error(`\nVERIFIER_V46_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V46_ALL_TESTS_PASSED');
