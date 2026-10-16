// 验证器 v428: 左侧栏视觉宽度恒定 + 抗挤压
//  - App.tsx: 左栏 w-56 (固定 224 布局 px) 改 style width: 224/uiZoom — 同 v426 右栏方案, 视觉恒定 224px;
//    栏内按钮/标签行统一 whitespace-nowrap (曲库皮肤半宽/工具/各开关/Grid Snap/间距旋转行/撤销重做,
//    PanNumInput 同步), 只改样式不改功能。
// 纯源码断言。运行: cd app && node verifier/v428/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('App.tsx: 左栏 224/zoom 接线');
{
  const src = readSrc('src/App.tsx');
  const m = src.match(/<div className="([^"]*border-r border-white\/10[^"]*)" data-ui-interactive\s*\n?\s*style=\{\{ width: 224 \/ uiZoom \}\}>/);
  assert(!!m, '左栏 div style width = 224 / uiZoom');
  assert(m && !m[1].includes('w-56'), '左栏不再固定 w-56');
  assert(m && m[1].includes('shrink-0') && m[1].includes('overflow-y-auto'), 'shrink-0/overflow-y-auto 保留');
  assert(/v428: 同 v426 右栏方案/.test(src), 'v428 版本注释');
  assert((src.match(/width: 224 \/ uiZoom/g) ?? []).length === 2, '左右栏 224/uiZoom 各一处 (共 2)');
}

section('App.tsx: 左栏控件 whitespace-nowrap 韧性');
{
  const src = readSrc('src/App.tsx');
  assert((src.match(/text-left px-3 py-1\.5 rounded whitespace-nowrap/g) ?? []).length === 15, '栏内 px-3 py-1.5 按钮 ×15 nowrap (曲库皮肤/工具/各开关)');
  // v432 适配: ZoomRot 拆两行 + 间距旋转拆两行 (英文溢出修复) — 标签行 6 → 8
  assert((src.match(/flex items-center gap-1\.5 text-sm text-white\/70 px-1 whitespace-nowrap/g) ?? []).length === 8, '标签行 ×8 nowrap (节拍/倍率/Zoom/Rot/xy/间距/旋转/原点坐标; v432 两行各拆二)');
  assert((src.match(/flex-1 px-2 py-1\.5 rounded whitespace-nowrap bg-white\/10/g) ?? []).length === 2, '撤销/重做半宽按钮 ×2 nowrap');
  assert(/flex items-center gap-0\.5 whitespace-nowrap \$\{grow/.test(src), 'PanNumInput nowrap');
  // Grid Snap 按钮 (截图问题原件) 在 15 枚集合内, 单独确认钩子
  assert(/data-grid-input="type"[\s\S]{0,400}?grid_snap|grid_snap[\s\S]{0,400}?data-grid-input="type"/.test(src) || src.includes("t('app.grid_snap', 'Grid Snap')"), 'Grid Snap 按钮仍在');
}

if (failures) { console.error(`\nV428 FAILED (${failures})`); process.exit(1); }
console.log('\nV428 ALL PASSED');
