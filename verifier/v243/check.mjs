// 验证器 v243: 对称滑条圆弧 (P) 源先转贝塞尔。
// 需求: 使用对称滑条时, 如果当前所选滑条是圆弧滑条, 需要转成贝塞尔, 否则滑条形状不一致。
// 实现 (src/osu/convert/symSlider.ts computeSymSlider): curveType='P' 时先 sliderToBezierSegments
//   +segmentsToPoints 展开为贝塞尔节点 (v237 误差驱动减点, ≤0.2px), workType='B' 参与变换/拼接;
//   join='none' 副本 curveType 用 workType (随转换变 'B'), length 按 workType 几何重算。
// 行为断言 (esbuild 打包 tests.ts, 仿 v236): 副本/拼接 curveType、几何一致性采样、时长、L/B 源不受影响。
// 运行: node verifier/v243/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v243/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v243/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 行为断言 (内部自报 V243_TESTS_*)
fs.unlinkSync(out);

section('symSlider.ts: P→B 转换源码断言');
{
  const src = readSrc('src/osu/convert/symSlider.ts');
  assert(/import \{ segmentsToPoints, sliderToBezierSegments \} from '\.\/bezierPath'/.test(src), '导入 bezierPath 转换工具');
  assert(/if \(o\.curveType === 'P'\)/.test(src)
    && /segmentsToPoints\(sliderToBezierSegments\(o\)\)/.test(src)
    && /workType = 'B'/.test(src), 'P 源展开为贝塞尔节点, workType = B');
  assert(/curveType: workType,/.test(src), 'join=none 副本 curveType 用 workType');
  assert(/sliderGeometryLength\(workType, pts\)/.test(src), '副本 length 按 workType 几何重算');
  assert(/v243:/.test(src), 'v243 注释');
}

if (failures) { console.error(`\nV243_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV243_ALL_PASSED');
