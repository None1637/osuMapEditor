// 验证器 v404: 交互优先级 — 滑条锚点 > 可交互UI > 物件 > 不可交互UI
// 背景: v378 让四侧 UI 下物件完整穿透 (含时间轴), 导致点下方时间轴选中物件而不是跳转 (None1637);
//   soulten 定优先级: 只有滑条锚点无视所有 UI; 物件仅在不可交互 UI (快捷键注释等) 下可穿透拖拽。
// 改动: store 新增 playfieldAnchorPress (锚点级链: Alt 切换/框选 → 整组拖 → 单滑条锚点 → 未选滑条锚点,
//   不含旋转/缩放手柄与物件本体); EditorCanvas 捕获拦截对 data-ui-interactive 容器只放锚点级穿透,
//   data-ui-pass (快捷键注释) 维持物件穿透; TopTimeline 改问 anchorPress; App 四侧容器标 data-ui-interactive。
// 运行: cd app && node verifier/v404/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts: playfieldAnchorPress 桥字段');
{
  const src = readSrc('src/osu/store.ts');
  assert(/playfieldAnchorPress: \(\(clientX/.test(src), 'playfieldAnchorPress 声明');
  assert(/滑条锚点 > 可交互UI > 物件 > 不可交互UI/.test(src), '优先级注释');
}

section('EditorCanvas.tsx: 锚点级穿透注册');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  const ap = src.match(/store\.playfieldAnchorPress = \(cx, cy, mods\) => \{[\s\S]{0,2200}?\n    \};/)?.[0] ?? ''; // v411: Alt 分支加命中预检, 窗口 1200→2200
  assert(ap.length > 0, '注册 playfieldAnchorPress');
  assert(/nodeAltPress\(p, mods\)/.test(ap), '含 Alt 锚点切换/框选');
  assert(/nodeGroupDragPress\(p\)/.test(ap), '含已选节点整组拖');
  assert(/singleSliderNodePress\(p, mods(, \{ allowBlankInsert: false \})?\)/.test(ap), '含选中单滑条锚点编辑 (v496: 穿透路径传 allowBlankInsert:false, UI 上 Ctrl 不空白插点)');
  assert(/unselectedSliderNodePress\(p, mods\)/.test(ap), '含未选滑条锚点');
  assert(!/selectionHandlePress/.test(ap) && !/objectPress/.test(ap), '不含手柄/物件本体 (可交互 UI 功能优先)');
  assert(/store\.playfieldAnchorPress = null/.test(src), '卸载清理');
}

section('EditorCanvas.tsx: 捕获拦截优先级');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  const onDown = src.match(/const onDown = \(e: MouseEvent\) => \{[\s\S]{0,1400}?\n    \};/)?.[0] ?? '';
  assert(onDown.length > 0, 'onDown 捕获拦截存在');
  assert(onDown.indexOf('anchorFirst') < onDown.indexOf("el.closest('button"), '锚点 > 控件 (v378 不变)');
  assert(/!\[data-ui-pass\]/.test(onDown) === false || /!el\.closest\('\[data-ui-pass\]'\)/.test(onDown), 'data-ui-pass 豁免 (不可交互 UI 物件可穿透)');
  assert(/el\.closest\('\[data-ui-interactive\]'\)/.test(onDown), '可交互 UI 判定');
  const iui = onDown.indexOf("[data-ui-interactive]");
  const np = onDown.indexOf('store.playfieldNodePress?.(');
  assert(iui > 0 && np > iui, '可交互 UI 判定先于物件完整穿透链');
  assert(/playfieldAnchorPress\?\.\(e\.clientX, e\.clientY, e\)/.test(onDown), '可交互 UI 上只放锚点级穿透');
}

section('Timelines.tsx / App.tsx: 接线与标记');
{
  const tl = readSrc('src/components/Timelines.tsx');
  assert(/store\.playfieldAnchorPress\?\.\(e\.clientX, e\.clientY, e\)\) return/.test(tl), 'TopTimeline 改锚点级穿透');
  assert(!/store\.playfieldNodePress\?\.\(e\.clientX, e\.clientY, e\)\) return/.test(tl), 'TopTimeline 不再物件级穿透');
  const app = readSrc('src/App.tsx');
  // v426 适配: 右栏改 style width:224/uiZoom 后 data-ui-interactive 属性后换行接 style, 断言放宽为 [\s>]
  const n = (app.match(/pointer-events-auto" data-ui-interactive[\s>]/g) ?? []).length;
  assert(n === 4, `四侧容器标 data-ui-interactive (实际 ${n}: 上时间轴行/左栏/右栏/底栏)`);
  assert(/data-ui-pass/.test(app), '快捷键注释标 data-ui-pass (物件可穿透)');
}

section('验证器适配标注');
{
  assert(/v404/.test(readSrc('verifier/v360/check.mjs')), 'v360 check 已适配 (TopTimeline 锚点级)');
  assert(/v404/.test(readSrc('verifier/v378/check.mjs')), 'v378 check 已适配 (onDown 窗口)');
}

if (failures) { console.error(`V404 FAILED (${failures})`); process.exit(1); }
console.log('V404 ALL PASSED');
