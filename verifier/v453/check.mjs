// 验证器 v453: 移除 Alt 点选滑条后的青色虚线标记 (soulten 反馈, None1637 指示) —
//   v371 引入的 altPickSliders 高亮 (青色 #4df3ff 虚线控制多边形 + 节点圆点) 删除。
// v459: 判定也不用留 (soulten/None1637) — altPickSliders 状态与 v371a 框选收窄整体移除,
//   本验证器相应改为断言「显示与判定都不存在」。
// 运行: node verifier/v453/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failures = 0;
const assert = (cond, msg) => { if (cond) console.log(`  ok - ${msg}`); else { console.error(`  FAIL - ${msg}`); failures++; } };
const section = (s) => console.log(`== ${s}`);

section('EditorCanvas.tsx: 高亮块与判定均已移除');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert(!/if \(store\.altPickSliders\.size\) \{[\s\S]{0,400}?#4df3ff/.test(src), '无 altPick 青色虚线高亮块');
  assert(src.includes('v453'), '有 v453 注记');
  assert(!/altPickSliders|toggleAltPickSlider/.test(src), 'v459: altPick 判定 (框选收窄/本体点击切换) 已移除');
}

section('store.ts: altPickSliders 状态已移除 (v459)');
{
  const src = read('src/osu/store.ts');
  assert(!/altPickSliders/.test(src), 'v459: altPickSliders 字段/方法/load 清空全删');
}

if (failures) { console.error(`V453 FAILED: ${failures}`); process.exit(1); }
console.log('V453 ALL PASSED');
