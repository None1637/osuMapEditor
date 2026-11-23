import { bsplineToStableBezier } from '../../src/osu/freehand/pathApproximator';
import { b4ConvertSettings, setB4ConvertFitTolerance } from '../../src/osu/convert/convertB4';

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const dupAt = (pts: { x: number; y: number }[], x: number, y: number) => pts.some((p, i) => i > 0 && p.x === x && p.y === y && pts[i - 1].x === x && pts[i - 1].y === y);

const smooth = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }, { x: 400, y: 0 }];
ok(dupAt(bsplineToStableBezier(smooth, 4, 1, false), 200, 0), '原逻辑保留平顺红锚点');
ok(!dupAt(bsplineToStableBezier(smooth, 4, 1, true), 200, 0), 'v587 合并近直线红锚点');
const sharp = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 200, y: 100 }];
ok(dupAt(bsplineToStableBezier(sharp, 4, 1, true), 100, 100), '90° 尖角仍保留红锚点分段');

setB4ConvertFitTolerance(99);
ok(b4ConvertSettings.fitTolerance === 20, '容差上限 20px');
setB4ConvertFitTolerance(0.01);
ok(b4ConvertSettings.fitTolerance === 0.25, '容差下限 0.25px');
setB4ConvertFitTolerance(8);
ok(b4ConvertSettings.fitTolerance === 8, '自定义容差即时生效');
setB4ConvertFitTolerance(4);
console.log(failures ? 'V587_TESTS_FAILED' : 'V587_TESTS_PASSED');
if (failures) process.exit(1);
