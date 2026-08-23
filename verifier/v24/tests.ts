// 验证器 v24: hitsound 快捷键 (Q/W/E/R) + Inspector hitsound 编辑 — 纯函数测试
import { parseOsu, serializeOsu, parseHitObjectLine, genId, type HitObject } from '../../src/osu/parser';
import { parseHitSample, buildHitSampleRaw, hitSampleFilename } from '../../src/osu/clock/hitSounds';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); }
}
function section(name: string) { console.log('== ' + name); }

// 最小谱面 (含 timing point, 供序列化往返)
const BASE_MAP = `osu file format v14

[General]
AudioFilename: audio.mp3
SampleSet: Normal
Mode: 0

[Metadata]
Title:t
Artist:a
Creator:c
Version:v

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:8
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,1,0,80,1,0

[HitObjects]
256,192,1000,1,0
128,96,2000,5,2,0:0:0:0:
300,200,3000,2,0,L|400:200,1,100
`;

// ---------- 1. hitSound 位 toggle 逻辑 (store toggleSelectedHitSound 的纯函数部分) ----------
section('hitSound 位 toggle: W=2 E=4 R=8 异或翻转');
{
  const toggle = (h: number, bit: number) => h ^ bit; // store.toggleSelectedHitSound 核心
  assert(toggle(0, 2) === 2 && toggle(2, 2) === 0, 'whistle 位 0->2->0');
  assert(toggle(2, 4) === 6 && toggle(6, 4) === 2, 'finish 位叠加互不影响');
  assert(toggle(0, 8) === 8 && toggle(14, 8) === 6, 'clap 位翻转');
  assert(toggle(toggle(toggle(0, 2), 4), 8) === 14, 'whistle+finish+clap = 14');
  // bit0 (hitnormal) 是缺省位, 不在 toggle 范围
  assert(toggle(1, 2) === 3, 'normal 位不受 whistle toggle 影响');
}

// ---------- 2. newCombo toggle (store.toggleSelectedNewCombo 核心) ----------
section('newCombo toggle 与序列化 flags 位');
{
  const circle = parseHitObjectLine('256,192,1000,1,0')!;
  assert(!circle.newCombo, 'flags=1 无 newCombo');
  circle.newCombo = !circle.newCombo; // toggle 一次
  const bm = parseOsu(BASE_MAP);
  bm.hitObjects = [circle];
  const line = serializeOsu(bm).split('\n').find(l => l.startsWith('256,'))!;
  assert(line.split(',')[3] === '5', `newCombo 后 flags=5 (实际 ${line.split(',')[3]})`);
  circle.newCombo = !circle.newCombo; // 再 toggle 还原
  const line2 = serializeOsu(bm).split('\n').find(l => l.startsWith('256,'))!;
  assert(line2.split(',')[3] === '1', '还原后 flags=1');
  // ComboSkip 不动: flags 高 4~6 位保留
  const skip = parseHitObjectLine('256,192,1000,33,0')!; // typeFlags bit5 = skip 2
  assert(skip.comboSkip === 2 && !skip.newCombo, '解析 comboSkip=2');
  skip.newCombo = true;
  const bm2 = parseOsu(BASE_MAP);
  bm2.hitObjects = [skip];
  const line3 = serializeOsu(bm2).split('\n').find(l => l.startsWith('256,'))!;
  assert(line3.split(',')[3] === '37', `newCombo toggle 不动 comboSkip (flags=37, 实际 ${line3.split(',')[3]})`);
}

// ---------- 3. hitSample 编辑辅助函数 ----------
section('buildHitSampleRaw / hitSampleFilename');
{
  assert(buildHitSampleRaw({ normalSet: 0, additionSet: 0, customIndex: 0, volume: 0 }) === undefined, '全默认无 filename -> undefined (序列化省略)');
  assert(buildHitSampleRaw({ normalSet: 0, additionSet: 0, customIndex: 0, volume: 80 }) === '0:0:0:80:', '仅音量 -> 0:0:0:80:');
  assert(buildHitSampleRaw({ normalSet: 2, additionSet: 3, customIndex: 1, volume: 0 }) === '2:3:1:0:', 'set/序号组合');
  assert(buildHitSampleRaw({ normalSet: 0, additionSet: 0, customIndex: 0, volume: 0 }, 'hit.wav') === '0:0:0:0:hit.wav', '有 filename 即使全默认也保留字段');
  assert(hitSampleFilename('0:0:2:80:custom.wav') === 'custom.wav', '取 filename');
  assert(hitSampleFilename('1:2:0:0:') === undefined, '空 filename -> undefined');
  assert(hitSampleFilename(undefined) === undefined, '无 hitSample 段 -> undefined');
  // 编辑保留 filename (store.applyHitSampleToSelected 的组装方式)
  const raw = '0:0:2:50:drum-hit.wav';
  const edited = buildHitSampleRaw({ ...parseHitSample(raw), volume: 90 }, hitSampleFilename(raw));
  assert(edited === '0:0:2:90:drum-hit.wav', `改音量保留 filename (实际 ${edited})`);
}

