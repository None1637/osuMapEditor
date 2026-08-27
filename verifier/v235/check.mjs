// 验证器 v235: 吸附到物件总开关 (默认开启)。
// 需求: 左侧栏「网格中心」按钮下方加开关, 控制所有吸附到物件上的行为, 默认开启。
// 实现: store.objectSnapEnabled = true + setObjectSnapEnabled; EditorCanvas 四处拦截 —
//   snapWithGeo (物件点/几何/间距辅助线吸附总入口), geoSnap/geoDistSnap (拖拽修正回调直连),
//   snapDragDelta 调用处 (物件拖拽整体校正); App.tsx 「吸附到物件」按钮 (Target 图标, 网格中心区块之后)。
// 运行: node verifier/v235/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

console.log('== store.ts: 开关字段 (默认开) + setter');
{
  const src = readSrc('src/osu/store.ts');
  assert(/objectSnapEnabled = true;/.test(src), 'objectSnapEnabled 默认 true');
  assert(/setObjectSnapEnabled\(b: boolean\) \{ this\.objectSnapEnabled = b; this\.emitSelection\(\); \}/.test(src), 'setObjectSnapEnabled setter');
}

console.log('== EditorCanvas.tsx: 四处吸附拦截');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/const snapWithGeo = \([^\n]+\): Pt \| null => \{\s*if \(!store\.objectSnapEnabled\) return null;/.test(src), 'snapWithGeo 入口拦截 (物件点+几何+间距辅助线)');
  assert(/const geoSnap = \([^\n]+\): Pt \| null => \{\s*if \(!store\.objectSnapEnabled\) return null;/.test(src), 'geoSnap 入口拦截 (拖拽几何修正)');
  assert(/const geoDistSnap = \([^\n]+\): Pt \| null => \{\s*if \(!store\.objectSnapEnabled\) return null;/.test(src), 'geoDistSnap 入口拦截 (拖拽间距辅助线修正)');
  assert(/const corr = store\.objectSnapEnabled \? snapDragDelta\(dragPts, targets, dx, dy\) : null;/.test(src), 'snapDragDelta 拖拽整体校正拦截');
}

console.log('== App.tsx: 左侧栏按钮 (网格中心区块之后)');
{
  const src = readSrc('src/App.tsx');
  assert(/setObjectSnapEnabled\(!store\.objectSnapEnabled\)/.test(src) && /data-grid-input="object-snap-toggle"/.test(src), '吸附到物件按钮接线');
  assert(/<Target className="inline-block w-4 h-4 mr-1 -mt-0\.5" \/>吸附到物件/.test(src), '按钮文案 + Target 图标 (lucide)');
  assert(/from 'lucide-react';/.test(src) && /Move, Target/.test(src), 'Target 已导入');
  const iOrigin = src.indexOf('网格中心');
  const iBtn = src.indexOf('吸附到物件');
  assert(iOrigin >= 0 && iBtn > iOrigin, '按钮位于网格中心之后');
}

if (failures) { console.error(`\nV235_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV235_ALL_PASSED');
