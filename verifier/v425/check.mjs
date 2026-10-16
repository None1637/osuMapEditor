// 验证器 v425: 右栏 (Inspector) 按钮组件化 — 新 Btn 组件 (normal/primary/danger) 替换三处手写样式
// (v146 模块级 Btn / 转换区 cls / 删除按钮), NumIn 输入框 h-7 与按钮等高对齐。
// 纯源码断言 (样式重构, 无行为变化); CDP 钩子 (data-conv-*/data-tf/data-hs) 必须原样保留 — 回归验证器依赖。
// 运行: cd app && node verifier/v425/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('Btn.tsx: 组件存在 + 三 variant + 统一尺寸');
{
  const src = readSrc('src/components/Btn.tsx');
  assert(/v425:/.test(src), 'v425 版本注释');
  assert(/export (const|function) Btn/.test(src), 'Btn 导出');
  assert(/normal:[\s\S]*?bg-white\/10 hover:bg-white\/20 border border-white\/15/.test(src), 'normal variant (原 bg-white/10 系)');
  assert(/primary:[\s\S]*?bg-pink-500 hover:bg-pink-400/.test(src) && /font-bold/.test(src), 'primary variant (仿弹窗主按钮)');
  assert(/danger:[\s\S]*?bg-red-500\/30 hover:bg-red-500\/50/.test(src), 'danger variant (原删除按钮色系)');
  assert(/h-7 px-2 rounded text-\[11px\] inline-flex items-center justify-center gap-1 whitespace-nowrap select-none disabled:opacity-40/.test(src), '统一尺寸/对齐/抗换行/disabled');
}

section('Inspector.tsx: 引用 Btn 组件, 旧手写样式清零');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(/import \{ Btn \} from '\.\/Btn'/.test(src), "import Btn from './Btn'");
  assert(!/const Btn = \(\{ label/.test(src), 'v146 模块级 Btn 定义已移除');
  assert(!/const cls = /.test(src), '转换区 cls 已移除');
  assert(!/px-1\.5 py-1 rounded bg-white\/10/.test(src), '旧 Btn 样式串清零');
  assert(!/px-2 py-1 rounded bg-white\/10/.test(src), '旧转换/生成按钮样式串清零');
  assert(!src.includes('bg-red-500/30'), '旧删除按钮样式串清零 (danger 走 variant)');
  assert(/variant="danger"[\s\S]{0,120}?store\.deleteSelected\(\)/.test(src) || /store\.deleteSelected\(\)[\s\S]{0,120}?variant="danger"/.test(src)
    || /<Btn variant="danger" className="mt-2" onClick=\{\(\) => store\.deleteSelected\(\)\}>/.test(src), '删除按钮 = Btn variant=danger');
  assert(/h-7 bg-black\/40 border border-white\/15 rounded px-1 text-white/.test(src), 'NumIn h-7 与按钮等高对齐');
  assert(/v425:/.test(src), 'v425 版本注释');
}

section('Inspector.tsx: CDP 钩子原样保留');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert((src.match(/data-conv-apply="split-anchors"/g) ?? []).length === 2, 'split-anchors ×2 (单选/多选)');
  for (const hook of ['data-conv-open="stream"', 'data-conv-open="polygon"', 'data-conv-open="duplicate"', 'data-conv-open="split"', 'data-conv-open="symSlider"',
    'data-conv-apply="p2b"', 'data-conv-apply="b4toB"', 'data-conv-apply="merge"'])
    assert(src.includes(hook), `${hook} 保留`);
  assert((src.match(/data-conv-open="polygon"/g) ?? []).length === 2, 'polygon ×2 (单选/多选)');
  for (const tf of ['data-tf={testid}', 'data-tf={`origin-${m}`}', 'data-hs'])
    assert(src.includes(tf), `${tf} 保留`);
  for (const id of ["testid=\"angle\"", "testid=\"factor\"", "testid=\"factor-y\"", "testid=\"custom-x\"", "testid=\"custom-y\""])
    assert(src.includes(id), `${id} 保留`);
}

if (failures) { console.error(`\nV425 FAILED (${failures})`); process.exit(1); }
console.log('\nV425 ALL PASSED');
