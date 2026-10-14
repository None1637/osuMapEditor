// v406 单元断言: 滑条尾吸附节拍开关 (editorPrefs.sliderTailSnap) — 关 = 长度直通几何全长
import { resnapSliderLength, placementLength } from '../../src/osu/sliderPath';
import { editorPrefs } from '../../src/osu/editorPrefs';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}

// red: beatLength 500ms @ t=0; sliderMultiplier 1 → vel = 0.2 px/ms
// beatSnap 4 → 长度细分 1/8 → tickPx = 12.5; 几何 110 → 吸附 8 tick = 100, 不吸附 = 110
const bm = {
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 }],
  difficulty: { sliderMultiplier: 1 },
  editor: { beatDivisor: 4 },
} as unknown as Beatmap;
const slider: HitObject = {
  id: 1, type: 'slider', x: 0, y: 0, time: 0,
  curveType: 'L', curvePoints: [{ x: 110, y: 0 }], slides: 1, length: 110,
};

const orig = editorPrefs.sliderTailSnap;
try {
  editorPrefs.sliderTailSnap = true;
  resnapSliderLength(bm, slider, 4);
  assert(slider.length === 100, `开: resnap 吸附到 8 tick = 100 (got ${slider.length})`);

  editorPrefs.sliderTailSnap = false;
  resnapSliderLength(bm, slider, 4);
  assert(slider.length === 110, `关: resnap 直通几何全长 110 (got ${slider.length})`);

  editorPrefs.sliderTailSnap = true;
  const onLen = placementLength(bm.timingPoints, 0, 1, 110, false, 1, 4);
  assert(onLen === 100, `开: placementLength 吸附 100 (got ${onLen})`);
  editorPrefs.sliderTailSnap = false;
  const offLen = placementLength(bm.timingPoints, 0, 1, 110, false, 1, 4);
  assert(offLen === 110, `关: placementLength 直通 110 (got ${offLen})`);
  const offLock = placementLength(bm.timingPoints, 0, 1, 110, true, 1.4, 4);
  assert(offLock === 110, `关: 锁定间距分支同样直通 (got ${offLock})`);

  // 下限保护: 亚像素几何也 ≥1
  editorPrefs.sliderTailSnap = false;
  const tiny = placementLength(bm.timingPoints, 0, 1, 0.4, false, 1, 4);
  assert(tiny === 1, `关: 下限 1px (got ${tiny})`);
  const tinyS: HitObject = { ...slider, id: 2, curvePoints: [{ x: 0.4, y: 0 }], length: 5 };
  resnapSliderLength(bm, tinyS, 4);
  assert(tinyS.length === 1, `关: resnap 下限 1px (got ${tinyS.length})`);
} finally {
  editorPrefs.sliderTailSnap = orig;
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');
