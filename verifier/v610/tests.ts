import { placementLength } from '../../src/osu/sliderPath';
import { editorPrefs } from '../../src/osu/editorPrefs';
import type { TimingPoint } from '../../src/osu/parser';
editorPrefs.sliderHalfSnap = true;
let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const TPS: TimingPoint[] = [{ time: 1000, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }];
const locked = placementLength(TPS, 2000, 1, 160, true, 1.5, 4);
const unlocked = placementLength(TPS, 2000, 1, 160, false, 1.5, 4);
ok(locked === 150 && unlocked === 150, `间距倍率 1.5 时尾端仍按 1/8 拍网格取 150 (实际 ${locked}/${unlocked})`);
ok(locked === unlocked, '锁定间距与关闭时按同一节拍网格, 不乘间距倍率');
console.log(failures ? 'V610_TESTS_FAILED' : 'V610_TESTS_PASSED');
if (failures) process.exit(1);
