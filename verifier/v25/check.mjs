// 验证器 v25: 已建滑条的节点编辑 (插入节点 / 右键删除 / 点击切换白红)
// 运行: cd app && node verifier/v25/check.mjs; node verifier/v25/cdp-nodes.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v25/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v25/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// 纯函数测试 (插入/删除/切换/curveType 解析)
await import('file://' + out);
fs.unlinkSync(out);

// ---- 源码接线断言 ----
section('sliderPath.ts: 节点编辑纯函数');
{
  const src = readSrc('src/osu/sliderPath.ts');
  for (const f of ['nearestOnSegment', 'insertSliderPoint', 'deleteSliderPoint', 'toggleSliderPointRed', 'resolveSliderCurveType'])
    assert(src.includes(`export function ${f}`), `导出 ${f}`);
  assert(/deleteSliderPoint[\s\S]*?pts\.length - count < 2/.test(src), '删除两点下限保护');
  assert(/resolveSliderCurveType[\s\S]*?hasRedPair\(pts\) \? 'B'|hasRedPair\(pts\)\) return 'B'/.test(src), '红点存在 -> curveType B');
}

section('EditorCanvas.tsx: 三种操作接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(src.includes('insertSliderPoint') && src.includes('nearestOnSegment'), '连接线段点击插入节点接线');
  assert(/store\.pushUndo\(\); \/\/ 一次操作一次 undo[\s\S]*?insertSliderPoint|insertSliderPoint\(ctrl, best, bestT\)/.test(src), '插入节点一次 undo + 写回');
  assert(src.includes('deleteSliderPoint'), '右键删除节点接线');
  assert(/onContextMenu[\s\S]*?deleteSliderPoint/.test(src), 'contextmenu 删除节点 + preventDefault');
  assert(src.includes('toggleSliderPointRed'), '点击手柄切换白/红接线');
  assert(src.includes('nd.moved') && src.includes('<= 4'), '点击/拖拽 4px 阈值区分');
  assert(src.includes('applySliderPoints') && src.includes('resolveSliderCurveType'), '写回含 curveType 解析');
  assert(/applySliderPoints\(so, next\);[\s\S]*?invalidatePath\(so\.id\);[\s\S]*?store\.emit\(\)/.test(src)
    || /applySliderPoints\(so, insertSliderPoint[\s\S]*?invalidatePath\(so\.id\)/.test(src), '操作后 invalidatePath + emit (dataVersion)');
  assert(/toggleSliderPointRed[\s\S]*?store\.undo\(\)/.test(src) || src.includes('弹出 mousedown 压入的空快照'), '不可切换时弹出空快照');
}

if (failures) { console.error(`\nVERIFIER_V25_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V25_ALL_TESTS_PASSED');