// ---------- 4. 序列化往返: toggle 后物件行 hitSound/hitSample 字段正确 ----------
section('serializeOsu: hitSound 位与 hitSample 字段往返');
{
  const bm = parseOsu(BASE_MAP);
  const [c1, c2, s1] = bm.hitObjects;
  // 单点 toggle whistle + clap
  c1.hitSound = (c1.hitSound ?? 0) ^ 2 ^ 8;
  const out1 = serializeOsu(bm);
  const l1 = out1.split('\n').find(l => l.startsWith('256,'))!;
  assert(l1.split(',')[4] === '10', `hitSound 10 (whistle+clap) (实际 ${l1.split(',')[4]})`);
  assert(l1.split(',').length === 5, '无 hitSampleRaw 时不输出 hitSample 字段');
  // c2 原本带全默认 hitSampleRaw "0:0:0:0:" (原样保留, .osu 格式允许)
  const l2 = out1.split('\n').find(l => l.startsWith('128,'))!;
  assert(l2.endsWith(',0:0:0:0:'), '原文件的全默认 hitSample 段原样保留');
  // 编辑成全默认 -> hitSampleRaw 变 undefined -> 字段省略
  c2.hitSampleRaw = buildHitSampleRaw(parseHitSample(c2.hitSampleRaw));
  const l2b = serializeOsu(bm).split('\n').find(l => l.startsWith('128,'))!;
  assert(l2b.split(',').length === 5 && !l2b.includes('0:0:0:0'), '编辑成全默认后 hitSample 字段省略');
  // 滑条 toggle finish: hitSound 字段更新, edgeSounds/edgeSets 不受影响 (本批不碰)
  s1.hitSound = (s1.hitSound ?? 0) ^ 4;
  const l3 = serializeOsu(bm).split('\n').find(l => l.startsWith('300,'))!;
  const f3 = l3.split(',');
  assert(f3[4] === '4', `滑条 hitSound=finish (实际 ${f3[4]})`);
  assert(f3[5] === 'L|400:200' && f3[6] === '1' && f3[7] === '100', '滑条几何字段不变');
  // 往返再解析: 位标志/段保持
  const bm2 = parseOsu(serializeOsu(bm));
  assert((bm2.hitObjects[0].hitSound ?? 0) === 10, '往返后 hitSound 位保持');
  assert(bm2.hitObjects[1].hitSampleRaw === undefined, '往返后省略的 hitSample 不复活');
  assert((bm2.hitObjects[2].hitSound ?? 0) === 4, '往返后滑条 hitSound 保持');
}

// ---------- 5. applyHitSampleToSelected 批量语义 (多选统一应用) ----------
section('批量 hitSample 应用 (多选统一)');
{
  const mk = (id: number, raw?: string): HitObject => ({ id, type: 'circle', x: 0, y: 0, time: id, hitSound: 0, hitSampleRaw: raw });
  const objs = [mk(1), mk(2, '2:1:0:0:'), mk(3, '0:0:5:60:x.wav')];
  // 模拟 store.applyHitSampleToSelected({ volume: 70 })
  for (const o of objs)
    o.hitSampleRaw = buildHitSampleRaw({ ...parseHitSample(o.hitSampleRaw), volume: 70 }, hitSampleFilename(o.hitSampleRaw));
  assert(objs[0].hitSampleRaw === '0:0:0:70:', '无 hitSample 的物件补上音量段');
  assert(objs[1].hitSampleRaw === '2:1:0:70:', '既有 set 保留, 仅音量更新');
  assert(objs[2].hitSampleRaw === '0:0:5:70:x.wav', 'filename 保留');
  // 音量改回 0 且无 filename -> 省略
  for (const o of objs)
    o.hitSampleRaw = buildHitSampleRaw({ ...parseHitSample(o.hitSampleRaw), volume: 0 }, hitSampleFilename(o.hitSampleRaw));
  assert(objs[0].hitSampleRaw === undefined, '恢复默认后字段省略');
  assert(objs[2].hitSampleRaw === '0:0:5:0:x.wav', '有 filename 不省略');
}

if (failures) { console.error(`\nVERIFIER_V24_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V24_TESTS_PASSED');
