// 验证器 v160: 滑条长度始终 ≤ 末控制点位置 (几何全长)
//   lazer 依据 (ppy/osu 源码):
//   - SliderPlacementBlueprint.cs:433 updateSlider — ExpectedDistance = FindSnappedDistance(Path.CalculatedDistance, ...)
//   - SliderPathExtensions.cs SnapTo — 节点编辑后同款 (源自 CalculatedDistance)
//   - ComposerDistanceSnapProvider.cs:298 FindSnappedDistance — 超 1ms 行程退一格 (GetBeatLengthAtTime = beatLength/divisor)
//   渲染端 v148 末端切线延长保留 (lazer calculateLength 对旧谱面 pixelLength>path 的 stable 兼容行为)
// 运行: node verifier/v160/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v160/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v160/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V160_TESTS_*)
fs.unlinkSync(out);

section('sliderPath.ts: snapSliderLength 硬钳 ≤ 几何全长');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/snapped <= geometryLength \? snapped : Math\.floor\(geometryLength\)/.test(src), '超过几何时 floor 到几何全长 (round 会回超)');
  assert(/ticks \* tickPx > geometryLength \+ vel \* 1\) ticks -= 1/.test(src), '保留 lazer 1ms 容差退一格');
}

section('sliderPath.ts: placementLength 两分支均钳制');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/geoCap = Math\.max\(1, Math\.floor\(geometryLength\)\)/.test(src), 'geoCap = floor(几何全长)');
  assert(/beats \* beatPx > geometryLength \+ vel \* 1\) beats -= 1/.test(src), '锁定间距分支: 超 1ms 退一拍 (原 round 直接向上入)');
  assert(/Math\.min\(Math\.max\(20, Math\.round\(beats \* beatPx\)\), geoCap\)/.test(src), '锁定分支 min(..., geoCap)');
  assert(/return Math\.min\(Math\.max\(20, snapped\), geoCap\)/.test(src), '非锁定分支 min(..., geoCap) (v219: 亚 tick 分支例外, 先行返回 1 tick)');
  assert(!/Math\.max\(beatPx, Math\.round\(geometryLength \/ beatPx\) \* beatPx\)/.test(src), '旧的直接向上入已移除');
}

console.log(failures ? `\nV160 FAILED: ${failures}` : '\nV160 ALL PASSED');
process.exit(failures ? 1 : 0);
