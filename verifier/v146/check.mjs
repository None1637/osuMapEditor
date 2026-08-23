// 验证器 v146: 右侧栏变换面板输入框 (旋转角度/缩放倍率/自定义原点 x/y) 全选输入不失焦
// 根因: Btn/NumIn/TransformPanel 原定义为 Inspector 内部组件, 每次重渲染生成新组件类型,
//       React 卸载重建子树 => 输入框 DOM 替换 => 失焦 (网格间距输入是顶层组件 + 局部文本态, 不失焦)
// 修复: Btn/NumIn 提升为模块顶层组件; NumIn 局部文本态 (与 GridSpacingInput 同款); TransformPanel 改函数调用渲染
// 运行: node verifier/v146/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const src = readSrc('src/components/Inspector.tsx');
const iInspector = src.indexOf('export function Inspector()');

section('Btn/NumIn 提升为模块顶层组件 (组件类型稳定, 重渲染不重建 DOM)');
{
  const iBtn = src.indexOf('const Btn = ({ label, title, onClick }');
  const iNumIn = src.indexOf('const NumIn = ({ value, set, w');
  assert(iBtn >= 0 && iBtn < iInspector, 'Btn 定义在 Inspector 之前 (模块顶层)');
  assert(iNumIn >= 0 && iNumIn < iInspector, 'NumIn 定义在 Inspector 之前 (模块顶层)');
  // Inspector 函数体内不再有内层组件定义
  const body = src.slice(iInspector);
  assert(!body.includes('const Btn = ('), 'Inspector 内不再定义 Btn');
  assert(!body.includes('const NumIn = ('), 'Inspector 内不再定义 NumIn');
}

section('NumIn 局部文本态 (与 App.tsx GridSpacingInput 同款模式)');
{
  assert(/const \[text, setText\] = useState<string \| null>\(null\);/.test(src), '局部文本态 useState<string | null>(null)');
  assert(/value=\{text \?\? String\(value\)\}/.test(src), '显示 = 文本态 ?? 已提交值 (输入过程不被数值覆盖)');
  assert(/const v = parseFloat\(e\.target\.value\); if \(isFinite\(v\)\) set\(v\);/.test(src), '合法值实时提交');
  assert(/onBlur=\{\(\) => setText\(null\)\}/.test(src), '失焦还原为已提交值');
  assert(!src.includes('onChange={e => set(parseFloat(e.target.value) || 0)}'), '旧直写数值 onChange 已移除 (全选输入会被覆盖 + 失焦)');
}

section('TransformPanel 以普通函数调用渲染 (不作为 JSX 组件边界)');
{
  assert((src.match(/\{TransformPanel\(\)\}/g) || []).length === 2, '两处调用点 (多选分支 + 单选分支) 均为 {TransformPanel()}');
  assert(!src.includes('<TransformPanel />'), '不再以 <TransformPanel /> 组件形式渲染');
}

section('回归: 功能接线不变');
{
  for (const tid of ['"angle"', '"factor"', '"custom-x"', '"custom-y"'])
    assert(src.includes(`testid=${tid}`), `data-tf=${tid} 保留`);
  assert(src.includes('store.rotateSelected(-Math.abs(angle), origin)'), '逆时针旋转接线不变');
  assert(src.includes('store.rotateSelected(Math.abs(angle), origin)'), '顺时针旋转接线不变');
  assert(src.includes('store.scaleSelected(factor, origin)'), '缩放应用接线不变');
  assert(src.includes('store.setCustomOrigin({ x: v, y: store.customOrigin.y })'), '自定义原点 x 接线不变');
  assert(src.includes('store.setCustomOrigin({ x: store.customOrigin.x, y: v })'), '自定义原点 y 接线不变');
}

section('对照: 网格间距输入模式 (App.tsx GridSpacingInput) 仍是顶层组件');
{
  const app = readSrc('src/App.tsx');
  assert(app.indexOf('function GridSpacingInput') < app.indexOf('export default function App'), 'GridSpacingInput 顶层定义 (不失焦的参照实现)');
}

if (failures) { console.error(`\nV146_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV146_ALL_PASSED');
