// 验证器 v373: 手动改网格间距后, 撤销/重做/刷新谱面时间距值回复 —
//   gridSpacing 是 store 级覆盖值 (null = 跟随谱面 editor.gridSize), 不入 undo 快照;
//   修复: store.load() 与 store.restore() (undo/redo 共用) 重置 gridSpacing = null,
//   使显示 (GridSpacingInput committed) 与网格吸附/绘制都跟随恢复出的 GridSize。
// 运行: node verifier/v373/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('store.ts: load / restore 重置 gridSpacing');
{
  const src = read('src/osu/store.ts');
  // load(): 载入/刷新谱面时清覆盖 (紧跟 v371 清空 Alt 点选滑条之后)
  assert(/this\.altPickSliders = new Set\(\); \/\/ v371[^\n]*\n\s*this\.gridSpacing = null; \/\/ v373/.test(src),
    'load() 重置 gridSpacing = null (换谱/刷新间距跟随新谱面 GridSize)');
  // restore(): undo/redo 共用, 恢复快照段后清覆盖
  assert(/bm\.rawSections = deepCopy\(s\.rawSections \?\? \{\}\); \/\/ v209\n\s*this\.gridSpacing = null; \/\/ v373/.test(src),
    'restore() 重置 gridSpacing = null (撤销/重做间距跟随恢复出的 editor.gridSize)');
  // 覆盖值本身仍是 null 初始 + ?? 回退结构不变 (v56 契约)
  assert(/gridSpacing: number \| null = null;/.test(src), 'gridSpacing 字段仍为 null 初始 (跟随谱面)');
}

section('App.tsx: GridSpacingInput 结构回归 (仍双写 + 入 undo)');
{
  const src = read('src/App.tsx');
  assert(/const committed = store\.gridSpacing \?\? store\.beatmap\?\.editor\.gridSize \?\? 4;/.test(src),
    'committed 仍取 gridSpacing ?? editor.gridSize (覆盖清除后即回复谱面值)');
  assert(/store\.gridSpacing = v;[\s\S]{0,120}store\.setEditorField\('gridSize', v\)/.test(src),
    'onChange 仍双写 gridSpacing + setEditorField (v345 起 gridSize 入 undo)');
}

section('EditorCanvas.tsx: 网格间距消费方回归 (?? 回退不变)');
{
  const src = read('src/components/EditorCanvas.tsx');
  const n = (src.match(/store\.gridSpacing \?\? bm\.editor\.gridSize/g) || []).length;
  assert(n === 3, `网格吸附/绘制共 3 处走 gridSpacing ?? bm.editor.gridSize (实际 ${n})`);
}

if (failures) { console.error(`V373 FAILED: ${failures}`); process.exit(1); }
console.log('V373 ALL PASSED');
