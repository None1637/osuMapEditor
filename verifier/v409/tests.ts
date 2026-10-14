// v409 单元断言: 选中锚点处分割滑条 (splitSliderAtAnchors 纯函数)
import { splitSliderAtAnchors } from '../../src/osu/sliderPath';
import type { HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function mkSlider(curveType: string, ctrl: [number, number][], extra: Partial<HitObject> = {}): HitObject {
  return {
    id: 1, type: 'slider', x: ctrl[0][0], y: ctrl[0][1], time: 1000,
    curveType, curvePoints: ctrl.slice(1).map(([x, y]) => ({ x, y })),
    slides: 1, length: 500, ...extra,
  };
}
function ctrlOf(o: HitObject): [number, number][] {
  return [[o.x, o.y], ...(o.curvePoints ?? []).map(p => [p.x, p.y] as [number, number])];
}

// ---- L 直线滑条: 单切点 ----
{
  const s = mkSlider('L', [[0, 0], [100, 0], [200, 0], [300, 0]]);
  const out = splitSliderAtAnchors(s, [1])!;
  assert(out.length === 2, 'L: 切成 2 段');
  assert(JSON.stringify(ctrlOf(out[0])) === JSON.stringify([[0, 0], [100, 0]]), 'L: 首段含缝点');
  assert(JSON.stringify(ctrlOf(out[1])) === JSON.stringify([[100, 0], [200, 0], [300, 0]]), 'L: 次段缝点开头 (双侧各一份)');
  assert(out.every(o => o.curveType === 'L'), 'L: 子段 curveType 保持 L');
  assert(out.every(o => o.slides === 1), 'L: 子段 slides=1');
}
// ---- L: 多切点 -> 3 段 ----
{
  const s = mkSlider('L', [[0, 0], [100, 0], [200, 0], [300, 0]]);
  const out = splitSliderAtAnchors(s, [2, 1])!; // 乱序输入
  assert(out.length === 3, 'L: 两切点 -> 3 段');
  assert(JSON.stringify(ctrlOf(out[1])) === JSON.stringify([[100, 0], [200, 0]]), 'L: 中段两端都是缝点');
}
// ---- P 圆弧: 段恰 3 点保留 P, 否则 B ----
{
  const s = mkSlider('P', [[0, 0], [100, 0], [200, 0], [300, 0], [400, 0]]);
  const out = splitSliderAtAnchors(s, [2])!;
  assert(out[0].curveType === 'P', 'P: 恰 3 点段保持 P');
  assert(out[1].curveType === 'P', 'P: 次段也恰 3 点保持 P');
  const out2 = splitSliderAtAnchors(s, [1])!;
  assert(out2[0].curveType === 'B' && out2[1].curveType === 'B', 'P: 非 3 点段转 B');
}
// ---- B/B<n>/C 一律 B ----
{
  for (const ct of ['B', 'B4', 'C']) {
    const s = mkSlider(ct, [[0, 0], [100, 0], [200, 0], [300, 0]]);
    const out = splitSliderAtAnchors(s, [1])!;
    assert(out.every(o => o.curveType === 'B'), `${ct}: 子段一律 B`);
  }
}
// ---- hitsound 分配 ----
{
  const s = mkSlider('L', [[0, 0], [100, 0], [200, 0], [300, 0]], {
    hitSound: 10, newCombo: true, comboSkip: 2, hitSampleRaw: '1:2:3:4:f.wav',
    edgeSoundsRaw: '2|8', edgeSetsRaw: '1:0|2:0',
  });
  const out = splitSliderAtAnchors(s, [1, 2])!;
  assert(out[0].hitSound === 10 && out[1].hitSound === 0 && out[2].hitSound === 0, 'hitSound 仅首段');
  assert(out[0].newCombo === true && out[1].newCombo === false && out[2].newCombo === false, 'newCombo 仅首段');
  assert(out[0].comboSkip === 2 && out[1].comboSkip === 0, 'comboSkip 仅首段');
  assert(out[0].hitSampleRaw === '1:2:3:4:f.wav' && out[1].hitSampleRaw === undefined, 'hitSampleRaw 仅首段');
  assert(out[0].edgeSoundsRaw === '2|0', 'edgeSounds: 首段继承头端');
  assert(out[1].edgeSoundsRaw === '0|0', 'edgeSounds: 中间缝填 0');
  assert(out[2].edgeSoundsRaw === '0|8', 'edgeSounds: 末段继承尾端');
  assert(out[0].edgeSetsRaw === '1:0|0:0' && out[1].edgeSetsRaw === '0:0|0:0' && out[2].edgeSetsRaw === '0:0|2:0', 'edgeSets 同款规则');
}
// ---- 原串不存在则不写 ----
{
  const s = mkSlider('L', [[0, 0], [100, 0], [200, 0]]);
  const out = splitSliderAtAnchors(s, [1])!;
  assert(out.every(o => o.edgeSoundsRaw === undefined && o.edgeSetsRaw === undefined && o.hitSampleRaw === undefined), '无原始采样串时不生成');
}
// ---- null 情形 ----
{
  const s = mkSlider('L', [[0, 0], [100, 0], [200, 0]]);
  assert(splitSliderAtAnchors(s, [0]) === null, '只选头锚点 -> null');
  assert(splitSliderAtAnchors(s, [2]) === null, '只选尾锚点 -> null');
  assert(splitSliderAtAnchors(s, [0, 2]) === null, '头尾都选 -> null');
  assert(splitSliderAtAnchors(s, []) === null, '空选区 -> null');
  const two = mkSlider('L', [[0, 0], [100, 0]]);
  assert(splitSliderAtAnchors(two, [1]) === null, '两控制点滑条 -> null');
  const circle: HitObject = { id: 9, type: 'circle', x: 0, y: 0, time: 0 };
  assert(splitSliderAtAnchors(circle, [0]) === null, '非滑条 -> null');
}
// ---- 入参不被修改 ----
{
  const s = mkSlider('L', [[0, 0], [100, 0], [200, 0]]);
  const before = JSON.stringify(s);
  splitSliderAtAnchors(s, [1]);
  assert(JSON.stringify(s) === before, '原滑条对象不被修改');
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');
