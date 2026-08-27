// 验证器 v76: 放置预览幻影尾点手柄 + 节点拖拽物件/网格吸附
// 运行: cd app && node verifier/v76/check.mjs; node verifier/v76/cdp-v76.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v76/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v76/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('sliderPath.ts: pendingPhantomPoint 导出 + computePendingPath 共用');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/export function pendingPhantomPoint\(pend: Vec2\[\], cursor: Vec2 \| null\)/.test(src), 'pendingPhantomPoint 导出');
  assert(/const phantom = pendingPhantomPoint\(pend, cursor\)/.test(src), 'computePendingPath 复用同一幻影点判定');
}

section('renderer.ts: 幻影尾点画手柄 + 接入连线');
{
  const src = readSrc('src/osu/renderer.ts');
  const fnStart = src.indexOf('function drawPendingSlider');
  const fnEnd = src.indexOf('// 选中滑条的外形描边');
  const body = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : '';
  assert(/pendingPhantomPoint\(pend, cursor\)/.test(body), 'drawPendingSlider 计算幻影尾点');
  assert(/phantom \? \[\.\.\.pend, phantom\] : pend/.test(body), '幻影点接入控制点连线');
  // v231 适配: 手柄绘制抽入 drawControlPointHandle (stable 方格/lazer 圆点分支), 幻影尾点 (白, 非头) 行为不变
  assert(/drawControlPointHandle\(g, phantom\.x, phantom\.y, false, false\)/.test(body), '幻影尾点画白色手柄 (v231: 经 drawControlPointHandle)');
}

section('EditorCanvas.tsx: 节点拖拽物件吸附 + 网格吸附');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  const ndStart = src.indexOf('const nd = nodeDragRef.current;');
  const ndEnd = src.indexOf('const d = dragRef.current;', ndStart);
  const body = ndStart >= 0 && ndEnd > ndStart ? src.slice(ndStart, ndEnd) : '';
  assert(/snapToNearby\(p, objectSnapPoints/.test(body), '节点拖拽物件吸附');
  assert(/x\.id !== nd\.objId/.test(body), '吸附目标排除被编辑滑条自身');
  assert(/gridSnapAt\(bm, near \?\? p\)/.test(body), '网格吸附最后应用并覆盖 (与放置同款)');
  assert(/const sp = gridSnapAt/.test(body) && /Math\.round\(sp\.x\), ny = Math\.round\(sp\.y\)/.test(body), '拖拽写入吸附后坐标');
}

if (failures) { console.error(`\nVERIFIER_V76_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V76_ALL_PASSED');
