// 验证器 v316: F18a/b + F20 Alt 选取模式即时刷新 / Alt 点选锚点修正 / hover 预览随时间消失
//   F18a: Alt 按下/松开立即重算 hover 目标 (refreshHover, 与 mousemove 同源), Alt 层画锚点高亮环
//   F18b: Alt+点击候选含选中/有已选节点的滑条 (时间滚走后仍可点选), 且在清空物件选区之前取候选
//   F20: 滚轮改时间后滑条出可见窗 → hover 预览消失 (isVisibleAt 守卫; 选中滑条装饰不受影响)
//   (F18c 快捷键面板固定键位条目 → v321 统一补)
// 运行: node verifier/v316/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const ec = readSrc('src/components/EditorCanvas.tsx');

section('F18a: refreshHover 集中重算 + Alt 即时刷新');
{
  assert(/hoverNodeRef = useRef<\{ objId: number; idx: number \} \| null>\(null\)/.test(ec), 'hoverNodeRef 存在');
  const rh = ec.match(/const refreshHover = \(\) => \{[\s\S]{0,1200}?\n  \};/);
  assert(!!rh, 'refreshHover 存在');
  assert(!!rh && /nearestNode\(sliders, offs, cp\)/.test(rh[0]), 'Alt 层: 跨滑条最近锚点');
  assert(!!rh && /isVisibleAt\(bm, o, store\.currentTime\) \|\| store\.selected\.has\(o\.id\) \|\| store\.selectedNodes\.has\(o\.id\)/.test(rh[0]), 'Alt 层候选含 v273 例外 (与点选一致)');
  assert(!!rh && /hoverNodeRef\.current = null/.test(rh[0]), '非 Alt 层清锚点 hover');
  assert(/altHeldRef\.current = e\.altKey;[^\n]*\n\s*refreshHover\(\);/.test(ec), 'Alt keydown/keyup 立即刷新');
  assert(/altHeldRef\.current = false; refreshHover\(\);/.test(ec), 'blur 复位后刷新');
  const mm = ec.match(/const onMouseMove = \(e: React\.MouseEvent\) => \{[\s\S]{0,1600}?refreshHover\(\);/);
  assert(!!mm, 'onMouseMove 走 refreshHover (旧内联块移除)');
}

section('F18a 渲染: Alt 层锚点高亮环');
{
  const ring = ec.match(/Alt 层 hover 锚点高亮环[\s\S]{0,1200}?g\.restore\(\);/);
  assert(!!ring, '高亮环渲染块存在');
  assert(!!ring && /'#ff6666' : '#f5a623'/.test(ring[0]), '已选=红(将取消) / 未选=橙黄(将选中)');
}

section('F18b: Alt+点击候选修正');
{
  const altLayer = ec.match(/if \(e\.altKey && !store\.lockNotes\) \{[\s\S]{0,2600}?\n      \}/);
  assert(!!altLayer, 'Alt 分支存在');
  assert(!!altLayer && /F18b/.test(altLayer[0]) && /\|\| store\.selected\.has\(o\.id\) \|\| store\.selectedNodes\.has\(o\.id\)/.test(altLayer[0]), '候选含选中/已选节点滑条');
  assert(!!altLayer && altLayer[0].indexOf('nearestNode(sliders, offs, p)') < altLayer[0].indexOf('store.selected.clear()'), '候选先于清空物件选区');
}

section('F20: hover 预览随可见窗消失');
{
  const hv = ec.match(/const ho = hid !== null[\s\S]{0,700}?drawSliderControlPoints\(g, ho\);/);
  assert(!!hv && /isVisibleAt\(bm, ho, store\.currentTime\)/.test(hv[0]), 'hover 滑条点预览加 isVisibleAt 守卫');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv316 全部通过');
process.exit(failures ? 1 : 0);
