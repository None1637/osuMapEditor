import { fitHighOrderBezierToPolyline, bSplineToPiecewiseLinear, bsplineToStableBezier } from '../../src/osu/freehand/pathApproximator';

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const source = Array.from({ length: 24 }, (_, i) => ({ x: i * 20, y: Math.sin(i / 3) * 80 }));
const fitted = fitHighOrderBezierToPolyline(bSplineToPiecewiseLinear(source, 4), 4);
ok(!!fitted && fitted.length > 4, `高阶贝塞尔整体拟合成功 (${fitted?.length} 个白锚点)`);
ok(!!fitted && !fitted.some((p, i) => i > 0 && p.x === fitted[i - 1].x && p.y === fitted[i - 1].y), '整体拟合不含重复红锚点');
ok(fitted![0].x === source[0].x && fitted![0].y === source[0].y, '首锚点保持');
ok(fitted![fitted!.length - 1].x === source[source.length - 1].x, '末锚点保持');
const stable = bsplineToStableBezier(source, 4, 4, true, true);
ok(!stable.some((p, i) => i > 0 && p.x === stable[i - 1].x && p.y === stable[i - 1].y), 'B4 转换优先使用无红锚点高阶方案');
console.log(failures ? 'V588_TESTS_FAILED' : 'V588_TESTS_PASSED');
if (failures) process.exit(1);
