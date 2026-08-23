// 验证器 v38: F3 多个物件合并为滑条 (贝塞尔拼入 + 红锚点接缝 + 无参数直接应用)
// 依据: 用户需求规格; 贝塞尔转换复用 v37 bezierPath.ts (lazer BezierConverter.cs 对齐)
// 运行: cd app && node verifier/v38/check.mjs; node verifier/v38/cdp-merge.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v38/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v38/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('merge.ts: computeMerge 语义接线');
{
  const src = readSrc('src/osu/convert/merge.ts');
  assert(src.includes('export function computeMerge'), 'computeMerge 导出');
  assert(src.includes('sliderToBezierSegments'), '滑条经 sliderToBezierSegments 转贝塞尔段 (形状保留)');
  assert(src.includes('segmentsToPoints'), '段序列转回控制点 (接缝重复点 = 红锚点)');
  assert(src.includes('resnapSliderLength'), '长度 = 几何全长节拍吸附 (与节点编辑一致)');
  assert(src.includes("curveType: 'B'") && src.includes('slides: 1'), "输出 curveType 'B' slides=1");
  assert(/\.sort\(\(a, b\) => a\.time - b\.time\)/.test(src), '按 time 升序连接');
  assert(src.includes('first.hitSound') && src.includes('first.hitSampleRaw') && src.includes('first.newCombo'), 'hitsound/newCombo 仅首物件');
  assert(src.includes('return null'), '边界条件返回 null (不动作)');
  assert(src.includes('loadParams') === false && src.includes('conversionPreview') === false, '无参数窗口/预览 (直接应用)');
}

section('Inspector: 合并为滑条按钮接线');
{
  const insp = readSrc('src/components/Inspector.tsx');
  assert(insp.includes("from '@/osu/convert/merge'"), '引入 computeMerge');
  assert(insp.includes('data-conv-apply="merge"'), '按钮 data-conv-apply="merge"');
  assert(/computeMerge\(bm, sel, store\.beatSnap\)/.test(insp), '点击直接 computeMerge (当前节拍吸附)');
  assert(/store\.applyConversion\(sel\.map\(o => o\.id\), \[slider\]\)/.test(insp), 'applyConversion 替换全部选中物件');
  assert(insp.includes("store.openConversion('stream')") && insp.includes('data-conv-open="stream"'), 'v36 转连打按钮保留');
}

if (failures) { console.error(`\nVERIFIER_V38_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V38_ALL_TESTS_PASSED');
