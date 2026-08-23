// 验证器 v52: 显示用选中框 = 路径实体盒 (lazer blueprint SelectionQuad union + INFLATE 5)
// 运行: cd app && node verifier/v52/check.mjs; node verifier/v52/cdp-v52.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v52/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v52/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('selectionBox.ts: selectionDisplayQuad 路径实体盒');
{
  const src = readSrc('src/osu/selectionBox.ts');
  assert(/export const SELECTION_BOX_INFLATE = 5/.test(src), 'SELECTION_BOX_INFLATE = 5 (lazer INFLATE_SIZE)');
  assert(/export function selectionDisplayQuad\(bm: Beatmap, objs: HitObject\[\], radius: number\)/.test(src), '导出 selectionDisplayQuad');
  assert(/const path = getSliderPath\(bm, o\)/.test(src), '滑条用 getSliderPath(bm, o) (渲染同一条中心线)');
  assert(/for \(const p of path\.points\) add\(p\)/.test(src), '取路径采样折线包围盒 (包弧身鼓出)');
  assert(/radius \+ SELECTION_BOX_INFLATE/.test(src), '外扩 = 圆圈半径 + 5');
  assert(/import \{ SliderPath, getSliderPath, sliderGeometryLength, resnapSliderLength \} from '\.\/sliderPath'/.test(src), '引入 getSliderPath');
}

section('EditorCanvas.tsx: 显示框/手柄用 selectionDisplayQuad, 缩放参考盒不变');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/selectionDisplayQuad\(bm, objs, csToRadius\(bm\.difficulty\.cs\)\)/.test(src), 'currentQuads 显示盒 = selectionDisplayQuad(bm, objs, csToRadius(...))');
  assert(/selectionScaleQuad\(objs\)/.test(src), '缩放数学参考盒仍是 selectionScaleQuad (OriginalSurroundingQuad)');
  assert(!/displayQuad\(/.test(src), '不再用旧 displayQuad (控制点盒±半径)');
}

if (failures) { console.error(`\nVERIFIER_V52_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V52_ALL_TESTS_PASSED');
