// 验证器 v30: 拖控制点经过时间轴不触发 seek + 四种模式右键删除物件
// 运行: cd app && node verifier/v30/check.mjs; node verifier/v30/cdp-rightclick.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts');
{
  const src = readSrc('src/osu/store.ts');
  assert(/canvasDragging = false/.test(src), 'canvasDragging 非响应式标志');
}

section('EditorCanvas.tsx: 拖拽标志 + 通用右键删除');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  const setCount = (src.match(/store\.canvasDragging = true/g) || []).length;
  assert(setCount >= 3, `拖拽入口置标志 >=3 (节点/物件/框选; v34 新增自定义原点拖拽, 实际 ${setCount})`);
  assert(/window\.addEventListener\('mouseup'/.test(src) && !/onMouseUp = \(\) => \{\s*store\.canvasDragging = false/.test(src),
    '标志仅由 window mouseup 清除 (onMouseLeave 调 onMouseUp 时不能清)');
  assert(/onContextMenu[\s\S]*?hitTest\(p\.x, p\.y\)[\s\S]*?filter\(o => o\.id !== hit\.id\)[\s\S]*?store\.emit\(\)/.test(src),
    '四模式通用: 右键命中物件 -> 删除 + undo + emit');
  assert(/else if \(store\.tool === 'slider' && store\.pendingSlider\.length\)/.test(src),
    '滑条放置中右键仍优先完成放置');
}

section('Timelines.tsx: 拖拽经过守卫');
{
  const src = readSrc('src/components/Timelines.tsx');
  const guards = (src.match(/store\.canvasDragging/g) || []).length;
  assert(guards >= 4, `上/下时间轴 mousedown+mousemove 均有守卫 (实际 ${guards} 处)`);
}

if (failures) { console.error(`\nVERIFIER_V30_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V30_ALL_TESTS_PASSED');
