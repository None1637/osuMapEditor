// v132 单元断言: 显示设置 — displaySettings 默认值/翻转、skin.ini [Colours] 解析、
// comboColor 皮肤色覆盖、alphaAt 滑条渐出/点击特效两个开关分支
import { displaySettings, setDisplayFlag } from '../../src/osu/displaySettings';
import { parseSkinIniColours } from '../../src/osu/skin';
import { comboColor } from '../../src/osu/renderer';
import { alphaAt, hitObjectEndTime, HIT_FADE } from '../../src/osu/lifecycle';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

section('displaySettings 默认值 (保持旧行为)');
{
  assert(displaySettings.skinColors === false, 'skinColors 默认关 (谱面自带颜色)');
  assert(displaySettings.sliderPathLine === false, 'sliderPathLine 默认关');
  assert(displaySettings.approachCircle === true, 'approachCircle 默认开');
  assert(displaySettings.sliderFadeOut === true, 'sliderFadeOut 默认开');
  assert(displaySettings.hitExplosion === true, 'hitExplosion 默认开');
}

section('setDisplayFlag 翻转可变单例');
{
  setDisplayFlag('sliderPathLine', true);
  assert(displaySettings.sliderPathLine === true, '翻转后渲染层直读生效');
  setDisplayFlag('sliderPathLine', false); // 还原, 不影响后续断言
  assert(displaySettings.sliderPathLine === false, '还原');
}

section('parseSkinIniColours: skin.ini [Colours] 解析');
{
  const ini = [
    '[General]', 'AnimationFramerate: 60', '',
    '[Colours]', 'Combo1 : 255,128,255', 'Combo2 : 0, 255, 0', 'Combo5 : 10,20,30',
    'SliderBorder : 255,255,255', 'SliderTrackOverride : 12,34,56', '',
    '[Fonts]', 'HitCirclePrefix: default',
  ].join('\r\n');
  const c = parseSkinIniColours(ini);
  assert(c.combos.length === 3, 'Combo1/2/5 跳号解析出 3 色');
  assert(c.combos[0] === '#ff80ff' && c.combos[1] === '#00ff00' && c.combos[2] === '#0a141e', '按编号排序并转 #rrggbb: ' + c.combos.join(','));
  assert(c.sliderBorder === '#ffffff', 'SliderBorder 解析');
  assert(c.sliderTrackOverride === '#0c2238', 'SliderTrackOverride 解析');
  const none = parseSkinIniColours('[General]\nAnimationFramerate: 30\n');
  assert(none.combos.length === 0 && none.sliderBorder === null && none.sliderTrackOverride === null, '无 [Colours] 段 -> 空/null (调用方回退谱面颜色)');
}

// 最小谱面/物件构造
const bm = {
  difficulty: { ar: 9, cs: 4, sliderMultiplier: 1.4 } as Beatmap['difficulty'],
  colors: { combos: ['rgb(1,2,3)', 'rgb(4,5,6)'], sliderBorder: '', sliderTrackOverride: '' },
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 }],
  hitObjects: [],
} as unknown as Beatmap;

section('comboColor: 皮肤色 override 优先');
{
  assert(comboColor(bm, 0) === 'rgb(1,2,3)', '无 override -> 谱面颜色');
  assert(comboColor(bm, 1) === 'rgb(4,5,6)', '谱面颜色按 combo 取模');
  assert(comboColor(bm, 0, ['#aabbcc']) === '#aabbcc', 'override 优先于谱面颜色');
  assert(comboColor(bm, 3, ['#aabbcc']) === '#aabbcc', 'override 单色取模');
  assert(comboColor(bm, 0, []) === 'rgb(1,2,3)', '空 override 数组回退谱面颜色');
}

section('alphaAt: 滑条渐出 / note 点击特效开关');
{
  const slider: HitObject = { id: 1, type: 'slider', x: 100, y: 100, time: 5000, newCombo: true, length: 140, slides: 1, curveType: 'L', curvePoints: [{ x: 200, y: 100 }], hitSound: 0 } as unknown as HitObject;
  const circle: HitObject = { id: 2, type: 'circle', x: 100, y: 100, time: 5000, newCombo: true, hitSound: 0 } as unknown as HitObject;
  const sEnd = hitObjectEndTime(bm, slider);
  const mid = HIT_FADE / 2;
  // 默认 (全开): 结束后淡出区间内 alpha 在 0~1 之间
  const sA = alphaAt(bm, slider, sEnd + mid);
  assert(sA > 0 && sA < 1, '默认: 滑条结束后淡出中 (' + sA.toFixed(2) + ')');
  const cA = alphaAt(bm, circle, 5000 + mid);
  assert(cA > 0 && cA < 1, '默认: 单点命中后暂留淡出中 (' + cA.toFixed(2) + ')');
  // 关滑条渐出: 结束立即消失, 但结束前不受影响; 单点不受影响
  setDisplayFlag('sliderFadeOut', false);
  assert(alphaAt(bm, slider, sEnd + mid) === 0, '关滑条渐出: 结束后立即 0');
  assert(alphaAt(bm, slider, sEnd) === 1, '关滑条渐出: 结束时刻仍为 1');
  assert(alphaAt(bm, circle, 5000 + mid) > 0, '关滑条渐出: 单点不受影响');
  setDisplayFlag('sliderFadeOut', true);
  // 关点击特效: 命中立即消失, 滑条不受影响
  setDisplayFlag('hitExplosion', false);
  assert(alphaAt(bm, circle, 5000 + mid) === 0, '关点击特效: 命中后立即 0');
  assert(alphaAt(bm, circle, 5000) === 1, '关点击特效: 命中时刻仍为 1');
  assert(alphaAt(bm, slider, sEnd + mid) > 0, '关点击特效: 滑条不受影响');
  setDisplayFlag('hitExplosion', true);
}

if (failures) { console.error(`\nV132_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV132_TESTS_ALL_PASSED');
