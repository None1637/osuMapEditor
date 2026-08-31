// 验证器 v237: 圆弧转贝塞尔减点 (误差驱动最少分段) — bezierPath.ts circleToBezier。
// 行为断言 (esbuild 打包 tests.ts, 仿 v236): 小弧 1 段 / 减点实证 (段数 < 旧固定 90° 分块) /
//   段数随圆心角单调不减且恒 ≤ 旧实现 / 全半径扫描拟合误差 ≤ 0.2px / 端点精确 / 共线退化不变。
// 源码断言: ARC_BEZIER_ERR 常量 / unitArcBezierErr/maxArcAngleForErr 误差反推 / thetaMax 钳 [90°,180°] /
//   旧固定 90° 分块表达式已移除 / k=4/3·tan(θ/4) 公式与 v41 修复行保留 (v37/v41 断言兼容)。
// 运行: node verifier/v237/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v237/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v237/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 行为断言 (内部自报 V237_TESTS_*)
fs.unlinkSync(out);

section('bezierPath.ts: 误差驱动分块');
{
  const src = readSrc('src/osu/convert/bezierPath.ts');
  assert(/export const ARC_BEZIER_ERR = 0\.2/.test(src), 'ARC_BEZIER_ERR = 0.2px 导出');
  assert(/function unitArcBezierErr\(theta: number\)/.test(src), 'unitArcBezierErr 单位弧误差 (64 采样)');
  assert(/function maxArcAngleForErr\(r: number\)/.test(src), 'maxArcAngleForErr 二分反推单段最大圆心角');
  assert(/const thetaMax = Math\.max\(Math\.PI \/ 2, Math\.min\(Math\.PI, maxArcAngleForErr\(r\)\)\);/.test(src),
    'thetaMax = clamp(误差驱动角, 90°, 180°) (下钳保段数不增, 上钳防近整圆退化)');
  assert(/Math\.ceil\(Math\.abs\(total\) \/ thetaMax\)/.test(src), '分块数 = ceil(|total| / thetaMax)');
  assert(!/Math\.ceil\(Math\.abs\(total\) \/ \(Math\.PI \/ 2\)\)/.test(src), '旧固定 90° 分块表达式已移除');
  // 兼容既有验证器断言 (v37: k 公式; v41: 带符号 step 角度推进)
  assert(/\(4 \/ 3\) \* Math\.tan\(step \/ 4\)/.test(src), 'k = 4/3·tan(θ/4) 公式保留 (v37 断言)');
  assert(/const a0 = start \+ step \* i/.test(src) && !/dir \* step/.test(src), 'v41 修复行保留 (step 带符号, 不乘 dir)');
}

if (failures) { console.error(`\nV237_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV237_ALL_PASSED');
