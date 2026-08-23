// 验证器 v149: 锁定间距 ① 滑条拉长填满控件宽度 ② 上限 3x -> 10x ③ 间距与当前 SV 挂钩
//   (lazer EditorBeatmap.DurationToDistance: distance = 100 * SliderMultiplier * SV * 拍数, 参考时刻 = 前件结束时刻)
// 运行: node verifier/v149/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v149/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v149/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V149_TESTS_*)
fs.unlinkSync(out);

section('spacing.ts: 1x 基准含 SM*SV (lazer DurationToDistance)');
{
  const src = readSrc('src/osu/spacing.ts');
  assert(/import \{ timingAt, svPointAt \} from '.\/parser';/.test(src), '导入 svPointAt');
  assert(/function distanceSnapPxPerBeat\(bm: Beatmap, refTime: number\)/.test(src), 'distanceSnapPxPerBeat 共享基准函数');
  assert(/return bm\.editor\.distanceSpacing \* 100 \* bm\.difficulty\.sliderMultiplier \* sv;/.test(src), '基准 = DS * 100 * SM * SV');
  assert(/return distPx \/ \(distanceSnapPxPerBeat\(bm, fromEndTime\) \* beats\);/.test(src), 'spacingMultiplier 用共享基准 (面板与放置同单位)');
  assert(/const \{ red \} = timingAt\(bm\.timingPoints, endTime\);/.test(src), 'distanceLockDistance 拍长按参考时刻 (前件结束时刻, lazer referenceTime)');
  assert(/Math\.max\(0, \(time - endTime\) \/ red\.beatLength\)/.test(src), '拍数下限 0 (v211: 移除 v145 的 0.25 下限)');
  assert(!src.includes('bm.editor.distanceSpacing * 100 * beats'), '旧无 SV 公式已移除');
}

section('App.tsx: 锁定间距控件 (拉长 + 上限 10x)');
{
  const src = readSrc('src/App.tsx');
  const i = src.indexOf('data-ds-input="range"');
  const blk = src.slice(src.lastIndexOf('<label', i), src.indexOf('</label>', i));
  assert(/min=\{0\.1\} max=\{10\} step=\{0\.05\}/.test(blk), 'range min 0.1 max 10 step 0.05');
  assert(/className="flex-1 min-w-0 accent-cyan-400"/.test(blk), '滑条 flex-1 拉满剩余宽度 (原 w-16)');
  assert(/w-full flex items-center/.test(blk), 'label 占满控件宽度');
  assert(/Math\.max\(0\.1, Math\.min\(10, v\)\)/.test(blk), '数字输入钳制 0.1..10');
  assert(/w-14 shrink-0/.test(blk), '输入框固定宽不压缩');
  assert(!blk.includes('max={3}') && !blk.includes('Math.min(3,'), '旧 3x 上限已移除');
}

if (failures) { console.error(`\nV149_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV149_ALL_PASSED');
