// 验证器 v10: planSliderSounds 纯函数全区间测试 + 默认滑条采样文件 + store 循环音接线
// 谱面假设: 红线 1000ms@beatLength500, SliderMultiplier 1.4 -> 滑条速度 0.28px/ms
// slider len=140 slides=2 -> span=500ms, 全程 1000ms
import fs from 'fs';
import { parseOsu } from '../../src/osu/parser';
import { planSliderSounds, DEFAULT_SLIDER_STEMS } from '../../src/osu/clock/hitSounds';

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
1000,500,4,1,0,80,1,0

[HitObjects]
{OBJECTS}
`;

const mk = (objects: string, extraDiff = '') =>
  parseOsu(BASE.replace('{OBJECTS}', objects).replace('{EXTRA_DIFF}', extraDiff));

section('滑条音效: 基础边缘音 (无 edgeSounds 继承物件 hitSound)');
{
  const bm = mk('256,192,10000,2,0,B|356:192|356:192,2,140');
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  assert(plan.edges.length === 2, `应有 2 个边缘事件 (slides=2), 实际 ${plan.edges.length}`);
  assert(plan.edges[0].timeMs === 10500 && plan.edges[1].timeMs === 11000, `边缘时刻 10500/11000, 实际 ${plan.edges.map(e => e.timeMs)}`);
  assert(plan.edges.every(e => e.soundId === 'normal-hitnormal'), `边缘默认 normal-hitnormal, 实际 ${plan.edges.map(e => e.soundId)}`);
  assert(plan.ticks.length === 0, 'tickRate=1 且 span=beatLength 时无内部 tick');
  assert(plan.slide !== null && plan.slide.startMs === 10000 && plan.slide.endMs === 11000, 'slide 循环区间 10000~11000');
  assert(plan.slide?.soundId === 'normal-sliderslide', `slide 采样 normal-sliderslide, 实际 ${plan.slide?.soundId}`);
}

section('滑条音效: edgeSounds/edgeSets 逐端点覆盖');
{
  // 尾部字段: ...,2,140,0|2|4,0:0|2:2|3:3,0:0:0:0: (hitnormal 始终伴随)
  const bm = mk('256,192,10000,2,0,B|356:192|356:192,2,140,0|2|4,0:0|2:2|3:3,0:0:0:0:');
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  const ids = plan.edges.map(e => `${e.timeMs}:${e.soundId}`);
  assert(plan.edges.length === 4, `每边缘 hitnormal+附加音 共 4 事件, 实际 ${plan.edges.length} (${ids})`);
  assert(ids.includes('10500:soft-hitnormal') && ids.includes('10500:soft-hitwhistle'), `edge1 soft set, 实际 ${ids}`);
  assert(ids.includes('11000:drum-hitnormal') && ids.includes('11000:drum-hitfinish'), `edge2 drum set, 实际 ${ids}`);
}

section('滑条音效: 物件 hitSound 位标志传播到边缘');
{
  const bm = mk('256,192,10000,2,6,B|356:192|356:192,2,140'); // hitSound=6: whistle+finish (+ 固有 hitnormal)
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  const ids = plan.edges.map(e => e.soundId);
  assert(plan.edges.length === 6, `每边缘 normal+whistle+finish 共 6 事件, 实际 ${plan.edges.length}`);
  assert(ids.includes('normal-hitwhistle') && ids.includes('normal-hitfinish'), '边缘含 whistle/finish');
}

section('滑条音效: hitSample 自定义序号回退');
{
  const bm = mk('256,192,10000,2,0,B|356:192|356:192,2,140,,,0:0:2:0:'); // 位置字段: 空 edgeSounds/edgeSets + hitSample
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  assert(plan.edges[0].soundId === 'normal-hitnormal2', `序号 2 主候选, 实际 ${plan.edges[0].soundId}`);
  assert(plan.edges[0].fallbacks?.[0] === 'normal-hitnormal', '回退无序号版本');
}

section('滑条音效: slidertick 节拍点');
{
  const bm = mk('256,192,10000,2,0,B|356:192|356:192,2,140', 'SliderTickRate:2');
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  // tickRate=2 -> 间隔 250ms; span1: 10250, span2: 10750
  assert(plan.ticks.length === 2, `应有 2 个 tick, 实际 ${plan.ticks.length} (${plan.ticks.map(t => t.timeMs)})`);
  assert(plan.ticks[0].timeMs === 10250 && plan.ticks[1].timeMs === 10750, `tick 时刻 10250/10750`);
  assert(plan.ticks.every(t => t.soundId === 'normal-slidertick'), 'tick 采样 normal-slidertick');
}

section('滑条音效: 绿线 SV 影响 span 进而影响边缘时刻');
{
  const bm = parseOsu(BASE.replace('{OBJECTS}', '256,192,10000,2,0,B|356:192|356:192,2,140')
    .replace('{EXTRA_DIFF}', '')
    .replace('1000,500,4,1,0,80,1,0', '1000,500,4,1,0,80,1,0\n9000,-50,4,2,0,80,0,0'));
  const plan = planSliderSounds(bm, bm.hitObjects[0]);
  assert(plan.edges[0].timeMs === 10250 && plan.edges[1].timeMs === 10500, `SV 2x 下边缘 10250/10500, 实际 ${plan.edges.map(e => e.timeMs)}`);
  assert(plan.slide?.endMs === 10500, 'slide 循环同步缩短');
}

section('默认滑条采样文件 (osu! 经典 hitsound 复制)');
{
  assert(DEFAULT_SLIDER_STEMS.length === 6, 'DEFAULT_SLIDER_STEMS = 3 set × 2');
  for (const stem of DEFAULT_SLIDER_STEMS) {
    const p = new URL(`../../public/samples/${stem}.wav`, import.meta.url);
    assert(fs.existsSync(p), `存在: ${stem}.wav`);
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      assert(buf.length > 1000 && buf.subarray(0, 4).toString() === 'RIFF', `${stem}.wav 有效 RIFF (${buf.length}B)`);
    }
  }
}

section('回归: store 循环音接线');
{
  const src = fs.readFileSync(new URL('../../src/osu/store.ts', import.meta.url), 'utf8');
  assert(src.includes('tickSlideLoops') && src.includes('stopSlideLoops') && src.includes('resyncLoops'), '循环音三个方法就位');
  const pauseBody = src.match(/pause\(\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(pauseBody.includes('stopSlideLoops'), 'pause 停止循环音');
  assert(src.includes('src.loop = true'), 'sliderslide 以 loop 播放');
}

console.log(failures === 0 ? '\n全部断言通过' : `\n${failures} 条断言失败`);
if (failures > 0) process.exit(1);
