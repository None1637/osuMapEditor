// 验证器 v37: F2 滑条等时间拆分 (贝塞尔统一转换 + 弧长剖分 + 参数窗口)
// 依据: lazer BezierConverter.cs ConvertCatmullToBezierAnchors(:259)/ConvertCircleToBezierAnchors(:195)/ConvertLinearToBezierAnchors(:287);
//       hitsound 落段思路参考 SliderSelectionBlueprint.splitControlPoints(:500)
// 运行: cd app && node verifier/v37/check.mjs; node verifier/v37/cdp-split.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v37/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v37/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('bezierPath.ts: 共享贝塞尔工具 (lazer 公式接线)');
{
  const src = readSrc('src/osu/convert/bezierPath.ts');
  assert(/\(-v1\.x \+ 6 \* v2\.x \+ v3\.x\) \/ 6/.test(src), 'catmull->bezier 控制点 1 公式');
  assert(/\(-v4\.x \+ 6 \* v3\.x \+ v2\.x\) \/ 6/.test(src), 'catmull->bezier 控制点 2 公式');
  assert(src.includes('(4 / 3) * Math.tan(step / 4)'), '圆弧->贝塞尔 k=4/3*tan(θ/4) 近似');
  assert(src.includes('export function splitBezier') && src.includes('export function extractRange'), 'de Casteljau 剖分 + 弧长区间截取');
  assert(src.includes('export function sliderToBezierSegments') && src.includes('export function segmentsToPoints'), '滑条<->贝塞尔双向转换');
}

section('split.ts: computeSplit 语义接线');
{
  const src = readSrc('src/osu/convert/split.ts');
  assert(src.includes("export const DEFAULT_SPLIT_PARAMS"), '默认参数导出');
  assert(/\(L - \(n - 1\) \* distGap\) \/ n/.test(src), '每段路径长 ℓ=(L-(n-1)*distGap)/n');
  assert(/segLen <= 0/.test(src), 'ℓ>0 校验 (非法不生成)');
  assert(/sliderVelocityAt\(bm\.timingPoints, t, sm\)/.test(src), '每段时长用段起点时刻速度');
  assert(src.includes("curveType: 'B'") && src.includes('slides: 1'), '输出 B 滑条 slides=1');
  assert(/s\.time \+ i \* singleDur/.test(src), '端点 i 时间 = s.time + i*单程时长');
  assert(src.includes("loadParams") === false, 'split.ts 为纯函数 (不含 UI 持久化)');
}

section('SplitDialog/Inspector/App: 接线');
{
  const dlg = readSrc('src/components/convert/SplitDialog.tsx');
  assert(dlg.includes("loadParams('split'") && dlg.includes("saveParams('split'"), '参数加载/保存 (key split)');
  assert(dlg.includes('store.setConversionPreview') && dlg.includes('store.applyConversion'), '预览/应用接线');
  assert(dlg.includes('testid="count"') && dlg.includes('testid="time-gap"') && dlg.includes('testid="dist-gap"'), '参数控件 testid');
  const insp = readSrc('src/components/Inspector.tsx');
  assert(insp.includes("store.openConversion('split')") && insp.includes('data-conv-open="split"'), 'Inspector 拆分滑条按钮');
  const app = readSrc('src/App.tsx');
  assert(app.includes("store.conversionDialog === 'split'") && app.includes('<SplitDialog'), 'App 挂载 SplitDialog');
}

if (failures) { console.error(`\nVERIFIER_V37_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V37_ALL_TESTS_PASSED');
