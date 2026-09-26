// 验证器 v285: 节拍吸附补上 lazer 跨红线就近规则
// 依据: lazer ControlPointInfo.GetClosestSnappedTime (无 referenceTime 分支) —
//   snapped = 就近 tick; 若 TimingPointAfter(time) 存在且不比就近 tick 更远 (等距取红线),
//   则吸附到下一条红线起点。滑条长度吸附带 referenceTime = 滑条头, 不适用本规则 (不改动)。
// 触点: snapPlacementTime (sliderPath.ts) / snapBeatTime (polygon.ts) / snapMs (Timelines.tsx)
//   / snapTime (EditorCanvas.tsx) / timingResnap (store.ts, 包 snapTimeToRedBeat)
// 运行: node verifier/v285/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v285/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v285/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V285_TESTS_*)
fs.unlinkSync(out);

const parser = readSrc('src/osu/parser.ts');
assert(/export function nextRedAfter/.test(parser), 'parser: nextRedAfter (lazer TimingPointAfter)');
assert(/export function snapAcrossRedLine/.test(parser), 'parser: snapAcrossRedLine (跨红线就近规则)');
assert(/Math\.abs\(time - snapped\) >= Math\.abs\(time - next\.time\)/.test(parser), '等距取红线起点 (lazer < 三元语义)');

const sp = readSrc('src/osu/sliderPath.ts');
assert(/snapPlacementTime[\s\S]*?return snapAcrossRedLine\(points, currentTime, snapped\)/.test(sp), '放置时间吸附接入规则');
// 长度吸附 (lazer 带 referenceTime) 不适用: snapSliderLength/placementLength 不得出现 snapAcrossRedLine
const lenFns = sp.match(/function snapSliderLength[\s\S]*?\n\}/)?.[0] ?? '';
assert(!/snapAcrossRedLine/.test(lenFns), '滑条长度吸附不适用跨红线规则 (lazer referenceTime 分支)');

assert(/snapBeatTime[\s\S]*?return snapAcrossRedLine\(points, time, snapped\)/.test(readSrc('src/osu/convert/polygon.ts')), '多边形吸附接入规则');
assert(/snapAcrossRedLine\(bm\.timingPoints, t, snapped\)/.test(readSrc('src/components/Timelines.tsx')), '时间轴 snapMs 接入规则');
assert(/snapAcrossRedLine\(bm\.timingPoints, t, snapped\)/.test(readSrc('src/components/EditorCanvas.tsx')), '画布 snapTime 接入规则');
assert(/snapAcrossRedLine\(bm\.timingPoints, o\.time, snapTimeToRedBeat/.test(readSrc('src/osu/store.ts')), 'resnap 接入规则');

if (failures) { console.error(`\nV285_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV285_ALL_PASSED');
