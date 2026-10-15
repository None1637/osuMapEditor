// v422 数值测试: 被动 HP drain — 速率量纲 / TestScore.drain 钳制 / session 门控 (首物件前与 break 段不掉)
import { hpDrainPerMs } from '../../src/osu/gameplay/hud';
import { TestScore } from '../../src/osu/gameplay/judgement';
import { TestPlaySession } from '../../src/osu/gameplay/testPlaySession';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// ---- 速率量纲 ----
assert(Math.abs(hpDrainPerMs(5) * 1000 - 0.09) < 1e-12, 'HP5 → 0.09/s (hp × 0.018/s)');
assert(hpDrainPerMs(0) === 0, 'HP0 不掉血');
assert(hpDrainPerMs(10) > hpDrainPerMs(5), 'HP 越高掉越快');

// ---- TestScore.drain 钳 [0,1] ----
{
  const sc = new TestScore();
  sc.drain(0.3);
  assert(Math.abs(sc.hp - 0.7) < 1e-9, 'drain 0.3 → hp 0.7');
  sc.drain(5);
  assert(sc.hp === 0, '掉空钳 0 (不判负)');
  sc.drain(-1);
  assert(sc.hp === 0, '负数忽略');
}

// ---- session 集成: 门控与速率 ----
const d0 = { hp: 5, cs: 4, od: 8, ar: 9, sliderMultiplier: 1.4, sliderTickRate: 1 };
const mkBm = (events?: string[]): Beatmap => ({
  formatVersion: 14,
  general: { audioFilename: 'a.mp3', audioLeadIn: 0, previewTime: -1, countdown: 0, sampleSet: 'Normal', stackLeniency: 0.7, mode: 0, letterboxInBreaks: 0, widescreenStoryboard: 1, background: '' },
  metadata: { title: '', titleUnicode: '', artist: '', artistUnicode: '', creator: '', version: 't', source: '', tags: '', beatmapID: '0', beatmapSetID: '-1' },
  difficulty: { ...d0 },
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 }],
  hitObjects: [{ id: 1, type: 'circle', x: 256, y: 192, time: 5000, newCombo: true, comboSkip: 0, hitSound: 0 }] as HitObject[],
  colors: { combos: [], sliderBorder: '', sliderTrackOverride: '' },
  rawSections: events ? { Events: events } : {},
} as unknown as Beatmap);

{
  const s = new TestPlaySession(mkBm(), 0);
  // 首物件 (5000) 前不掉血
  for (let t = 0; t <= 4000; t += 16) s.update(t, { x: -100, y: -100 }, false);
  assert(s.score.hp === 1, '首物件前不掉血');
  // 首物件后按速率掉血 (不打物件, miss 扣血另行; 用 HP0 隔离 drain 单独验证)
  const s2 = new TestPlaySession(mkBm(), 0);
  (s2 as unknown as { bm: Beatmap }).bm = { ...s2.bm, difficulty: { ...d0, hp: 0 } }; // 隔离 drain
  for (let t = 0; t <= 5000; t += 16) s2.update(t, { x: -100, y: -100 }, false);
  assert(s2.score.hp === 1, 'HP0 全程不掉血');
  // break 段 (6000-8000) 内不掉血
  const s3 = new TestPlaySession(mkBm(['2,6000,8000']), 0);
  for (let t = 5000; t <= 6000; t += 16) s3.update(t, { x: -100, y: -100 }, false);
  const hpBeforeBreak = s3.score.hp;
  for (let t = 6000; t <= 7900; t += 16) s3.update(t, { x: -100, y: -100 }, false);
  assert(s3.score.hp === hpBeforeBreak, 'break 段内不掉血');
  assert(hpBeforeBreak < 1, 'break 前已掉血 (drain 生效)');
  // break 后恢复掉血
  for (let t = 7900; t <= 9000; t += 16) s3.update(t, { x: -100, y: -100 }, false);
  assert(s3.score.hp < hpBeforeBreak, 'break 后恢复掉血');
  // 时间倒退不掉血
  const hpNow = s3.score.hp;
  s3.update(500, { x: 0, y: 0 }, false);
  assert(s3.score.hp === hpNow, 'seek 倒退不掉血');
}

if (failures) { console.error(`\nV422_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV422_TESTS_PASSED');
