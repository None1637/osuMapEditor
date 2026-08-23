// 验证器 v66: 手绘滑条 (osu-framework IncrementalBSplineBuilder 完整移植 + lazer Drawing 模式接线)
// 运行: cd app && node verifier/v66/check.mjs; node verifier/v66/cdp-v66.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v66/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v66/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('pathApproximator.ts: B 样条换算 + Adam 拟合移植');
{
  const src = readSrc('src/osu/freehand/pathApproximator.ts');
  assert(/BEZIER_TOLERANCE = 0\.25/.test(src), 'BEZIER_TOLERANCE 0.25');
  assert(/bSplineToBezierInternal/.test(src) && /Math\.min\(k, pointCount - degree - i\)/.test(src), 'Boehm 节点插入 (l = min(k, 剩余))');
  assert(/bezierIsFlatEnough/.test(src) && /bezierSubdivide/.test(src) && /bezierApproximate/.test(src), '自适应细分三件套');
  assert(/generateBSplineWeights/.test(src) && /knots\[degree \+ 1 \+ j\]/.test(src), 'Cox-de Boor 基函数矩阵');
  assert(/adamUpdate/.test(src) && /step % 11 === 0/.test(src), 'Adam 优化 + 每 11 步重排标签');
  assert(/class Interpolator/.test(src), '弧长参数化插值器');
}

section('bsplineBuilder.ts: IncrementalBSplineBuilder 逐行移植');
{
  const src = readSrc('src/osu/freehand/bsplineBuilder.ts');
  assert(/FD_EPSILON = BEZIER_TOLERANCE \* 8/.test(src), 'FD_EPSILON = 2.0');
  assert(/SMOOTHED_INPUT_PATH_DEGREE = 7/.test(src), '平滑采样 7 阶 B 样条');
  assert(/N_AVG_SAMPLES = 32/.test(src) && /midWinding > avgCurvature \* 4/.test(src), '拐角检测 (32 窗口, 4 倍邻域均值)');
  assert(/allOnLine/.test(src) && /0\.02 \* this\.tolerance \* dist\(c0, c1\)/.test(src), '近直线段特判 (只留两端点)');
  assert(/inputDistance < FD_EPSILON \* 2\) return/.test(src), '输入细节 <4px 丢弃 (尾部跟随点)');
  assert(/res, 200, 5, 0\.8, 0\.99, cps, undefined/.test(src), '全量重建: 200 迭代 lr=5');
  assert(/res, iterations, 4, 0\.8, 0\.99, lastSegment, learnableMask/.test(src), '末段优化: lr=4 + mask');
  assert(/this\.updateLastSegment\(vertices, distances, cornerTs, segments, 100, false\)\s*;\s*\n\s*else\s*\n\s*this\.updateLastSegment\(vertices, distances, cornerTs, segments, 10, true\)/.test(src), 'Finish 100 迭代无 mask / 绘制中 10 迭代有 mask');
  assert(/lastSegment\.length - this\.degree \* 2/.test(src), 'mask 仅末尾 2×degree 点可学习');
}

section('freehandFit.ts: 圆弧特判 + 段组装 (SliderPlacementBlueprint)');
{
  const src = readSrc('src/osu/freehand/freehandFit.ts');
  assert(/circularArcProperties/.test(src) && /2 \* \(a\.x \* \(b\.y - c\.y\)/.test(src), '外接圆公式');
  assert(/length > 1000\) return null/.test(src) && /loss > circleThreshold \|\| totalWinding > 2 \* Math\.PI/.test(src), '圆弧合理性 (弧长/损失/单向 ≤ 一圈)');
  assert(/points\[Math\.floor\(points\.length \/ 2\)\]/.test(src), '三点 = 起/中/尾');
  assert(/red = points\.length > 0/.test(src), '段起点 => 红锚点');
}

section('EditorCanvas.tsx: Drawing 模式接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/new IncrementalBSplineBuilder\(4, 1\.8, 0\.4\)/.test(src), 'lazer 参数 (Degree 4 / Tolerance 1.8 / Corner 0.4)');
  assert(/FREEHAND_CIRCLE_THRESHOLD = 0\.0015/.test(src), 'CircleThreshold 0.0015 (lazer 默认)');
  // v74: 候选条件扩展到 length 0|1 (按下即放头+续拖手绘)
  assert(/store\.pendingSlider\.length === 0 \|\| store\.pendingSlider\.length === 1/.test(src) && /e\.button === 0/.test(src), '待放点 <=1 时按下 = 手绘候选 (v74: 含空待放, 一键手绘)');
  assert(/Math\.hypot\(cp\.x - cand\.x, cp\.y - cand\.y\) <= 4\) return/.test(src), '4px 拖拽阈值');
  assert(/builder\.addLinearPoint\(\{ x: 0, y: 0 \}\)/.test(src) && /builder\.addLinearPoint\(\{ x: cand\.x - head\.x, y: cand\.y - head\.y \}\)/.test(src), '绘制起点 = 头部原点 + 按下点 (相对头部)');
  // v74: 非单弧落盘改 'B4' (lazer 扩展 B 样条, 少控制点)
  assert(/singleArc && ctrl\.length === 3 \? 'P' : 'B4'/.test(src), "单段圆弧 => P, 否则 B4 (v74: lazer 编辑器口径)");
  assert(/if \(pt\.red\) ctrl\.push\(\{ \.\.\.a \}\)/.test(src), '红锚点加倍 (osu 连续重复点惯例)');
  assert(/builder\.finish\(\);\s*\n\s*finishFreehandSlider\(builder\)/.test(src), 'mouseup: Finish 后建滑条');
  assert((src.match(/freehandRef\.current/g) || []).length >= 8, 'window mouseup 兜底收尾');
}

if (failures) { console.error(`\nVERIFIER_V66_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V66_ALL_PASSED');
