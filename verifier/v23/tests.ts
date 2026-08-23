// v23 单元断言: computeStackHeights / computeStackOffsets (lazer OsuBeatmapProcessor.applyStacking 移植)
import { computeStackHeights, computeStackOffsets, STACK_DISTANCE } from '../../src/osu/stacking';
import type { Beatmap, HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function near(a: number, b: number, eps: number, msg: string) {
  assert(Math.abs(a - b) <= eps, `${msg} (got ${a}, want ~${b}±${eps})`);
}

let idc = 1;
const circle = (x: number, y: number, time: number): HitObject => ({ id: idc++, type: 'circle', x, y, time });
const sliderL = (x: number, y: number, time: number, ex: number, ey: number, length: number, slides = 1): HitObject =>
  ({ id: idc++, type: 'slider', x, y, time, curveType: 'L', curvePoints: [{ x: ex, y: ey }], slides, length });
const spinner = (time: number, endTime: number): HitObject => ({ id: idc++, type: 'spinner', x: 256, y: 192, time, endTime });

function makeBm(objs: HitObject[], stackLeniency = 0.7): Beatmap {
  return {
    formatVersion: 14,
    general: { audioFilename: 'a.mp3', audioLeadIn: 0, previewTime: -1, countdown: 0, sampleSet: 'Normal', stackLeniency, mode: 0, letterboxInBreaks: 0, widescreenStoryboard: 1, background: '' },
    editor: { distanceSpacing: 1, beatDivisor: 4, gridSize: 8, timelineZoom: 2 },
    metadata: { title: '', titleUnicode: '', artist: '', artistUnicode: '', creator: '', version: '', source: '', tags: '', beatmapID: '0', beatmapSetID: '-1' },
    // AR=9 -> preempt=600; 红点 beatLength=500, SM=1.4 -> 滑条速度 0.28 px/ms
    difficulty: { hp: 5, cs: 4, od: 8, ar: 9, sliderMultiplier: 1.4, sliderTickRate: 1 },
    timingPoints: [{ time: 0, beatLength: 500, meter: 4, sampleSet: 1, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
    hitObjects: [...objs].sort((a, b) => a.time - b.time),
    colors: { combos: [], sliderBorder: '', sliderTrackOverride: '' },
  };
}

assert(STACK_DISTANCE === 3, 'STACK_DISTANCE = 3 (lazer 常量)');

// AR=9 -> preempt=600ms, stackLeniency=0.7 -> threshold≈420ms
// ---- ① 同位置两 circle 在阈值内: 反向扫描"越早的物件 StackHeight 越大" ----
{
  const a = circle(200, 200, 1000), b = circle(200, 200, 1300);
  const m = computeStackHeights(makeBm([a, b]));
  assert(m.get(a.id) === 1, `两 circle 堆叠: 早的 StackHeight=1 (got ${m.get(a.id)})`);
  assert(!m.has(b.id), '两 circle 堆叠: 晚的 StackHeight=0 (不进 Map, 在原地显示)');
}

// ---- ①b 三连堆: 2/1/0, 偏移 = SH * r * -0.1 同施于 x/y ----
{
  const a = circle(200, 200, 1000), b = circle(200, 200, 1150), c = circle(200, 200, 1300);
  const bm = makeBm([a, b, c]);
  const m = computeStackHeights(bm);
  assert(m.get(a.id) === 2 && m.get(b.id) === 1 && !m.has(c.id),
    `三连堆: 早->晚 StackHeight = 2/1/0 (got ${m.get(a.id)}/${m.get(b.id)}/${m.get(c.id)})`);
  const off = computeStackOffsets(bm);
  const r = 54.4 - 4.48 * 4; // csToRadius(4) = 36.48
  near(off.get(a.id)!.dx, 2 * r * -0.1, 1e-9, '偏移 dx = SH * r * -0.1');
  near(off.get(a.id)!.dy, 2 * r * -0.1, 1e-9, '偏移 dy = SH * r * -0.1 (两轴同值 => 左上对角)');
  near(off.get(b.id)!.dx, 1 * r * -0.1, 1e-9, '第二层偏移减半');
}

// ---- ② 超出 threshold 不堆叠 (stackLeniency=1 -> threshold=600 整, 边界清晰) ----
{
  const a = circle(200, 200, 1000), b = circle(200, 200, 1600), c = circle(200, 200, 2601 - 1000);
  const m = computeStackHeights(makeBm([a, b], 1));
  assert(m.get(a.id) === 1 && !m.has(b.id), 'Δ=600 (=threshold, 不大于) 仍堆叠');
  const m2 = computeStackHeights(makeBm([a, c], 1)); // Δ=601 > 600
  assert(m2.size === 0, 'Δ=601 (>threshold) 不堆叠');
}

// ---- ②b 距离边界: dist<3 才堆叠 (恰好 3 不堆) ----
{
  const a = circle(200, 200, 1000), b = circle(203, 200, 1100), c = circle(200, 200, 1000), d = circle(202.9, 200, 1100);
  assert(computeStackHeights(makeBm([a, b])).size === 0, '距离=3 (不小于) 不堆叠');
  assert(computeStackHeights(makeBm([c, d])).get(c.id) === 1, '距离=2.9 (<3) 堆叠');
}

// ---- ③ 滑条末端压 circle 的负堆叠特例: circle StackHeight=-1, 滑条保持 0 ----
{
  const s = sliderL(100, 100, 1000, 300, 100, 200); // 几何末端 (300,100); duration=200/0.28≈714 -> endTime≈1714
  const c = circle(300, 100, 1500);                // 压在滑条几何末端上
  const m = computeStackHeights(makeBm([s, c]));
  assert(m.get(c.id) === -1, `滑条末端下的 circle 负堆叠 StackHeight=-1 (got ${m.get(c.id)})`);
  assert(!m.has(s.id), '滑条本身 StackHeight=0');
}

// ---- ③b EndPosition 为曲线几何末端 (不考虑折返): slides=2 视觉末端回头, 仍按几何末端堆叠 ----
{
  const s = sliderL(100, 100, 1000, 300, 100, 200, 2); // 折返滑条: 视觉末端 (100,100), 几何末端 (300,100)
  const c = circle(300, 100, 1900);                    // endTime = 1000 + 714*2 ≈ 2428; (int)1900-(int)2428 ≤ 420
  const m = computeStackHeights(makeBm([s, c]));
  assert(m.get(c.id) === -1, `折返滑条仍按几何末端堆叠 (circle StackHeight=-1, got ${m.get(c.id)})`);
}

// ---- ④ spinner 不参与堆叠 ----
{
  const sp = spinner(1000, 2000), c = circle(200, 200, 1300);
  const m = computeStackHeights(makeBm([sp, c]));
  assert(m.size === 0, 'spinner 与 circle 同位置相近时间: 双方都不进堆叠');
}

// ---- ⑤ 滑条头部正向堆叠 (ALWAYS positive): 前 circle 位置距滑条头 <3 -> 前 circle StackHeight+1 ----
{
  const c = circle(200, 200, 1000);
  const s = sliderL(201, 200, 1300, 400, 200, 200); // 头 (201,200) 距 circle 1px
  const m = computeStackHeights(makeBm([c, s]));
  assert(m.get(c.id) === 1, `滑条头压前 circle: 前 circle StackHeight=1 (got ${m.get(c.id)})`);
  assert(!m.has(s.id), '滑条本身 StackHeight=0');
}

if (failures) { console.error(`  tests.ts: ${failures} 处失败`); process.exit(1); }
console.log('  tests.ts: 纯函数断言全部通过');
