// 验证器 v277: 框选进行中时间改变时保留已选中但不可见的物件/节点。
// 需求: 用户反馈「框选物件时如果时间改变, 不要取消选中哪些已选中但当前时间不可见的物件」。
// 根因: 框选拖动每帧重算选区 = 按下时 base + 当前框内「可见」物件 (v45);
//   框选进行中播放/滚轮/边缘滚动改变时间后, 之前框进但已不可见的物件掉出重算结果 = 被取消选中。
// 修复: 重算时并入「已选中但当前不可见」的物件 (物件框选) 与「所在滑条不可见的已选节点」
//   (节点框选, 经 nodeEntries); 可见物件的反向框选取消语义不变 (可见物件不在 keep 集)。
// 运行: node verifier/v277/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
assert((src.match(/v277:/g) ?? []).length === 2, '物件框选与节点框选各一处 v277 注释');
assert(/const keepHidden = bm\.hitObjects\.filter\(o => !isVisibleAt\(bm, o, store\.currentTime\) && store\.selected\.has\(o\.id\)\)\.map\(o => o\.id\)/.test(src), '物件框选保留已选不可见物件');
assert(/store\.select\(\[\.\.\.mq\.base, \.\.\.keepHidden, \.\.\.objectsInRect/.test(src), '选区 = base + 保留 + 框内可见');
assert(/const keepNodes = nodeEntries\(store\.selectedNodes\)\.filter/.test(src), '节点框选保留不可见滑条的已选节点');
assert(/store\.setSelectedNodes\(\[\.\.\.nmq\.base, \.\.\.keepNodes, \.\.\.nodesInRect/.test(src), '节点选区 = base + 保留 + 框内可见');
// 回归保护: 框选候选仍只含当前可见物件 (v45)
assert(/v45: 只框选当前可见物件/.test(src), '框选候选可见窗口不变 (v45)');

if (failures) { console.error(`\nV277_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV277_ALL_PASSED');
