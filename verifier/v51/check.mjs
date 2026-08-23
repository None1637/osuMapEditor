// 验证器 v51: moveSelectionInBounds 改用头+滑条尾包围盒 (lazer GetSurroundingQuad(keys, startAndEndOnly: true))
// 运行: cd app && node verifier/v51/check.mjs; node verifier/v51/cdp-v51.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v51/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v51/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('selectionBox.ts: 越界移回用头+滑条尾盒 (lazer startAndEndOnly)');
{
  const src = readSrc('src/osu/selectionBox.ts');
  assert(/export function selectionStartEndQuad/.test(src), '导出 selectionStartEndQuad');
  assert(/import \{ SliderPath, getSliderPath, sliderGeometryLength, resnapSliderLength \} from '\.\/sliderPath'/.test(src), '引入 SliderPath (算路径末端; v52 增 getSliderPath)');
  assert(/new SliderPath\(o\.curveType \?\? 'L'/.test(src), '路径末端用当前几何新建 SliderPath (不用上一帧缓存)');
  assert(/path\.positionAt\(o\.length \?\? path\.totalLength\)/.test(src), '末端 = PositionAt(1) (lazer h.Position + path.PositionAt(1))');
  assert(/const nq = selectionStartEndQuad\(movable\)/.test(src), 'moveSelectionInBounds 用 selectionStartEndQuad');
  assert(!/const nq = selectionScaleQuad\(movable\)/.test(src), '不再用全控制点盒判越界 (v51 修复点)');
}

if (failures) { console.error(`\nVERIFIER_V51_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V51_ALL_TESTS_PASSED');
