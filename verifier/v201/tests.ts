// v201: combo 颜色顺序对齐 lazer (OsuHitObject.UpdateComboInformation)
import { computeCombos } from '../../src/osu/renderer';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  PASS ${msg}`);
  else { failures++; console.error(`  FAIL ${msg}`); }
}

let nextId = 1;
function obj(partial: Partial<HitObject>): HitObject {
  return { id: nextId++, type: 'circle', x: 256, y: 192, time: nextId * 100, ...partial } as HitObject;
}
function bm(objs: HitObject[]): Beatmap {
  return {
    hitObjects: objs, timingPoints: [], colors: { combos: [] },
    difficulty: { ar: 9, cs: 4, od: 8, hp: 5, sliderMultiplier: 1.4 },
  } as unknown as Beatmap;
}

// ---- T1: 首个 combo 的生效色索引 = 1 (stable/lazer quirk, EditorBeatmapSkin 注释) ----
{
  const c = computeCombos(bm([obj({ newCombo: true }), obj({}), obj({ newCombo: true })]));
  const [a, b, d] = [...c.values()];
  assert(a.combo === 1 && a.comboWithOffset === 1 && a.index === 1, 'T1 首物件 combo=1 (生效色 = 下标1)');
  assert(b.combo === 1 && b.index === 2, 'T1 同 combo 第二物件 index=2');
  assert(d.combo === 2 && d.comboWithOffset === 2 && d.index === 1, 'T1 newCombo 递增');
}

// ---- T2: comboSkip 只进 comboWithOffset (谱面色), 不进 combo (皮肤色) ----
{
  const c = computeCombos(bm([obj({ newCombo: true }), obj({ newCombo: true, comboSkip: 2 }), obj({ newCombo: true })]));
  const [a, b, d] = [...c.values()];
  assert(a.comboWithOffset === 1, 'T2 首 = 1');
  assert(b.combo === 2 && b.comboWithOffset === 1 + 1 + 2, 'T2 skip=2: WithOffsets += 3, combo 只 +1');
  assert(d.combo === 3 && d.comboWithOffset === 4 + 1, 'T2 后续在正常基础上 +1');
}

// ---- T3: spinner 永不开始新 combo; spinner 后强制 new combo ----
{
  const sp = obj({ type: 'spinner', newCombo: true });
  const c = computeCombos(bm([sp, obj({}), obj({ newCombo: false }), obj({})]));
  const [s, a, b, d] = [...c.values()];
  assert(s.combo === 0 && s.comboWithOffset === 0, 'T3 spinner 带 newCombo 也不开新 combo (combo=0)');
  assert(a.combo === 1 && a.index === 1, 'T3 spinner 后首物件强制 new combo');
  assert(b.combo === 1 && b.index === 2, 'T3 无 newCombo 不递增');
  assert(d.combo === 1 && d.index === 3, 'T3 继续 +1');
}

// ---- T4: 首物件是 spinner 的边界 ----
{
  const c = computeCombos(bm([obj({ type: 'spinner' }), obj({})]));
  const [s, a] = [...c.values()];
  assert(s.combo === 0, 'T4 首个 spinner combo=0 (Colours[0])');
  assert(a.combo === 1, 'T4 spinner 后首物件 combo=1');
}

if (failures) { console.error(`V201_TESTS FAILED: ${failures}`); process.exit(1); }
console.log('V201_TESTS ALL PASSED');
