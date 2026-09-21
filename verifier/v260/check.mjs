// 验证器 v260: 右上角详细信息显示选中滑条点。
// 需求: soulten「右上角的詳細資訊不會顯示滑條點的資訊」「右上角物件詳細資訊無法顯示滑條點的資訊」。
// 实现: SelectionInfoPanel 在 nodeSelectionCount > 0 时改显示节点信息 (索引语义与 EditorCanvas ctrl=[头,...curvePoints] 同源)。
// v268 适配: 用户反馈不要逐节点列出 — 改显示「所有选中节点中最前一个节点到前一节点的距离」与
//   「最后一个节点到后一节点的距离」(跨滑条按物件时间取两端, 无端点显示 —); 逐节点列表断言替换。
// 运行: node verifier/v260/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
assert(/store\.nodeSelectionCount/.test(src), '读取节点选中计数');
assert(/store\.selectedNodes/.test(src), '遍历 selectedNodes');
assert(/\[\{ x: o\.x, y: o\.y \}, \.\.\.\(o\.curvePoints \?\? \[\]\)\]/.test(src), 'ctrl 数组与节点选中索引同源 (头 + curvePoints)');
// v268: 首末距离取代逐节点列表
assert(/v268: 节点信息改首末距离/.test(src), 'v268 注释在');
assert(/groups\.sort\(\(a, b\) => a\.time - b\.time\)/.test(src), '跨滑条按物件时间排序取两端');
assert(/prevDist: dist\(gf\.ctrl, firstIdx - 1, firstIdx\)/.test(src), '最前选中节点到前一节点距离');
assert(/nextDist: dist\(gl\.ctrl, lastIdx, lastIdx \+ 1\)/.test(src), '最后选中节点到后一节点距离');
assert(/滑条点 ×\{nodeInfo\.count\}/.test(src), '节点计数标题行');
assert(/nodeInfo \? \(/.test(src), '节点分支优先于物件间距分支');

if (failures) { console.error(`\nV260_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV260_ALL_PASSED');
