// 验证器 v210: 编辑菜单改名「批量复制...」+ 新增「对称...」窗口 (对称轴: 选区/中心/自定义两点线, 两点不可重合)
// 运行: node verifier/v210/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store/transform 纯函数单测 (tests.ts)');
{
  const out = path.join(root, 'verifier/v210/_bundle.mjs');
  execSync(`npx esbuild "${path.join(root, 'verifier/v210/tests.ts')}" --bundle --platform=node --outfile="${out}"`, { cwd: root, stdio: 'pipe' });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '    ' + l).join('\n'));
}

section('transform.ts: reflectObjectsAcrossLine 纯函数');
{
  const src = readSrc('src/osu/transform.ts');
  assert(/export function reflectObjectsAcrossLine\(objs: HitObject\[\], p1: Pt, p2: Pt\)/.test(src), '函数签名存在');
  assert(/if \(len2 < 1e-9\) return \[\];/.test(src), '两点重合守卫');
  assert(/2 \* qx - p\.x, y: 2 \* qy - p\.y/.test(src), '垂足镜像公式');
}

section('store.ts: 对称状态与 reflectSelected');
{
  const src = readSrc('src/osu/store.ts');
  assert(/transformDialog: 'rotate' \| 'scale' \| 'symmetry' \| null/.test(src), 'transformDialog 含 symmetry');
  assert(/symAxisMode: 'selection' \| 'center' \| 'custom'/.test(src), 'symAxisMode 字段');
  assert(/symAxisDir: 'v' \| 'h'/.test(src), 'symAxisDir 字段');
  assert(/symP1: Pt/.test(src) && /symP2: Pt/.test(src), 'symP1/symP2 字段');
  assert(/setSymPoint\(i: 1 \| 2, p: Pt\)/.test(src) && /if \(d < 4\)/.test(src), 'setSymPoint 最小间距钳制 (4px)');
  assert(/symAxisLine\(\): \{ p1: Pt; p2: Pt \} \| null/.test(src), 'symAxisLine 模式换算');
  assert(/reflectSelected\(\)[\s\S]*?reflectObjectsAcrossLine\(objs, line\.p1, line\.p2\)/.test(src), 'reflectSelected 走纯函数');
  assert(/if \(!objs\.length \|\| !selectionCenter\(objs\)\) return;/.test(src), '空选区/只选转盘守卫');
}

section('菜单与桥接: 改名 + 对称项');
{
  const main = readSrc('electron/main.cjs');
  assert(main.includes('"批量复制..."'), '菜单项改名「批量复制...」');
  assert(!main.includes('仿制'), '「仿制」文案已移除');
  assert(main.includes('e("edit-open-symmetry", "对称...", null, sel)'), '对称... 无快捷键, 按选中置灰');
  const bridge = readSrc('src/osu/electronBridge.ts');
  assert(bridge.includes("'edit-open-symmetry'"), 'ElectronMenuCommand 含 edit-open-symmetry');
  const menu = readSrc('src/osu/electronMenu.ts');
  assert(/case 'edit-open-symmetry': store\.openTransformDialog\('symmetry'\)/.test(menu), '命令分发到对称窗口');
}

section('TransformDialog.tsx: 对称模式 UI');
{
  const src = readSrc('src/components/TransformDialog.tsx');
  assert(/mode: 'rotate' \| 'scale' \| 'symmetry'/.test(src), 'mode 含 symmetry');
  assert(/store\.setSymAxisMode\(m\)/.test(src), '对称轴模式单选 (选区/中心/自定义)');
  assert(/store\.setSymAxisDir\(d\)/.test(src), '轴向单选 (竖直/水平线)');
  assert(/store\.setSymPoint\(1, /.test(src) && /store\.setSymPoint\(2, /.test(src), '自定义两点坐标输入');
  assert(/store\.reflectSelected\(\)/.test(src), '应用对称按钮');
}

section('EditorCanvas.tsx: 对称轴渲染与拖拽');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/symPointDragRef = useRef<0 \| 1 \| 2>\(0\)/.test(src), '拖拽 ref 声明');
  assert(/store\.transformDialog === 'symmetry'[\s\S]*?setLineDash\(\[8, 6\]\)/.test(src), '对称轴虚线预览');
  assert(/for \(const m of \[store\.symP1, store\.symP2\]\)/.test(src), '自定义端点标记渲染');
  assert(/symPointDragRef\.current = \(hit \+ 1\) as 1 \| 2/.test(src), 'mousedown 端点命中');
  assert(/store\.setSymPoint\(i, gridSnapAt\(/.test(src), '拖拽回写 (带吸附)');
  assert(/symPointDragRef\.current = 0; panDragRef\.current = null; finishHandleDrag\(\)/.test(src), 'mouseup 清除拖拽 ref');
}

if (failures) { console.error(`V210 FAILED: ${failures}`); process.exit(1); }
console.log('V210 ALL PASSED');
