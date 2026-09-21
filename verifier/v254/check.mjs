// 验证器 v254: 选中包围框 (黄框) 开关 (显示设置)。
// 需求: soulten「增加黃框開關」— 选中物件的黄色包围框 + 缩放/旋转手柄可关闭。
// 实现: displaySettings.selectionBounds (默认 true) + DisplayPanel 开关行
//   + EditorCanvas 选中框整块 (含 v49 黄框/v50 旋转手柄) 门控。
// 运行: node verifier/v254/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const ds = fs.readFileSync(path.join(root, 'src/osu/displaySettings.ts'), 'utf8');
assert(/selectionBounds: boolean/.test(ds), 'displaySettings 有 selectionBounds 项');
assert(/selectionBounds: true,\s*\/\/ v254/.test(ds), 'selectionBounds 默认开启 (保持 v49 行为)');
assert(/selectionBounds: p\.selectionBounds !== false/.test(ds), 'selectionBounds 持久化读取');

const panel = fs.readFileSync(path.join(root, 'src/components/DisplayPanel.tsx'), 'utf8');
assert(/key: 'selectionBounds'/.test(panel), '显示设置面板有选中包围框开关行');

const ec = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
assert(/\(store\.selected\.size > 0 \|\| store\.nodeSelectionCount > 0\) && displaySettings\.selectionBounds/.test(ec), '黄框+手柄绘制按开关门控 (v254; v267 适配: 门控补上节点选区)');
assert(/#f2b544/.test(ec), '黄框绘制代码仍在 (回归保护)');

if (failures) { console.error(`\nV254_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV254_ALL_PASSED');
