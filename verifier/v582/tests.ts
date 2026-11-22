import { computeDuplicate, DEFAULT_DUPLICATE_PARAMS, type DuplicateParams } from '../../src/osu/duplicate';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const bm = { timingPoints: [{ time: 0, beatLength: 500, uninherited: true }], difficulty: { sliderMultiplier: 1.4 } } as unknown as Beatmap;
const src: HitObject = { id: 1, type: 'circle', x: 300, y: 100, time: 0, hitSound: 0 };
const p: DuplicateParams = {
  ...DEFAULT_DUPLICATE_PARAMS, count: 3, mirrorRepeat: true, mirrorAxis: 'custom',
  mirrorAxisP1: { x: 0, y: 0 }, mirrorAxisP2: { x: 512, y: 512 },
};
const out = computeDuplicate(bm, [src], 'playfield', p);
ok(out[0].x === 100 && out[0].y === 300, `第 1 份关于 y=x 镜像: (300,100)→(100,300), 实际 ${out[0].x},${out[0].y}`);
ok(out[1].x === 300 && out[1].y === 100, '第 2 份保持原位置');
ok(out[2].x === 100 && out[2].y === 300, '第 3 份再次镜像');
ok(computeDuplicate(bm, [src], 'playfield', { ...p, mirrorAxisP2: p.mirrorAxisP1 }).length === 0, '自定义轴两点重合时不生成无效副本');
const translated = computeDuplicate(bm, [src], 'playfield', { ...p, dx: 10, dy: -5 });
ok(translated[0].x === 110 && translated[0].y === 295, '任意轴镜像后平移向量仍不翻转');
ok(src.x === 300 && src.y === 100, '源物件不被修改');
console.log(failures ? `V582_TESTS_FAILED: ${failures}` : 'V582_TESTS_PASSED');
if (failures) process.exit(1);
