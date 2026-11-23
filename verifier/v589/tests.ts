import { fitHighOrderBezierToPolyline, bSplineToPiecewiseLinear, bsplineToStableBezier } from '../../src/osu/freehand/pathApproximator';
import { b4ConvertSettings, setB4ConvertMaxDegree } from '../../src/osu/convert/convertB4';

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const source = Array.from({ length: 24 }, (_, i) => ({ x: i * 20, y: Math.sin(i / 3) * 80 }));
const raw = bSplineToPiecewiseLinear(source, 4);
const limited = fitHighOrderBezierToPolyline(raw, 20, 5);
ok(!!limited && limited.length <= 6, `最高 5 阶时白锚点不超过 6 (${limited?.length})`);
setB4ConvertMaxDegree(5);
ok(b4ConvertSettings.maxDegree === 5, '最高阶数设置即时生效');
const stable = bsplineToStableBezier(source, 4, 20, true, true, b4ConvertSettings.maxDegree);
ok(stable.length <= 6, 'B4 转换使用配置的阶数上限');
setB4ConvertMaxDegree(99);
ok(b4ConvertSettings.maxDegree === 24, '最高阶数上限 24');
setB4ConvertMaxDegree(1);
ok(b4ConvertSettings.maxDegree === 3, '最低阶数下限 3');
setB4ConvertMaxDegree(24);
console.log(failures ? 'V589_TESTS_FAILED' : 'V589_TESTS_PASSED');
if (failures) process.exit(1);
