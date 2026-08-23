// 验证器 v11: hitsound 与 osu! 行为对齐 (lazer 参照)
//  - 音量: hitSample.volume 覆盖 timing point volume, 下限 5% (MINIMUM_SAMPLE_VOLUME)
//  - 滑条 hitSample 只取 bank: 节点音量 = 节点时刻 timing point volume
//  - slidertick 距离制排布 (SliderEventGenerator): tickDistance = velocity×beatLength/tickRate,
//    距端点 velocity×10ms 等效距离内不排; 反向 span 位置镜像
//  - 头节点继承 edgeSounds[0]/edgeSets[0]
// 谱面假设: 红线 1000ms@beatLength500, SliderMultiplier 1.4 -> 速度 0.28px/ms, scoringDistance 140px
import fs from 'fs';
import { parseOsu } from '../../src/osu/parser';
import { planSliderSounds, objectVolume, clampVolume, MIN_SAMPLE_VOLUME } from '../../src/osu/clock/hitSounds';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function section(name: string) { console.log('== ' + name); }

const BASE = `osu file format v14

[General]
SampleSet: Normal

[Difficulty]
ApproachRate:9
SliderMultiplier:1.4
{EXTRA_DIFF}

[TimingPoints]
{TIMING}

[HitObjects]
{OBJECTS}
`;

const mk = (objects: string, timing = '1000,500,4,1,0,80,1,0', extraDiff = '') =>
  parseOsu(BASE.replace('{OBJECTS}', objects).replace('{TIMING}', timing).replace('{EXTRA_DIFF}', extraDiff));

section('音量: 下限与覆盖 (objectVolume / clampVolume)');
{
  const bm = mk('256,192,10000,1,0');
  assert(objectVolume(bm.timingPoints, 10000, 0) === 80, `timing point volume 80, 实际 ${objectVolume(bm.timingPoints, 10000, 0)}`);
  assert(objectVolume(bm.timingPoints, 10000, 60) === 60, 'hitSample.volume=60 覆盖');
  assert(clampVolume(0) === MIN_SAMPLE_VOLUME && clampVolume(3) === 5 && clampVolume(200) === 100, 'clamp 5..100');
}

section('音量: 绿线 volume 生效 (含 0 -> 5% 下限)');
{
  const bm = mk('256,192,10000,1,0', '1000,500,4,1,0,80,1,0\n9000,-100,4,1,0,40,0,0');
  assert(objectVolume(bm.timingPoints, 10000, 0) === 40, `绿线 volume 40, 实际 ${objectVolume(bm.timingPoints, 10000, 0)}`);
  const bm2 = mk('256,192,10000,1,0', '1000,500,4,1,0,80,1,0\n9000,-100,4,1,0,0,0,0');
  assert(objectVolume(bm2.timingPoints, 10000, 0) === 5, '绿线 volume 0 -> 下限 5%');
}

section('滑条音量: 节点时刻 timing point volume (hitSample.volume 对滑条不生效, stable 一致)');
{
  const bm = mk('256,192,10000,2,0,B|356:192|356:192,2,140,,,0:0:0:60:',
    '1000,500,4,1,0,80,1,0\n10400,-100,4,1,0,40,0,0');
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  assert(plan.head.every(h => h.volume === 80), `头部 volume 80 (绿线 10400 未生效), 实际 ${plan.head.map(h => h.volume)}`);
  assert(plan.edges.every(e => e.volume === 40), `边缘 volume 40 (非 hitSample 60), 实际 ${plan.edges.map(e => e.volume)}`);
  assert(plan.slide?.volume === 80, `slide volume 80, 实际 ${plan.slide?.volume}`);
}

section('slidertick: 距离制排布 (tickDistance = 140px @ SM1.4/beatLength500/tickRate1)');
{
  const bm = mk('256,192,10000,2,0,B|536:192|536:192,1,280'); // len 280px, span 1000ms
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  const times = plan.ticks.map(t => t.timeMs);
  assert(times.length === 1 && times[0] === 10500, `len280 仅 d=140 一个 tick @10500, 实际 ${times}`);
  assert(plan.ticks.every(t => t.soundId === 'normal-slidertick' && t.volume === 80), 'tick 采样/音量');
}

section('slidertick: 反向 span 位置镜像 (slides=2)');
{
  const bm = mk('256,192,10000,2,0,B|536:192|536:192,2,280'); // span2 reversed
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  const times = plan.ticks.map(t => t.timeMs);
  // span1: d=140 -> 10000+0.5*1000=10500; span2 reversed: 11000+(1-0.5)*1000=11500
  assert(times.length === 2 && times[0] === 10500 && times[1] === 11500, `tick 10500/11500, 实际 ${times}`);
}

section('slidertick: tickRate=2 -> tickDistance 70px, 端点 10ms 等效距离内不排');
{
  const bm = mk('256,192,10000,2,0,B|536:192|536:192,1,280', '1000,500,4,1,0,80,1,0', 'SliderTickRate:2');
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  const times = plan.ticks.map(t => t.timeMs);
  // d=70,140,210 (d=280 >= 280-2.8 排除) -> +250,+500,+750
  assert(times.length === 3 && times.join() === '10250,10500,10750', `ticks 10250/10500/10750, 实际 ${times}`);
}

section('slidertick: 绿线 SV 2x -> tickDistance 280px > len 140 -> 无 tick');
{
  const bm = mk('256,192,10000,2,0,B|356:192|356:192,1,140',
    '1000,500,4,1,0,80,1,0\n9000,-50,4,2,0,80,0,0');
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  assert(plan.ticks.length === 0, `SV2x 下无 tick, 实际 ${plan.ticks.length}`);
}

section('头节点: 继承 edgeSounds[0]/edgeSets[0] (而非物件 hitSound)');
{
  const bm = mk('256,192,10000,2,0,B|356:192|356:192,2,140,8|0|0,2:2|0:0|0:0');
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  const headIds = plan.head.map(h => h.soundId);
  assert(headIds.includes('soft-hitnormal') && headIds.includes('soft-hitclap'), `头部 soft set + clap, 实际 ${headIds}`);
  assert(plan.edges.every(e => e.soundId === 'normal-hitnormal'), '边缘回落物件 hitSound(0) -> normal-hitnormal');
}

section('回归: store/scheduler gain 音量接线');
{
  const store = fs.readFileSync(new URL('../../src/osu/store.ts', import.meta.url), 'utf8');
  assert(store.includes('createGain') && store.includes('/ 100'), 'sink/loop 经 GainNode 应用音量');
  assert(store.includes('plan.head'), '滑条头节点事件来自 plan.head');
  const sched = fs.readFileSync(new URL('../../src/osu/clock/HitSoundScheduler.ts', import.meta.url), 'utf8');
  assert(sched.includes('volume?: number') && sched.includes('ev.volume'), 'HitSoundEvent 携带 volume 并传递 sink');
}

console.log(failures === 0 ? '\n全部断言通过' : `\n${failures} 条断言失败`);
if (failures > 0) process.exit(1);
