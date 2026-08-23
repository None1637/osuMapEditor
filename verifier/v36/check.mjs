// 验证器 v36: F1 滑条转连打 (可拖参数窗口 + 参数持久化 + 实时预览)
// 依据: lazer SliderSelectionBlueprint.convertToStream (SliderSelectionBlueprint.cs:566)
// 运行: cd app && node verifier/v36/check.mjs; node verifier/v36/cdp-stream.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v36/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v36/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('store.ts: 转换预览/应用机制');
{
  const src = readSrc('src/osu/store.ts');
  assert(/conversionDialog: 'stream' \| 'split' \| 'merge'( \| 'polygon')?( \| 'duplicate')? \| null/.test(src), 'conversionDialog 字段 (v141: curve 项随曲线互转废弃移除)');
  assert(src.includes('conversionPreview'), 'conversionPreview 字段');
  assert(/setConversionPreview[\s\S]{0,220}emitSelection\(\)/.test(src), '预览走 emitSelection (不重建事件表)');
  assert(/applyConversion[\s\S]*?pushUndo\(\)[\s\S]*?sort\(\(a, b\) => a\.time - b\.time\)/.test(src), '应用转换: 一次 undo + 重排序');
}

section('EditorCanvas.tsx: 预览渲染 (源隐藏 + 结果 WYSIWYG)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/bmView = mergedWithPreview\(bm, convPrev\)/.test(src), '源物件预览期隐藏 (v44 合并视图)');
  assert(/computeCombos\(bmView\)/.test(src) && !src.includes('pbm = { ...bm'), '预览单趟渲染 (v44: 无二次 renderPlayfield)');
}

section('DraggableDialog.tsx: 可拖窗口 + 参数持久化');
{
  const src = readSrc('src/components/DraggableDialog.tsx');
  assert(src.includes('cursor-move') && src.includes('setPointerCapture'), '标题栏拖拽');
  assert(src.includes("localStorage.getItem('osu-editor:conv:'") && src.includes('localStorage.setItem'), 'localStorage 参数持久化');
}

section('StreamDialog/Inspector/App: 接线');
{
  const dlg = readSrc('src/components/convert/StreamDialog.tsx');
  assert(dlg.includes("loadParams('stream'") && dlg.includes("saveParams('stream'"), '参数加载/保存');
  assert(dlg.includes('store.setConversionPreview') && dlg.includes('store.applyConversion'), '预览/应用接线');
  const insp = readSrc('src/components/Inspector.tsx');
  assert(insp.includes('store.openConversion(\'stream\')'), 'Inspector 转连打按钮');
  const app = readSrc('src/App.tsx');
  assert(app.includes("store.conversionDialog === 'stream'") && app.includes('<StreamDialog'), 'App 挂载 StreamDialog');
}

if (failures) { console.error(`\nVERIFIER_V36_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V36_ALL_TESTS_PASSED');
