// 验证器 v53: 上方时间轴药丸 (lazer 红 BPM / 绿 SV / 粉采样标签)
// 运行: cd app && node verifier/v53/check.mjs; node verifier/v53/cdp-v53.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v53/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v53/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('timelinePills.ts: 导出与 lazer 常量');
{
  const src = readSrc('src/osu/timelinePills.ts');
  assert(/export function bpmPillText/.test(src) && /60000 \/ beatLength\)\.toFixed\(1\)\} BPM/.test(src), 'bpmPillText: {60000/bl:n1} BPM');
  assert(/export function svPillText/.test(src) && /sv\.toFixed\(2\)\}x/.test(src), 'svPillText: {sv:n2}x');
  assert(/-100 \/ tp\.beatLength/.test(src), 'SV = -100/beatLength (legacy 绿线)');
  assert(/export function svPoints/.test(src), 'svPoints (v61: 全部绿线出 SV 药丸, lazer 无去重)');
  assert(/export function samplePill/.test(src), 'samplePill');
  assert(/PILL_RED = '#eb4747'/.test(src) && /PILL_LIME = '#b2ff66'/.test(src), 'lazer Red2/Lime1');
  assert(/PILL_PINK = '#ff66ab'/.test(src) && /PILL_PINK_ALT = '#eb4791'/.test(src) && /PILL_TEXT = '#222a28'/.test(src), 'lazer Pink1/Pink2/B5');
  assert(/export function pillLayout/.test(src), 'pillLayout (过密收缩为点)');
}

section('Timelines.tsx: 药丸绘制接线');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/from '@\/osu\/timelinePills'/.test(src), '引入 timelinePills');
  assert(/bpmPillText\(tp\.beatLength\), PILL_RED/.test(src), '红线 -> BPM 红药丸');
  assert(/svPillText\(p\.sv\), PILL_LIME/.test(src), '变速绿线 -> SV 绿药丸');
  assert(/samplePill\(bm, o\)/.test(src) && /PILL_PINK_ALT : PILL_PINK|PILL_PINK\b/.test(src), '物件 -> 粉药丸 (slider= Pink2)');
  assert(/pillLayout\(items\)/.test(src), '过密收缩 pillLayout');
  assert(/roundRect\(p\.x - p\.w \/ 2, 50, p\.w, 14, 7\)/.test(src), '粉药丸挂头圆下方 (y=50, h=14)');
  assert(/roundRect\(px - w \/ 2, py, w, 13, 6\.5\)/.test(src), 'timing 药丸胶囊 (h=13)');
}

if (failures) { console.error(`\nVERIFIER_V53_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V53_ALL_TESTS_PASSED');
