// v437 纯函数测试: 批量复制镜像重复 (隔份镜像 + 轴可选, 平移向量不镜像)
import { computeDuplicate, DEFAULT_DUPLICATE_PARAMS, type DuplicateParams } from '../../src/osu/duplicate';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const bm = {
  timingPoints: [{ time: 0, beatLength: 500, uninherited: true, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, effects: 0 }],
  difficulty: { sliderMultiplier: 1.4 },
} as unknown as Beatmap;

const circle = (x: number, y: number): HitObject =>
  ({ id: 1, type: 'circle', x, y, time: 0, newCombo: false, comboSkip: 0, hitSound: 0 }) as HitObject;
const slider = (): HitObject =>
  ({ id: 2, type: 'slider', x: 300, y: 100, time: 0, newCombo: false, comboSkip: 0, hitSound: 0,
     curveType: 'L', curvePoints: [{ x: 350, y: 150, red: false }], slides: 1, length: 100 }) as unknown as HitObject;

const P = (patch: Partial<DuplicateParams>): DuplicateParams => ({ ...DEFAULT_DUPLICATE_PARAMS, ...patch });

// 1) 不开镜像: 行为不变 (copy2 = 平移 2×dx)
{
  const out = computeDuplicate(bm, [circle(300, 192)], 'playfield', P({ count: 2, dx: 10 }));
  ok(out[0].x === 310 && out[1].x === 320, `不开镜像: 正常平移 (${out[0].x},${out[1].x})`);
}
// 2) 竖直轴镜像: copy2 x 绕 256 翻转, y 不变
{
  const out = computeDuplicate(bm, [circle(300, 100)], 'playfield', P({ count: 2, mirrorRepeat: true }));
  ok(out[0].x === 300 && out[0].y === 100, 'copy1 不镜像');
  ok(out[1].x === 212 && out[1].y === 100, `copy2 竖直轴镜像 x=2*256-300=212 (实际 ${out[1].x},${out[1].y})`);
}
// 3) 水平轴镜像: copy2 y 绕 192 翻转, x 不变
{
  const out = computeDuplicate(bm, [circle(300, 100)], 'playfield', P({ count: 2, mirrorRepeat: true, mirrorAxis: 'horizontal' }));
  ok(out[1].x === 300 && out[1].y === 284, `copy2 水平轴镜像 y=2*192-100=284 (实际 ${out[1].x},${out[1].y})`);
}
// 4) 隔份: copy3 (第 3 份) 不镜像
{
  const out = computeDuplicate(bm, [circle(300, 100)], 'playfield', P({ count: 3, mirrorRepeat: true }));
  ok(out[2].x === 300 && out[2].y === 100, `copy3 不镜像 (实际 ${out[2].x},${out[2].y})`);
}
// 5) 平移向量不镜像: dx=10 时 copy2 x = 212 + 2×10
{
  const out = computeDuplicate(bm, [circle(300, 100)], 'playfield', P({ count: 2, dx: 10, mirrorRepeat: true }));
  ok(out[1].x === 232, `平移不镜像: copy2 x=212+20=232 (实际 ${out[1].x})`);
}
// 6) 滑条控制点同样镜像 (形状翻转)
{
  const out = computeDuplicate(bm, [slider()], 'playfield', P({ count: 2, mirrorRepeat: true }));
  const cp = out[1].curvePoints![0];
  ok(out[1].x === 212 && out[1].y === 100 && cp.x === 162 && cp.y === 150,
    `滑条头+控制点镜像 (头 ${out[1].x},${out[1].y} 点 ${cp.x},${cp.y})`);
}
// 7) 旋转逐份递增 (copy2 转 180°) 再镜像 — (300,100) 绕 (256,192) 转 180° = (212,284), 再竖直镜像 = (300,284)
{
  const out = computeDuplicate(bm, [circle(300, 100)], 'playfield', P({ count: 2, rotateDeg: 90, mirrorRepeat: true }));
  ok(out[1].x === 300 && out[1].y === 284, `copy2 转180°后镜像 (实际 ${out[1].x},${out[1].y})`);
  // copy1 转 90° 不镜像
  ok(out[0].x === 348 && out[0].y === 236, `copy1 转90°不镜像 (实际 ${out[0].x},${out[0].y})`);
}
// 8) 转盘不动 (位置固定, 镜像不改)
{
  const sp = { id: 3, type: 'spinner', x: 256, y: 192, time: 0, endTime: 500, newCombo: false, comboSkip: 0, hitSound: 0 } as unknown as HitObject;
  const out = computeDuplicate(bm, [sp], 'playfield', P({ count: 2, mirrorRepeat: true }));
  ok(out[1].x === 256 && out[1].y === 192, '转盘不镜像');
}
// 9) 不改入参
{
  const p = P({ count: 2, mirrorRepeat: true });
  const snap = JSON.stringify(p);
  const src = [circle(300, 100)];
  computeDuplicate(bm, src, 'playfield', p);
  ok(JSON.stringify(p) === snap && src[0].x === 300, 'params/源物件不被修改');
}

console.log(failures ? `\nV437_TESTS_FAILED: ${failures}` : '\nV437_TESTS_PASSED');
if (failures) process.exit(1);
