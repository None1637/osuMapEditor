// v294 数值测试: 测试游玩 Mod — toggleMod 互斥 / adjustDifficulty 比率 / clockRate /
//   HR 翻转 / session 级 RX 自动击打与免按键跟随 / AP autoCursorPos / EZ 判定窗放宽
import {
  toggleMod, adjustDifficulty, clockRate, isRelax, isAutopilot, applyHardRockFlip,
  type TestModId,
} from '../../src/osu/gameplay/mods';
import { TestPlaySession } from '../../src/osu/gameplay/testPlaySession';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}

// ---- toggleMod 互斥 ----
let m: TestModId[] = [];
m = toggleMod(m, 'EZ'); m = toggleMod(m, 'HR');
assert(m.join() === 'HR', 'EZ/HR 互斥 (开 HR 清 EZ)');
m = toggleMod(m, 'DT'); m = toggleMod(m, 'HT');
assert(m.join() === 'HR,HT', 'DT/HT 互斥 (开 HT 清 DT)');
m = toggleMod(m, 'AT');
assert(m.includes('AT'), 'AT 开启');
m = toggleMod(m, 'RX');
assert(!m.includes('AT') && m.includes('RX'), '开 RX 清 AT');
m = toggleMod(m, 'RX');
assert(!m.includes('RX'), '再点 RX 关闭');
m = toggleMod(m, 'RX'); m = toggleMod(m, 'AP');
assert(m.includes('RX') && m.includes('AP'), 'RX+AP 可共存');
m = toggleMod(m, 'AT');
assert(m.join('') === (['HR', 'HT', 'AT'] as const).join('') || (m.includes('AT') && !m.includes('RX') && !m.includes('AP')), '开 AT 清 RX/AP');

// ---- adjustDifficulty (lazer 比率) ----
const d0 = { hp: 5, cs: 4, od: 8, ar: 9, sliderMultiplier: 1.4, sliderTickRate: 1 };
const ez = adjustDifficulty(d0, ['EZ']);
assert(ez.hp === 2.5 && ez.cs === 2 && ez.od === 4 && ez.ar === 4.5, 'EZ 全项 ×0.5');
const hr = adjustDifficulty(d0, ['HR']);
assert(Math.abs(hr.od - 10) < 1e-9 && Math.abs(hr.ar - 10) < 1e-9, 'HR od/ar ×1.4 封顶 10');
assert(Math.abs(hr.cs - 5.2) < 1e-9 && Math.abs(hr.hp - 7) < 1e-9, 'HR cs ×1.3 / hp ×1.4');
assert(d0.od === 8, '原 difficulty 不被改');

// ---- clockRate / 判定 ----
assert(clockRate(['DT']) === 1.5 && clockRate(['HT']) === 0.75 && clockRate(['EZ']) === 1, 'clockRate 1.5/0.75/1');
assert(isRelax(['RX']) && isRelax(['AT']) && !isRelax(['AP']), 'isRelax = RX||AT');
assert(isAutopilot(['AP']) && isAutopilot(['AT']) && !isAutopilot(['RX']), 'isAutopilot = AP||AT');

// ---- applyHardRockFlip ----
const bm: Beatmap = {
  formatVersion: 14,
  general: { audioFilename: 'a.mp3', audioLeadIn: 0, previewTime: -1, countdown: 0, sampleSet: 'Normal', stackLeniency: 0.7, mode: 0, letterboxInBreaks: 0, widescreenStoryboard: 1, background: '' },
  metadata: { title: '', titleUnicode: '', artist: '', artistUnicode: '', creator: '', version: 't', source: '', tags: '', beatmapID: '0', beatmapSetID: '-1' },
  difficulty: { ...d0 },
  timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 100, uninherited: true, effects: 0 }],
  hitObjects: [
    { id: 1, type: 'circle', x: 100, y: 100, time: 1000 },
    { id: 2, type: 'slider', x: 200, y: 100, time: 2000, curveType: 'L', curvePoints: [{ x: 300, y: 100 }], slides: 1, length: 100 },
  ] as HitObject[],
  colors: { combos: [], sliderBorder: '', sliderTrackOverride: '' },
} as unknown as Beatmap;

const flipped = applyHardRockFlip(bm);
assert(flipped.hitObjects[0]!.y === 284 && flipped.hitObjects[1]!.curvePoints![0]!.y === 284, 'HR: y/curvePoints 翻转 384−y');
assert(bm.hitObjects[0]!.y === 100, 'HR: 原 bm 不变');

// ---- session 级 ----
// EZ 判定窗放宽 (od 8→4: great 窗 floor(range)-0.5 变大)
const s0 = new TestPlaySession(bm, 0);
const bmEz = { ...bm, difficulty: adjustDifficulty(bm.difficulty, ['EZ']) };
const sEz = new TestPlaySession(bmEz, 0);
assert(sEz.win.great > s0.win.great, `EZ 判定窗放宽 (${s0.win.great}→${sEz.win.great})`);

// RX: 光标在圈上, update(relax=true) 免按键自动击打 great
const sRx = new TestPlaySession(bm, 0);
sRx.update(1000, { x: 100, y: 100 }, false, true);
assert(sRx.score.counts.great === 1, 'RX 自动击打 (免按键, delta=0 → great)');

// RX: 滑条免按键跟随 — 球位置取自 autoCursorPos, keyHeld=false 也 tracking
const sRx2 = new TestPlaySession(bm, 0);
const ball = sRx2.autoCursorPos(2050); // 滑条进行中 → 球位置
assert(ball !== null, 'AP: 滑条进行中 autoCursorPos 跟球');
sRx2.update(2000, { x: 200, y: 100 }, false, true); // 先打掉头
sRx2.update(2050, ball!, false, true);
assert(sRx2.renderInfo().get(2)!.tracking === true, 'RX: 滑条免按键 tracking');

// AP: 非滑条时段 → 跳向最近的 pending 物件 (circle 1)
const sAp = new TestPlaySession(bm, 0);
const p = sAp.autoCursorPos(500);
assert(p !== null && p.x === 100 && p.y === 100, 'AP: autoCursorPos 指向下一 pending 物件');

// 无 relax 时 update 不自动击打
const sNo = new TestPlaySession(bm, 0);
sNo.update(1000, { x: 100, y: 100 }, false, false);
assert(sNo.score.counts.great === 0, '无 RX 时 update 不自动击打');

if (failures) { console.error(`\nV294_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('\nV294_TESTS_PASSED');
