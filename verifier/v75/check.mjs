// 验证器 v75: 落盘弧段贝塞尔锚点转换 + Ctrl+G 反转 (lazer 对齐)
// 运行: cd app && node verifier/v75/check.mjs; node verifier/v75/cdp-v75.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v75/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v75/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('sliderPath.ts: preserveArcsForBezier (lazer ConvertCircleToBezierAnchors 接线)');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/export function preserveArcsForBezier\(curveType: string, controlPoints: Vec2\[\]\)/.test(src), 'preserveArcsForBezier 导出');
  assert(/if \(curveType !== 'B'\) return controlPoints/.test(src), "仅 'B' 处理");
  assert(/convertCircleToBezierAnchors\(segments\[i\]\)/.test(src), '3 点段走圆预设贝塞尔锚点转换');
  assert(/segments\[i\]\.length === 3 \? convertCircleToBezierAnchors/.test(src), '仅恰 3 点段转换');
  assert(/import \{ convertCircleToBezierAnchors \} from '\.\/freehand\/freehandFit'/.test(src), '复用 v73 移植的转换函数');
}

section('EditorCanvas.tsx: finishSlider 落盘前锚点转换');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/preserveArcsForBezier\(computed\.curveType, computed\.controlPoints\)/.test(src), 'finishSlider 落盘控制点经 preserveArcsForBezier');
  assert(/preserveArcsForBezier/.test(src.split('\n')[4]), 'import 接入');
}

section('reverse.ts: lazer HandleReverse + SliderPathExtensions.Reverse 对齐');
{
  const src = readSrc('src/osu/reverse.ts');
  assert(/export function reverseSlider\(o: HitObject\)/.test(src), 'reverseSlider 导出');
  assert(/export function reverseSelection\(bm: Beatmap, objs: HitObject\[\]\)/.test(src), 'reverseSelection 导出');
  assert(/path\.positionAt\(length\)/.test(src), '新头 = PositionAt(length) 真尾端');
  assert(/positionAt\(length \/ 2\)/.test(src), "截断 'P' 重算中点保形");
  assert(/dropTrailingSegments/.test(src), '截断滑条丢尾端整段');
  assert(/edgeSoundsRaw\.split\('\|'\)\.reverse\(\)/.test(src) && /edgeSetsRaw\.split\('\|'\)\.reverse\(\)/.test(src), 'edgeSounds/edgeSets 按端点反转');
  assert(/newComboOrder/.test(src) && /endTime - \(ends\[i\] - startTime\)/.test(src), '时间镜像 + newCombo 时序保持 (lazer HandleReverse)');
}

section('store.ts: reverseSelected (一次 undo + invalidate + 重排序)');
{
  const src = readSrc('src/osu/store.ts');
  assert(/reverseSelected\(\) \{/.test(src), 'reverseSelected 方法');
  assert(/objs\.length === 1 && objs\[0\]\.type !== 'slider'\) return/.test(src), 'lazer CanReverse: >1 或任一滑条');
  assert(/reverseSelection\(bm, objs\)\) invalidatePath/.test(src), '反转后 invalidate 滑条路径缓存');
  assert(/hitObjects\.sort\(\(a, b\) => a\.time - b\.time\)/.test(src), '时间镜像后重排序');
  assert(/import \{ reverseSelection \} from '\.\/reverse'/.test(src), 'import 接入');
}

section('App.tsx: lazer 键位 (Ctrl+G 反转 / Ctrl+,. 旋转)');
{
  const src = readSrc('src/App.tsx');
  assert(/e\.key\.toLowerCase\(\) === 'g'\) \{ e\.preventDefault\(\); store\.reverseSelected\(\)/.test(src), 'Ctrl+G => reverseSelected (lazer)');
  assert(/e\.key === ','\) \{ e\.preventDefault\(\); store\.rotateSelected\(-90, 'playfield'\)/.test(src), 'Ctrl+, => 逆时针 90° (lazer; v192 游玩区中心)');
  assert(/e\.key === '\.'\) \{ e\.preventDefault\(\); store\.rotateSelected\(90, 'playfield'\)/.test(src), 'Ctrl+. => 顺时针 90° (lazer; v192 游玩区中心)');
  assert(!/e\.key\.toLowerCase\(\) === 'g'\).*rotateSelected/.test(src), 'Ctrl+G 不再绑定旋转');
}

section('Inspector.tsx: 快捷键提示文本同步');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(/Ctrl\+G 反转/.test(src) && /Ctrl\+,\/\./.test(src), '提示文本: Ctrl+G 反转 + Ctrl+,/. 旋转');
}

if (failures) { console.error(`\nVERIFIER_V75_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V75_ALL_PASSED');
