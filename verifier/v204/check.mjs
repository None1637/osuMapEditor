// 验证器 v204: slidertick 出现时机对齐 lazer SliderTick.ApplyDefaultsToSelf
//   TimePreempt = (tickTime - spanStart)/2 + (spanIndex>0 ? 200 : preempt*0.66)
// 运行: node verifier/v204/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v204/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v204/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V204_TESTS_*)
fs.unlinkSync(out);

section('renderer.ts: sliderTickPreempt 公式');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/export function sliderTickPreempt\(tickTime: number, spanStart: number, spanIndex: number, preempt: number\)/.test(src), 'sliderTickPreempt 导出');
  assert(/return \(tickTime - spanStart\) \/ 2 \+ \(spanIndex > 0 \? 200 : preempt \* 0\.66\);/.test(src), 'lazer SliderTick 公式 (含 stable 200ms 偏移)');
  assert(/const showAt = tickTime - sliderTickPreempt\(/.test(src), 'sliderTickState 用新公式算出出现时刻');
  assert(/o\.time \+ t\.spanIndex \* span/.test(src), 'drawSlider tick 循环传 spanStart');
}

section('hitSounds.ts: SliderTickPoint 带 spanIndex');
{
  const src = readSrc('src/osu/clock/hitSounds.ts');
  assert(/spanIndex: number;/.test(src), 'SliderTickPoint.spanIndex 字段');
  assert(/out\.push\(\{ progress, timeMs: [^}]*spanIndex: s \}\)/.test(src), '排布时写入 spanIndex');
}

if (failures) { console.error(`V204 FAILED: ${failures}`); process.exit(1); }
console.log('V204 ALL PASSED');
