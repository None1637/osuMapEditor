// 验证器 v44: 转换预览 combo 数字/颜色与转换应用后一致 (mergedWithPreview 单趟渲染)
// 运行: cd app && node verifier/v44/check.mjs; node verifier/v44/cdp-v44.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v44/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v44/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('renderer.ts: mergedWithPreview 导出');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/export function mergedWithPreview\(bm: Beatmap, prev/.test(src), '导出 mergedWithPreview');
  assert(/if \(!prev \|\| !prev\.objects\.length\) return bm/.test(src), '空预览返回原 bm');
  assert(/filter\(o => !hide\.has\(o\.id\)\)\.concat\(prev\.objects\)\.sort/.test(src), '源隐藏 + 预览并入 + 时间排序');
}

section('EditorCanvas.tsx: 单趟渲染 (无二次 renderPlayfield)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/bmView = mergedWithPreview\(bm, convPrev\)/.test(src), '渲染用合并视图 bmView');
  assert(/computeCombos\(bmView\)/.test(src), 'combo 按合并视图计算');
  assert(!src.includes('pbm = { ...bm'), '无第二趟预览 renderPlayfield');
  assert(/renderPlayfield\(\{[\s\S]{0,200}bm: bmView/.test(src), 'renderPlayfield 接收 bmView');
  assert(/__osuComboAt = \(id\)[\s\S]{0,200}computeCombos\(mergedWithPreview/.test(src), 'CDP 钩子 __osuComboAt 同管线');
}

section('Timelines.tsx: 时间轴同一合并管线');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/bmView = mergedWithPreview\(bm, convPrev\)/.test(src), '时间轴用合并视图 bmView');
  assert(/computeCombos\(bmView\)/.test(src), '时间轴 combo 按合并视图计算');
  assert(/drawList = bmView\.hitObjects/.test(src), '绘制列表 = 合并视图物件');
}

if (failures) { console.error(`\nVERIFIER_V44_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V44_ALL_TESTS_PASSED');
