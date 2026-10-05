// 验证器 v339: 缩放后最小字号不低于 12px (用户规则)
//   soulten 反馈: 快捷键面板 / 底部时间 / 倍速按钮 / 检查器「未选中物件」字小。
//   用户规则: 即使窗口缩小 (v217 全局 zoom), 视觉字号也不能低于 12px。
// 修法:
//   - index.css: v225 的 --fs-comp 补偿规则全部改 max(calc(原), calc(12px / var(--ui-zoom,1)))
//     — 布局字号下限 = 12px / zoom, 视觉恰 12px;
//   - App.tsx 根容器设 --ui-zoom = uiZoom;
//   - 独立窗口 (DraggableDialog / useCounterZoom) 反缩放后已是自然字号, 设 --ui-zoom:1 不参与。
// 运行: node verifier/v339/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const css = readSrc('src/index.css');
const app = readSrc('src/App.tsx');
const uiZoom = readSrc('src/osu/uiZoom.ts');
const dlg = readSrc('src/components/DraggableDialog.tsx');

section('index.css: 全部字号规则带 12px 视觉下限');
{
  const rules = css.match(/\.ui-zoom-root[^{]*\{[^}]*font-size:[^}]*\}/g) ?? [];
  assert(rules.length >= 13, `覆盖 13 条字号规则 (容器兜底 + xs..3xl + 9/10/11/12/13/15px, 实际 ${rules.length})`);
  const bad = rules.filter(r => !/max\(calc\([^)]*\* var\(--fs-comp, 1\)\), calc\(12px \/ var\(--ui-zoom, 1\)\)\)/.test(r));
  assert(bad.length === 0, `每条规则 = max(原补偿, 12px/--ui-zoom) (违规 ${bad.length} 条${bad.length ? ': ' + bad[0].slice(0, 60) : ''})`);
}

section('--ui-zoom 变量来源');
{
  assert(/--fs-comp': fsComp, '--ui-zoom': uiZoom/.test(app), 'App 根容器设 --ui-zoom');
  assert(/--fs-comp': 1, '--ui-zoom': 1/.test(uiZoom), 'useCounterZoom 独立窗口 --ui-zoom:1 (自然字号不参与)');
  assert(/--fs-comp': 1, '--ui-zoom': 1/.test(dlg), 'DraggableDialog --ui-zoom:1');
}

section('数值验证: 视觉字号 = 布局 × zoom ≥ 12');
{
  // zoom=0.6 (UI_ZOOM_MIN): textZoom = 0.8, fsComp = 0.8/0.6 = 1.333; 布局下限 = 12/0.6 = 20px
  const zoom = 0.6, fsComp = 0.8 / zoom, floor = 12 / zoom;
  const visual = base => Math.max(base * fsComp, floor) * zoom;
  const cases = [[12, 12], [11, 12], [10, 12], [13, Math.max(13 * 0.8, 12)], [16, 12.8]];
  const bad = cases.filter(([b, want]) => Math.abs(visual(b) - want) > 0.01);
  assert(bad.length === 0, 'zoom=0.6 时: 10/11/12px → 视觉 12px; 13px → 13×0.8=12.4... 规则取大者');
  assert(cases.every(([b]) => visual(b) >= 12), '任意基础字号视觉 ≥ 12px');
  // zoom=1 时行为不变 (max(原,12): 仅 <12px 的基础字号被抬到 12 — 项目最小 text-xs=12, 无变化)
  const v1 = base => Math.max(base * 1, 12 / 1) * 1;
  assert(v1(12) === 12 && v1(13) === 13 && v1(16) === 16, 'zoom=1 原样 (12/13/16 不变)');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv339 全部通过');
process.exit(failures ? 1 : 0);
