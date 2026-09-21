// 验证器 v273: 选中物件当前时间不可见时仍可交互 (拖动/右键等)。
// 需求: 用户反馈「选中物件后, 即使点击的选中物件当前时间不可见, 也需要能交互
//   (拖动等所有适用于当前可见物件的交互)」。
// 根因: hitTest 命中候选只含 isVisibleAt 可见物件 — 不可见的选中物件有选中装饰层
//   (drawSelectionDecor 不过滤可见性, 蓝框可见) 却点不中。
// 修复: EditorCanvas 两处放开已选例外 —
//   1) hitTest 候选 = 可见物件 ∪ 已选中物件 (v171 已选优先语义不变, 未选中不可见物件仍不可点);
//   2) v266 整组节点拖的滑条候选同样放开已选节点所在滑条 (节点选区独立于物件选区, v265)。
// 框选 (物件/节点) 仍只框可见物件 (v45 语义不变)。
// 运行: node verifier/v273/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
assert(/v273: 已选中物件例外/.test(src), 'v273 注释在');
assert(/isVisibleAt\(bm, o, store\.currentTime\) \|\| store\.selected\.has\(o\.id\)\);/.test(src), 'hitTest 候选含已选中不可见物件');
assert(/isVisibleAt\(bm, o, store\.currentTime\) \|\| store\.selected\.has\(o\.id\) \|\| store\.selectedNodes\.has\(o\.id\)\)/.test(src), '整组节点拖候选含已选节点所在滑条');
// 回归保护: 框选仍只框可见物件 (v45)
assert(/v45: 只框选当前可见物件/.test(src), '物件框选可见窗口不变 (v45)');
assert(/v117: 节点框选拖拽: 实时更新节点选区 \(只框当前可见滑条/.test(src), '节点框选可见窗口不变 (v117)');

const rd = fs.readFileSync(path.join(root, 'src/osu/renderer.ts'), 'utf8');
assert(/for \(const o of bm\.hitObjects\) if \(rc\.selected\.has\(o\.id\)\) drawSelectionDecor/.test(rd), '选中装饰层不过滤可见性 (不可见选中物件有标记可点)');

if (failures) { console.error(`\nV273_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV273_ALL_PASSED');
