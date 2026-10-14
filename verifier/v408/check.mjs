// 验证器 v408: 复制选中滑条锚点, Ctrl+V 按加点规则插入选中滑条
// 运行: cd app && node verifier/v408/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v408/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v408/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('sliderPath.ts: insertAnchorGroup');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/v408: 锚点粘贴/.test(src), 'v408 版本注释');
  assert(/export function insertAnchorGroup\(points: Vec2\[\], segIdx: number, group: Vec2\[\]\)/.test(src), '函数签名');
}

section('store.ts: 锚点剪贴板 + copy/paste 分支');
{
  const src = readSrc('src/osu/store.ts');
  assert(/private nodeClipboard: \{ x: number; y: number \}\[\] \| null = null;/.test(src), 'nodeClipboard 字段');
  assert(/cursorOsu: \{ x: number; y: number \} \| null = null;/.test(src), 'cursorOsu 字段');
  // copy: 节点选区优先, 相对首锚点偏移
  const copy = src.match(/  copy\(\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(/v408/.test(copy) && /this\.selectedNodes\.size/.test(copy), 'copy: 节点选区分支');
  assert(/idxs\.map\(i => \(\{ x: ctrl\[i\]\.x - base\.x, y: ctrl\[i\]\.y - base\.y \}\)\)/.test(copy), '相对首锚点偏移');
  assert(/this\.nodeClipboard = null;/.test(copy), '物件复制清空锚点剪贴板');
  // paste: 锚点优先分支
  const paste = src.match(/  paste\(atTime: number\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(/this\.nodeClipboard\?\.length && this\.pasteNodesIntoSlider\(\)/.test(paste), 'paste: 锚点粘贴优先');
  // pasteNodesIntoSlider 要点
  const fn = src.match(/private pasteNodesIntoSlider\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(/this\.selected\.size !== 1 \|\| !this\.cursorOsu\) return false;/.test(fn), '守卫: 单滑条选中 + 光标已知');
  assert(/nearestOnSegment\(a, b, p\)/.test(fn) && /continue; \/\/ 零长红锚点重复对跳过/.test(fn), '段定位同 v319 (跳零长红对)');
  assert(/insertAnchorGroup\(ctrl, best, group\)/.test(fn), '整组插入');
  assert(/resolveSliderCurveType\(newPts, so\.curveType \?\? 'L'\)/.test(fn) && /manualCurveType/.test(fn), 'curveType 保型 (v394 手动改型例外)');
  assert(/resnapSliderLength\(bm, so, this\.beatSnap\)/.test(fn) && /invalidatePath\(so\.id\)/.test(fn), '长度重吸附 + 缓存失效');
  assert(/this\.pushUndo\(\)/.test(fn), '一次 undo');
  assert(/new Set\(group\.map\(\(_, k\) => best \+ 1 \+ k\)\)/.test(fn), '粘贴后选中新插入组');
}

section('EditorCanvas.tsx: 光标追踪');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/store\.cursorOsu = out; \/\/ v408/.test(src), 'toOsu 写 cursorOsu');
}

if (failures) { console.error(`V408 FAILED (${failures})`); process.exit(1); }
console.log('V408 ALL PASSED');
