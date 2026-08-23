// 验证器 v100: 滑条头尾贴图回退对齐 lazer LegacyMainCirclePiece
// 用户报告: 皮肤把 hitcircle 做成全透明 (note 合并到数字显示), 但滑条头是实心染色圆 —
//   根因: sliderstartcircle 缺失时回退到程序化实心白盘 (着色后 = 实心染色圆), 应整组回退 hitcircle
// lazer 语义 (LegacyMainCirclePiece.load :64-103):
//   - sliderstart/endcircle 缺失 => 整组回退 hitcircle + hitcircleoverlay
//   - 前缀 circle 存在但 overlay 缺失 => 无 overlay (不回退 hitcircleoverlay)
// 运行: cd app && npx esbuild verifier/v100/tests.ts --bundle --platform=node --outfile=/tmp/v100.cjs && node /tmp/v100.cjs
//       node verifier/v100/check.mjs; node verifier/v100/cdp-v100.mjs (需 7100 dev server)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('skin.ts: resolveSliderCircleFallback (lazer 语义)');
{
  const src = readSrc('src/osu/skin.ts');
  assert(src.includes('export function resolveSliderCircleFallback'), '回退函数导出 (纯函数测试入口)');
  assert(src.includes('skin[circle] = skin.hitcircle'), 'circle 缺失 -> 回退 hitcircle');
  assert(src.includes('skin[overlay] = skin.hitcircleoverlay'), 'overlay 缺失 -> 回退 hitcircleoverlay');
  assert(src.includes('skin[overlay] = empty ?? emptyImage()'), '前缀 circle 存在但 overlay 缺失 -> 空 overlay');
  assert(src.includes('emptyImage'), '1x1 全透明占位图');
}

section('skin.ts: 两处加载完成后调用回退解析');
{
  const src = readSrc('src/osu/skin.ts');
  const calls = src.match(/resolveSliderCircleFallback\(skin, k => loadedKeys\.has\(k\)\)/g) ?? [];
  assert(calls.length === 2, `applySkinFromDir 与 loadDefaultFilesInto 各调一次 (实际 ${calls.length})`);
  assert(src.includes('const loadedKeys = new Set<keyof Skin>()'), '跟踪实际提供的贴图');
  assert(src.indexOf('Promise.all(jobs)') < src.lastIndexOf('resolveSliderCircleFallback'), '皮肤目录加载完成后才解析 (hitcircle 已就位)');
}

if (failures) { console.error(`\nVERIFIER_V100_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V100_ALL_TESTS_PASSED');
