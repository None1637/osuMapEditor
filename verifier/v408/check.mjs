// 验证器 v408: 复制选中滑条锚点 (相对首锚点偏移的锚点剪贴板) + 粘贴优先分支
//   v490 适配: 粘贴语义从「插进选中滑条」改为「在光标处创建使用这些锚点的新滑条」(pasteNodesAsNewSlider);
//   insertAnchorGroup 纯函数保留 (tests.ts 单测不受影响)
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
  // paste: 锚点优先分支 (v490 适配: 插入当前滑条 → 创建新滑条)
  const paste = src.match(/  paste\(atTime: number\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(/this\.nodeClipboard\?\.length && this\.pasteNodesAsNewSlider\(atTime\)/.test(paste), 'paste: 锚点粘贴优先 (v490 新滑条)');
  // pasteNodesAsNewSlider 要点 (v490)
  const fn = src.match(/private pasteNodesAsNewSlider\(atTime: number\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert(/clip\.length < 2 \|\| !this\.cursorOsu\) return false;/.test(fn), '守卫: ≥2 锚点 + 光标已知 (无选中滑条要求)');
  assert(/genId\(\), type: 'slider'/.test(fn) && /curvePoints: pts\.slice\(1\), slides: 1/.test(fn), '创建新滑条对象');
  assert(/snapPlacementTime\(bm\.timingPoints, atTime, this\.beatSnap\)/.test(fn), '时间吸附同物件粘贴 (v357/v380)');
  assert(/resolveSliderCurveType\(pts, 'L'\)/.test(fn), 'curveType 重解析');
  assert(/resnapSliderLength\(bm, o, this\.beatSnap\)/.test(fn) && /invalidatePath\(o\.id\)/.test(fn), '长度重吸附 + 缓存失效');
  assert(/this\.pushUndo\(\)/.test(fn), '一次 undo');
  assert(/this\.selected\.add\(o\.id\)/.test(fn), '粘贴后选中新滑条');
  assert(!/pasteNodesIntoSlider/.test(src), '旧插入函数已移除');
}

section('EditorCanvas.tsx: 光标追踪');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/store\.cursorOsu = out; \/\/ v408/.test(src), 'toOsu 写 cursorOsu');
}

if (failures) { console.error(`V408 FAILED (${failures})`); process.exit(1); }
console.log('V408 ALL PASSED');
