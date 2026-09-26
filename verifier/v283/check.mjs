// 验证器 v283: 滑条路径实现与 osu!lazer 的 7 项差异修复
// 依据 (lazer 源码, 2026-09 master):
//   · osu.Game/Rulesets/Objects/Legacy/ConvertHitObjectParser.cs convertPoints
//     (PERFECT_CURVE 点数 !=3 → BEZIER; 3 点共线 → LINEAR; 末控制点不开启新隐式段)
//   · osu.Game/Rulesets/Objects/SliderPath.cs calculateSubPath (圆弧采样数 / >=1000 回退贝塞尔 /
//     退化回退贝塞尔) 与 calculateLength (末顶点精确移到 expectedDistance)
//   · osu.Framework/Utils/PathApproximator.cs (catmull_detail=50, bezier 二阶差容差剖分)
//   · osu.Framework/Utils/CircularArcProperties.cs (cross AlmostEquals 1e-7 退化判定)
// 运行: cd app && node verifier/v283/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v283/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v283/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 数值断言 (内部自报 V283_TESTS_*)
fs.unlinkSync(out);

section('sliderPath.ts: 差异3 截断精确落点 + 差异2 catmull 50 + 差异7 length 兜底');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/\(expectedLength - acc\) \/ d/.test(src), 'v283: 跨界按 (expected-prev)/d 插值精确切点 (lazer calculateLength)');
  assert(src.includes('this.cumulative.push(expectedLength)'), 'v283: 切点 cumulative = expectedLength (表不矛盾)');
  assert(/const n = 50;/.test(src) && src.includes('catmull_detail = 50'), 'v283: catmull 采样密度 50 (lazer catmull_detail)');
  assert(!src.includes('const n = 15;'), 'v283: 旧 15 步采样移除');
  assert(src.includes('o.length ?? sliderGeometryLength(curveType, pts)'), 'v283: getSliderPath 缺失 length 用几何全长');
}

section('sliderPath.ts: 差异1/6 圆弧 (回退贝塞尔 / 采样密度 / 超大回退 / 退化判定)');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/if \(pts\.length !== 3\) return bezierPath\(pts\);/.test(src), 'v283: P ≠3 兜底转贝塞尔 (解析层已转换)');
  assert(/if \(!arc\) return bezierPath\(pts\);/.test(src), 'v283: 退化三点回退贝塞尔 (lazer CircularArcProperties 无效)');
  assert(!src.includes('if (!arc) return linearPath(pts);'), 'v283: 退化回退折线移除');
  assert(src.includes('Math.abs(cross) <= 1e-7'), 'v283: 退化判定统一到 double AlmostEquals 1e-7');
  assert(/2 \* r <= 0\.1/.test(src) && /Math\.acos\(1 - 0\.1 \/ r\)/.test(src), 'v283: 采样数 = ceil(θ / (2·acos(1−0.1/r))) (径向误差 0.1px)');
  assert(src.includes('if (subPoints >= 1000) return bezierPath(pts);'), 'v283: subPoints >= 1000 回退贝塞尔 (lazer SliderPath)');
  assert(!src.includes('i + 2 < pts.length; i += 2'), 'v283: 多段三点弧拼接移除');
}

section('sliderPath.ts: 差异4 末尾重复控制点 + 差异5 flattenBezier lazer 剖分');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/if \(i < pts\.length - 1 && segment\.length > 0/.test(src), 'v283: 末控制点不开启新隐式段 (末尾重复对保留在同段)');
  assert(src.includes('function bezierFlatEnough') && src.includes('0.25 * 0.25 * 4'), 'v283: lazer 二阶差平坦度容差');
  assert(src.includes('function bezierSubdivideBuf') && src.includes('function bezierApproximateBuf'), 'v283: lazer bezierSubdivide/bezierApproximate');
  assert(src.includes('stack.pop()'), 'v283: 迭代栈 (无递归, 不栈溢出)');
  assert(!src.includes('function bernsteinAt') && !src.includes('subdivideBezier'), 'v283: 截断 Bernstein / 弦高剖分双轨移除');
}

section('parser.ts: 差异1 P 型规范化 + 差异7 length 兜底');
{
  const src = readSrc('src/osu/parser.ts');
  assert(src.includes("import { sliderGeometryLength } from './sliderPath';"), 'v283: 引入 sliderGeometryLength');
  assert(/if \(base\.curveType === 'P'\)[\s\S]*?all\.length !== 3\) base\.curveType = 'B'/.test(src), 'v283: P 点数 ≠3 整条转 BEZIER');
  assert(/Math\.abs\(cross\) <= 1e-7\) base\.curveType = 'L'/.test(src), 'v283: P 3 点共线转 LINEAR');
  assert(/pl > 0 \? pl : sliderGeometryLength\(base\.curveType/.test(src), 'v283: length 缺失/<=0 → 几何全长 (lazer ExpectedDistance=null)');
  assert(!src.includes("parseFloat(p[7] ?? '100') || 100"), 'v283: 旧 ?? 100 截断移除');
}

if (failures) { console.error(`\nV283_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV283_ALL_PASSED');
