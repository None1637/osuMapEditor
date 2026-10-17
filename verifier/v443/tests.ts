// v443 单元断言: 滑条长度吸附细分 ×2 开关 (editorPrefs.sliderHalfSnap, 默认关)
//   关 = 长度按当前细分整格吸附; 开 = v218 行为 (当前细分的 1/2, ×2 不在配置中退回当前细分)
import { sliderLengthSnapDivisor, snapSliderLength, placementLength } from '../../src/osu/sliderPath';
import { editorPrefs } from '../../src/osu/editorPrefs';
import type { TimingPoint } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// red: beatLength 500ms @ t=0; sliderMultiplier 1 → vel = 0.2 px/ms → beatPx = 100
const points = [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 }] as unknown as TimingPoint[];

const orig = editorPrefs.sliderHalfSnap;
try {
  // 默认 (关): 细分不变
  editorPrefs.sliderHalfSnap = false;
  assert(editorPrefs.sliderHalfSnap === false, '默认关 (localStorage 无此键时 false)');
  assert(sliderLengthSnapDivisor(4) === 4 && sliderLengthSnapDivisor(1) === 1 && sliderLengthSnapDivisor(16) === 16,
    `关: 细分不变 (4→${sliderLengthSnapDivisor(4)}, 1→${sliderLengthSnapDivisor(1)}, 16→${sliderLengthSnapDivisor(16)})`);
  // 几何 115: 关 tick=25 → 4 tick = 100; 开 tick=12.5 → 9 tick = 112.5 (可区分两态)
  const offSnap = snapSliderLength(points, 0, 1, 115, 4);
  assert(offSnap === 100, `关: snapSliderLength 整格吸附 115 → 100 (got ${offSnap})`);
  const offPlace = placementLength(points, 0, 1, 115, false, 1, 4);
  assert(offPlace === 100, `关: placementLength 整格吸附 115 → 100 (got ${offPlace})`);

  // 开: v218 行为 (×2 在配置内用 ×2, 否则退回)
  editorPrefs.sliderHalfSnap = true;
  assert(sliderLengthSnapDivisor(4) === 8 && sliderLengthSnapDivisor(16) === 16 && sliderLengthSnapDivisor(12) === 12,
    `开: 4→${sliderLengthSnapDivisor(4)}, 16→${sliderLengthSnapDivisor(16)} (退回), 12→${sliderLengthSnapDivisor(12)} (退回)`);
  const onSnap = snapSliderLength(points, 0, 1, 115, 4);
  assert(onSnap === 113, `开: snapSliderLength 1/2 细分吸附 115 → 9 tick=112.5 取整 113 (got ${onSnap})`);
  const onPlace = placementLength(points, 0, 1, 115, false, 1, 4);
  assert(onPlace === 113, `开: placementLength 1/2 细分吸附 115 → 取整 113 (got ${onPlace})`);
} finally {
  editorPrefs.sliderHalfSnap = orig;
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');
