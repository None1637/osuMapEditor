import type { HitObject } from '../../src/osu/parser';
import { reverseSlider } from '../../src/osu/reverse';
import { snapshotObjectDragGeometry, rebaseObjectDragAfterTransform, type ObjectDragGeometry } from '../../src/osu/objectDrag';

let failures = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const slider: HitObject = { id: 1, type: 'slider', x: 100, y: 100, time: 0, curveType: 'L', curvePoints: [{ x: 200, y: 100 }], slides: 1, length: 100 };
const objs = new Map([[1, slider]]);
const d: ObjectDragGeometry = { startX: 150, startY: 110, deltaX: 20, deltaY: 0, transformSeq: 0, ...snapshotObjectDragGeometry(objs) };

// 已拖动 +20 后反转: 真尾 220 成为新头, 旧头 120 成为尾点
slider.x += 20;
slider.curvePoints![0]!.x += 20;
reverseSlider(slider);
ok(slider.x === 220 && slider.curvePoints![0]!.x === 120, '布景: 拖动后的滑条完成反转');
rebaseObjectDragAfterTransform(d, { x: 170, y: 110 }, 1, objs);
ok(d.startX === 170 && d.deltaX === 0 && d.transformSeq === 1, '反转后以当前指针重新起算且不叠加旧位移');
ok(d.orig.get(1)?.x === 220 && d.orig.get(1)?.curve?.[0]?.x === 120, 'orig 重建为反转后的头与控制点');
ok(d.tails.get(1)?.x === 120, '滑条尾吸附/钳制快照同步反转');

// 继续拖 +20: 应从反转后的 220 到 240, 而非旧 orig 100 + 总位移 40 = 140
const dx = Math.round(190 - d.startX);
slider.x = d.orig.get(1)!.x + dx;
slider.curvePoints![0]!.x = d.orig.get(1)!.curve![0]!.x + dx;
ok(slider.x === 240 && slider.curvePoints![0]!.x === 140, `继续拖动保留反转并累加新位移 (${slider.x}/${slider.curvePoints![0]!.x})`);

console.log(failures ? 'TESTS_V613_FAILED' : 'TESTS_V613_ALL_PASSED');
if (failures) process.exit(1);
