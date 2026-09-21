// 验证器 v268: 详细信息滑条点改显示首末节点距离。
// 需求: 用户反馈「详细信息显示滑条点需要显示所有节点中最前一个节点距离前一个节点的距离,
//   与最后一个节点距离后一个节点的距离, 而不是现在每个节点」。
// 实现: SelectionInfoPanel v260 的逐节点列表替换为 nodeInfo:
//   滑条点 ×N / 前 #i← Npx (最前选中节点到前一节点) / 后 #j→ Npx (最后选中节点到后一节点),
//   跨滑条按物件时间排序取两端, 无端点显示 —。
// 运行: node verifier/v268/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const src = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
assert(/v268: 节点信息改首末距离/.test(src), 'v268 注释在');
assert(/let nodeInfo: \{ count: number; firstIdx: number; prevDist: number \| null; lastIdx: number; nextDist: number \| null \} \| null = null/.test(src), 'nodeInfo 结构 (首末索引 + 前后距离, 可空)');
assert(/groups\.push\(\{ time: o\.time, ctrl: \[/.test(src), '每滑条一组 (时间 + ctrl + 选中索引)');
assert(/groups\.sort\(\(a, b\) => a\.time - b\.time\)/.test(src), '跨滑条按物件时间排序');
assert(/const dist = \(c: \{ x: number; y: number \}\[\], a: number, b: number\) =>/.test(src) && /Math\.round\(Math\.hypot/.test(src), '距离 = 相邻点欧氏距离取整 px');
assert(/prevDist: dist\(gf\.ctrl, firstIdx - 1, firstIdx\)/.test(src), '前距 = 最前选中节点与前一节点');
assert(/nextDist: dist\(gl\.ctrl, lastIdx, lastIdx \+ 1\)/.test(src), '后距 = 最后选中节点与后一节点');
assert(/前 #\{nodeInfo\.firstIdx\}←/.test(src) && /后 #\{nodeInfo\.lastIdx\}→/.test(src), 'UI 行: 前 #i← Npx / 后 #j→ Npx');
assert(/nodeInfo\.prevDist === null \? '—'/.test(src) && /nodeInfo\.nextDist === null \? '—'/.test(src), '无端点显示 —');
assert(!/nodes\.slice\(0, 3\)/.test(src), 'v260 逐节点列表已移除');

if (failures) { console.error(`\nV268_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV268_ALL_PASSED');
