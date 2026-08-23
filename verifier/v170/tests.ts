// 验证器 v170 纯函数测试: parseSkinIniFonts (skin.ini [Fonts] HitCirclePrefix / HitCircleOverlap)
import { parseSkinIniFonts } from '../../src/osu/skin';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

section('Saraune Leaves 场景: HitCirclePrefix: blank + HitCircleOverlap: 25');
{
  const ini = `[General]\nName: x\n\n[Fonts]\nHitCirclePrefix: blank\nHitCircleOverlap: 25\n\nScorePrefix: score\nScoreOverlap: 0\n`;
  const f = parseSkinIniFonts(ini);
  assert(f.hitCirclePrefix === 'blank', `前缀 blank (得 ${f.hitCirclePrefix})`);
  assert(f.hitCircleOverlap === 25, `重叠 25 (得 ${f.hitCircleOverlap})`);
}

section('无 [Fonts] 段 → 全 null (调用方回退 default 前缀 + 旧字距)');
{
  const f = parseSkinIniFonts('[General]\nName: x\n[Colours]\nCombo1: 1,2,3\n');
  assert(f.hitCirclePrefix === null && f.hitCircleOverlap === null, '均 null');
  assert(parseSkinIniFonts('').hitCirclePrefix === null, '空串 null');
}

section('段边界: 到下一个 [Section] 为止; 键大小写不敏感');
{
  const ini = `[Fonts]\nhitcircleprefix: MyPrefix\n[Mania]\nHitCircleOverlap: 99\n`;
  const f = parseSkinIniFonts(ini);
  assert(f.hitCirclePrefix === 'MyPrefix', `大小写不敏感取到 MyPrefix (得 ${f.hitCirclePrefix})`);
  assert(f.hitCircleOverlap === null, `[Mania] 里的 HitCircleOverlap 不属于 [Fonts] (得 ${f.hitCircleOverlap})`);
}

section('非法 Overlap → null');
{
  const f = parseSkinIniFonts('[Fonts]\nHitCircleOverlap: abc\n');
  assert(f.hitCircleOverlap === null, `非法值 null (得 ${f.hitCircleOverlap})`);
  const f2 = parseSkinIniFonts('[Fonts]\nHitCircleOverlap: -2\n');
  assert(f2.hitCircleOverlap === -2, `负值合法 (lazer 默认 -2) (得 ${f2.hitCircleOverlap})`);
}

if (failures) { console.error(`V170_TESTS_FAILED: ${failures}`); process.exit(1); }
console.log('V170_TESTS_PASSED');
