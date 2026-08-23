// 验证器 v165: 批量复制窗口打开且勾选自定义锚点时, 自定义锚点标记始终显示 (取消选中不消失)
// 运行: node verifier/v165/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('EditorCanvas.tsx: originMarkerVisible 放宽');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  // v166 适配: 批量复制窗口打开时改用弹窗独立 dupOriginMode; 否则保持"自定义模式 + 有选区"
  assert(/const originMarkerVisible = \(\) => store\.conversionDialog === 'duplicate'\s*\? store\.dupOriginMode === 'custom'\s*: store\.originMode === 'custom' && store\.selected\.size > 0;/.test(src),
    '批量复制窗口: dupOriginMode=custom 即显示 (无需选区); 否则自定义+有选区');
  // 绘制与命中共用同一函数 (调用点 2 处 + 定义 1 处)
  const calls = src.match(/originMarkerVisible\(\)/g) ?? [];
  assert(calls.length === 2, `绘制 + 命中拖拽 共 2 处调用 (实际 ${calls.length})`);
  assert(/const originMarkerVisible = \(\) =>/.test(src), '定义存在');
  // 命中分支保持: 拖动标记只改原点不动物件 (v166: 命中/绘制取 activeCustomOrigin)
  assert(/originMarkerVisible\(\) && Math\.hypot\(activeCustomOrigin\(\)\.x - p\.x, activeCustomOrigin\(\)\.y - p\.y\) <= 12/.test(src),
    '无选区时锚点仍可拖拽 (命中走同一可见条件)');
}

section('回归: v34 旧行为不破 (普通自定义模式仍需选区)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  // v166 适配: 非批量复制窗口时保持 originMode=custom + 有选区
  assert(/: store\.originMode === 'custom' && store\.selected\.size > 0;/.test(src),
    '无窗口时: 自定义模式+有选区才显示 (旧路径在三元右侧)');
}

console.log(failures ? `\nV165 FAILED: ${failures}` : '\nV165 ALL PASSED');
process.exit(failures ? 1 : 0);
