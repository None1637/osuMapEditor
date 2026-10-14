// 验证器 v412: 直线手绘滑条落 'L' 而非 'B4'
// 根因: finishFreehandSlider 非单弧一律落 'B4'; 直线拖动因共线让 tryCircleArc 圆弧拟合失败
//   (circularArcProperties 退化 invalid), singleArc=false — 直线滑条被标记 B4, 还触发 B4 警告条。
// 修复: freehandFit.ts 新增 collinearLinePoints (中间点到首尾连线垂直距离 ≤3 osu px 判定共线);
//   finishFreehandSlider 无红锚点分段且共线时折叠为 头+尾 落 'L' (有红锚点的共线多段不折叠, 分段语义保留)。
// 运行: cd app && node verifier/v412/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v412/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v412/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('freehandFit.ts: collinearLinePoints');
{
  const src = readSrc('src/osu/freehand/freehandFit.ts');
  assert(/v412: 控制点列近似共线判定/.test(src), 'v412 版本注释');
  assert(/export function collinearLinePoints\(ctrl: Vec\[\], tol = 3\): Vec\[\] \| null/.test(src), '函数签名 (默认容差 3 osu px)');
  assert(/if \(d > tol\) return null;/.test(src), '超容差 → null');
  assert(/return \[\{ x: a\.x, y: a\.y \}, \{ x: b\.x, y: b\.y \}\];/.test(src), '共线 → [首,尾]');
}

section('EditorCanvas.tsx: finishFreehandSlider 共线折叠落 L');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/v412: 直线手绘例外/.test(src), 'v412 版本注释');
  assert(/const noRed = !points\.some\(p => p\.red\);/.test(src), '红锚点分段守卫 (分段语义保留)');
  assert(/const linePts = noRed \? collinearLinePoints\(ctrl\) : null;/.test(src), '无红锚点才尝试共线折叠');
  assert(/const curveType = singleP \? 'P' : linePts \? 'L' : 'B4';/.test(src), "落盘类型: 单弧 P / 共线 L / 否则 B4");
  assert(/const finalPts = linePts \?\? ctrl;/.test(src), '折叠后控制点 = 头+尾');
  assert(/import \{ fitSegmentsToPoints, collinearLinePoints \} from '@\/osu\/freehand\/freehandFit'/.test(src), '已导入 collinearLinePoints');
  // 单弧 P 与 B4 路径不受影响
  assert(/const singleP = singleArc && ctrl\.length === 3;/.test(src), '单弧 P 判定保留');
}

if (failures) { console.error(`V412 FAILED (${failures})`); process.exit(1); }
console.log('V412 ALL PASSED');
