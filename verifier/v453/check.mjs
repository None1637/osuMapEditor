// 验证器 v453: 移除 Alt 点选滑条后的青色虚线标记 (soulten 反馈, None1637 指示) —
//   v371 引入的 altPickSliders 高亮 (青色 #4df3ff 虚线控制多边形 + 节点圆点) 删除;
//   altPickSliders 状态与 v371a 框选收窄逻辑必须保留。
// 运行: node verifier/v453/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failures = 0;
const assert = (cond, msg) => { if (cond) console.log(`  ok - ${msg}`); else { console.error(`  FAIL - ${msg}`); failures++; } };
const section = (s) => console.log(`== ${s}`);

section('EditorCanvas.tsx: 高亮块已移除');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert(!/if \(store\.altPickSliders\.size\) \{[\s\S]{0,400}?#4df3ff/.test(src), '无 altPick 青色虚线高亮块');
  assert(src.includes('v453'), '有 v453 注记');
  // 状态与收窄逻辑保留
  assert(/inRect0\.filter\(\(\[objId\]\) => store\.altPickSliders\.has\(objId\)\)/.test(src), 'v371a 框选收窄保留');
  assert(/store\.toggleAltPickSlider\(hitObj\.id\)/.test(src), 'Alt+点击滑条本体切换点选保留');
}

section('store.ts: altPickSliders 状态保留');
{
  const src = read('src/osu/store.ts');
  assert(/altPickSliders = new Set<number>\(\);/.test(src), 'altPickSliders 字段保留');
  assert(/this\.altPickSliders = new Set\(\); \/\/ v371: 换谱清空/.test(src), 'load 换谱清空保留');
}

if (failures) { console.error(`V453 FAILED: ${failures}`); process.exit(1); }
console.log('V453 ALL PASSED');
