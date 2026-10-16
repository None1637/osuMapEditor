// 验证器 v426: 右栏视觉宽度恒定 + Inspector 布局韧性
//  - App.tsx: 右栏 w-56 (固定 224 布局 px) 改 style width: 224/uiZoom — 抵消根容器 CSS zoom (v217), 视觉恒定 224px; 只改右栏。
//  - Inspector.tsx: 旋转/缩放/镜像行 label+输入框一行 (NumIn flex-1 min-w-0)、按钮独占下一行 (grid grid-cols-2 / 单按钮 w-full);
//    转换/生成 4 处按钮排 flex flex-col gap-1 每枚整行; label whitespace-nowrap。
// 纯源码断言。运行: cd app && node verifier/v426/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('App.tsx: 右栏 224/zoom 接线');
{
  const src = readSrc('src/App.tsx');
  const m = src.match(/<div className="([^"]*border-l border-white\/10[^"]*)" data-ui-interactive\s*\n?\s*style=\{\{ width: 224 \/ uiZoom \}\}>/);
  assert(!!m, '右栏 div style width = 224 / uiZoom');
  assert(m && !m[1].includes('w-56'), '右栏不再固定 w-56');
  assert(m && m[1].includes('shrink-0') && m[1].includes('overflow-auto'), 'shrink-0/overflow-auto 保留');
  assert(/v426: 视觉宽度恒定 224px/.test(src), 'v426 版本注释');
  assert((src.match(/224 \/ uiZoom/g) ?? []).length === 2, '右栏 224/uiZoom (v428 左栏同方案, 共 2 处)'); // v428 适配: 原断言「仅一处」
}

section('Inspector.tsx: 变换区行布局韧性');
{
  const src = readSrc('src/components/Inspector.tsx');
  assert(/v426: 宽度默认 flex-1 min-w-0/.test(src), 'v426 版本注释 (NumIn)');
  assert(/w = 'flex-1 min-w-0'/.test(src), 'NumIn 默认 flex-1 min-w-0');
  assert(!/w="w-1[46]"/.test(src), '调用点固定宽 w-16/w-14 清零');
  assert((src.match(/grid grid-cols-2 gap-1/g) ?? []).length === 2, '旋转/镜像按钮排 grid grid-cols-2 ×2');
  assert((src.match(/flex flex-col gap-1/g) ?? []).length === 4, '转换/生成按钮排 flex-col ×4 (单选/多选各 2)');
  assert(!/flex gap-1\.5 flex-wrap/.test(src), '旧转换区 flex-wrap 混排清零');
  assert(/inspector\.apply_scale[\s\S]{0,400}?<Btn className="w-full"/.test(src)
    || /<Btn className="w-full" title=\{t\('inspector\.apply_scale_tip'/.test(src), '缩放 Apply 按钮独占一行 w-full');
  assert((src.match(/whitespace-nowrap/g) ?? []).length >= 5, 'label whitespace-nowrap (origin×4 + rotate/scale/flip)');
  assert((src.match(/data-conv-apply="split-anchors"/g) ?? []).length === 2, 'CDP 钩子 split-anchors ×2 保留');
  assert(src.includes('data-tf={testid}') && src.includes('testid="factor-y"'), 'data-tf 钩子保留');
}

if (failures) { console.error(`\nV426 FAILED (${failures})`); process.exit(1); }
console.log('\nV426 ALL PASSED');
