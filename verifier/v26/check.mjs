// 验证器 v26: 拖拽/插入/删除滑条节点后长度自动重算并吸附节拍 (lazer SnapTo 对齐)
// 运行: cd app && node verifier/v26/check.mjs; node verifier/v26/cdp-snap.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v26/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v26/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// 纯函数测试 (几何全长 / 吸附规则 / 写回)
await import('file://' + out);
fs.unlinkSync(out);

// ---- 源码接线断言 ----
section('sliderPath.ts: 长度吸附纯函数');
{
  const src = readSrc('src/osu/sliderPath.ts');
  for (const f of ['sliderGeometryLength', 'snapSliderLength', 'resnapSliderLength'])
    assert(src.includes(`export function ${f}`), `导出 ${f}`);
  assert(/computeRawPath\(curveType, pts\)/.test(src), '几何全长与渲染同算法 (computeRawPath)');
  assert(/ticks \* tickPx > geometryLength \+ vel \* 1/.test(src), '绝不超过几何全长 (1ms 容差)');
  assert(/ticks = Math\.max\(1, ticks\)/.test(src), '下限 1 tick');
  assert(/vel \* red\.beatLength \/ div/.test(src), 'tick 长 = vel*beatLength/div (v218: div = 长度吸附细分 = beatSnap×2, lazer GetBeatSnapDistance)');
}

section('EditorCanvas.tsx: 四处操作接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/insertSliderPoint\(ctrl, best, bestT\)\);\s*\n\s*resnapSliderLength/.test(src), '插入节点后 resnap');
  assert(/resnapSliderLength\(bm, o, store\.beatSnap\);\s*\n\s*invalidatePath\(o\.id\);/.test(src), '节点拖拽中实时 resnap (预览即最终值)');
  assert(/deleteSliderPoint[\s\S]*?resnapSliderLength\(bm, so, store\.beatSnap\)/.test(src), '删除节点后 resnap');
  assert(/sliderGeometryLength\(o\.curveType[\s\S]*?geo < \(o\.length \?\? 0\)\) o\.length = snapSliderLength/.test(src), '切换白红: 仅几何变短才重吸附 (lazer 条件)');
}

if (failures) { console.error(`\nVERIFIER_V26_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V26_ALL_TESTS_PASSED');
