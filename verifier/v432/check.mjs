// 验证器 v432: 修「左栏英文下横向溢出 — Zoom 输入被裁 / Grid Rotation 输入溢出栏外需横向滚动」
// 根因: 左栏视觉宽恒定 224px (v428), 两行内容按中文宽度设计, 英文 label 更宽:
//   1) Playfield Pan 'Zoom [1.000] Rot [0.0]' 同行 — label 把输入框挤到 ~55px, '1.000' 尾位被裁
//      (ui-audit num-clip 实测 scroll 59>53);
//   2) Grid Snap 'Spacing [32] px … Rotation [90.0] °' 同行 — 实测 ~276px 超栏内容宽 223px,
//      左栏 overflow-y:auto 连带出现横向滚动条, Rotation 输入溢出栏外要滚动才摸得到
//      (ui-audit col-hscroll 实测超 61px)。旧审计漏检: clippedBy 对滚动容器豁免。
// 修复 (行重构为主, 裁剪兜底为辅):
//   - Zoom/Rot 拆两行 / Spacing/Rotation 拆两行, 各 label shrink-0 + 输入框 flex-1 min-w-0 拉满;
//     GridSpacingInput w-12 → flex-1 min-w-0; rotation input w-14 → flex-1 min-w-0;
//   - 左栏容器加 overflow-x-clip 兜底 (注释说明: 会掩盖视觉问题, 但 col-hscroll 按 scrollWidth
//     口径仍能抓到, 有恃无恐才加)。
// ui-audit 扩展: 双语遍历 (en/zh-CN — 溢出与文案宽度强相关) + col-hscroll (栏横向滚动) +
//   num-clip (数字框内容被裁; 阈值 +3 滤 Chromium spin button 固有 ~2px 占位)。
// 运行: npm run build 后 node verifier/v432/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('源码: Playfield Pan Zoom/Rot 紧凑单行 (v435)');
{
  const app = read('src/App.tsx');
  assert(/v435: 恢复单行紧凑 — Zoom\/Rot 两个输入框平分一行/.test(app), 'v435 注释 (撤销 v432 拆行)');
  // v435: 用户反馈独占一行的输入框过大 — 恢复单行, 两个 grow 输入框平分 (同 x/y 行)
  const zoomRow = app.match(/<div className="flex items-center gap-1\.5 text-sm text-white\/70 px-1 whitespace-nowrap">\s*(?:\{[\s\S]*?\}\s*)*<PanNumInput label="Zoom"[\s\S]*?<\/div>/)?.[0] ?? '';
  assert(zoomRow.length > 0 && zoomRow.includes('label="Rot"'), 'Zoom/Rot 同一行');
}

section('源码: Grid Spacing/Rot 紧凑单行 + en Rotation→Rot (v435)');
{
  const app = read('src/App.tsx');
  assert(/v435: 恢复单行紧凑 — en 'Rotation' 简写为 'Rot'/.test(app), 'v435 注释 (撤销 v432 拆行)');
  const spacingRow = app.match(/<div[^>]*title=\{t\('app\.grid_spacing_title'[\s\S]*?<\/div>/)?.[0] ?? '';
  assert(spacingRow.length > 0 && /GridSpacingInput disabled=\{!bm\}/.test(spacingRow), 'Spacing 行含间距输入');
  assert(spacingRow.includes('data-grid-input="rotation"'), 'Spacing/Rotation 同一行');
  assert(/t\('app\.grid_rotation', 'Rot'\)/.test(spacingRow), "en 标签简写为 'Rot' (与 Playfield Pan 一致; zh 词典 旋转 不变)");
  assert(/data-grid-input="rotation"[\s\S]{0,400}?className="flex-1 min-w-0 /.test(spacingRow), 'Rotation 输入 flex-1 min-w-0');
  const gsi = app.match(/function GridSpacingInput[\s\S]*?\n\}/)?.[0] ?? '';
  assert(gsi.includes('flex-1 min-w-0') && !/className="w-12/.test(gsi), 'GridSpacingInput flex-1 min-w-0 (无固定宽)');
}

section('源码: 左栏 overflow-x-clip 兜底');
{
  const app = read('src/App.tsx');
  assert(/overflow-y-auto overflow-x-clip flex flex-col[\s\S]{0,120}?data-ui-interactive[\s\S]{0,60}?width: 224 \/ uiZoom/.test(app), '左栏容器 overflow-x-clip');
  assert(/v432: overflow-x-clip 兜底/.test(app), '注释说明裁剪为辅 (掩盖问题警示 + col-hscroll 仍有效)');
}

section('源码: ui-audit 检测能力 (双语 + col-hscroll + num-clip)');
{
  const ua = read('verifier/ui-audit/check.mjs');
  assert(/for \(const lang of \['en', 'zh-CN'\]\)/.test(ua), '双语遍历');
  assert(ua.includes("kind: 'col-hscroll'"), '栏横向滚动检测 (scrollWidth 口径)');
  assert(ua.includes("kind: 'num-clip'"), '数字框内容裁切检测');
  assert(/el\.type === 'number' && el\.scrollWidth > el\.clientWidth \+ 3/.test(ua), 'num-clip 阈值 +3 (滤 spin button 固有 ~2px)');
}

section('ui-audit 全绿 (双语 × 两档尺寸)');
{
  const out = execSync('node verifier/ui-audit/check.mjs', { cwd: root, encoding: 'utf8' });
  assert(out.includes('UI_AUDIT_CLEAN'), 'UI_AUDIT_CLEAN');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V432_FAILED: ${failures} 处失败` : '\nVERIFIER_V432_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
