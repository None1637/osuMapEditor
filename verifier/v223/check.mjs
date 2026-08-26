// 验证器 v223: 游玩区平移/缩放 — 左侧栏开关 + x/y/scale 输入框; 开启后按住鼠标中键拖动游玩区域。
// 变换: playfieldTransform = 适配变换上叠加偏移 (osu px, 不随用户倍率放大) 与缩放倍率,
//       等价 translate(ox,oy) scale(base) translate(panX,panY) scale(s); 渲染/命中/toOsu/__osuToClient 共用。
// 关闭时 playfieldTransform 退回默认适配视图 (已设值保留, 不写入谱面)。
// 运行: node verifier/v223/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('store.ts: 视图状态字段');
{
  const src = readSrc('src/osu/store.ts');
  assert(/playfieldPanEnabled = false;/.test(src), '开关默认关');
  assert(/playfieldPanX = 0;/.test(src) && /playfieldPanY = 0;/.test(src), 'x/y 偏移默认 0');
  assert(/playfieldScale = 1\.0;/.test(src), '缩放倍率默认 1.0');
}

section('EditorCanvas.tsx: playfieldTransform 叠加变换');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/function playfieldTransform\(/.test(src), '导出 playfieldTransform 包装');
  assert(/if \(!store\.playfieldPanEnabled \|\| !\(s > 0\)\) return base;/.test(src), '关闭/非法倍率时退回适配视图');
  assert(/scale: base\.scale \* s,/.test(src), '缩放倍率叠乘');
  assert(/ox: base\.ox \+ base\.scale \* store\.playfieldPanX,/.test(src), 'x 偏移按基础适配 scale 换算 (osu px)');
  assert(/oy: base\.oy \+ base\.scale \* store\.playfieldPanY,/.test(src), 'y 偏移同上');
  const n = (src.match(/playfieldTransform\(/g) ?? []).length;
  assert(n === 8, `渲染/命中/toOsu/__osuToClient/__osuToCanvas/容差共用 (定义 1 + 调用 7; 实际 ${n})`);
  assert(!/const \{ scale, ox, oy \} = viewTransform\(r\);/.test(src), '调用点不再绕过平移/缩放');
}

section('EditorCanvas.tsx: 中键拖动');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/e\.button === 1 && store\.playfieldPanEnabled/.test(src), '中键 + 开关启用才触发');
  assert(/e\.preventDefault\(\);/.test(src), 'preventDefault 阻止中键自动滚动');
  assert(/panDragRef\.current = \{ sx: e\.clientX, sy: e\.clientY, px: store\.playfieldPanX, py: store\.playfieldPanY \}/.test(src), '记录拖拽起点与起始偏移');
  assert(/store\.playfieldPanX = panDragRef\.current\.px \+ \(e\.clientX - panDragRef\.current\.sx\) \/ z \/ base\.scale;/.test(src), '拖动: 视觉位移 / uiZoom / 基础 scale -> osu px');
  assert(/store\.playfieldPanY = panDragRef\.current\.py \+ \(e\.clientY - panDragRef\.current\.sy\) \/ z \/ base\.scale;/.test(src), 'y 同上 (不除用户倍率, 内容 1:1 跟随光标)');
  assert(/if \(panDragRef\.current\) \{\s*\/\/ v223: 中键平移收尾/.test(src), 'onMouseUp 收尾清 ref');
  assert(/symPointDragRef\.current = 0; panDragRef\.current = null; finishHandleDrag\(\);/.test(src), 'window mouseup 兜底清 ref (拖出画布松开)');
}

section('App.tsx: 左侧栏开关 + x/y/scale 输入框');
{
  const src = readSrc('src/App.tsx');
  assert(/function PanNumInput\(/.test(src), 'PanNumInput 模块级定义 (v41: 组件内定义会重挂载失焦)');
  assert(/data-pan-input="toggle"/.test(src), '开关按钮 (data-pan-input=toggle)');
  assert(/store\.playfieldPanEnabled = !store\.playfieldPanEnabled/.test(src), '开关切换 store');
  assert(/data-pan-input=\{label\}/.test(src), '输入框带 data-pan-input (x/y/scale, CDP 可测)');
  assert(/<PanNumInput label="x"/.test(src) && /<PanNumInput label="y"/.test(src) && /<PanNumInput label="缩放"/.test(src), 'x/y/缩放 三个输入框 (v224: scale 改名缩放)');
  assert(/min=\{0\.1\} max=\{10\}/.test(src), 'scale 钳 0.1..10');
  assert(/value=\{text \?\? String\(value\)\}/.test(src) && /onBlur=\{\(\) => setText\(null\)\}/.test(src), '局部文本态: 拖动中实时刷新, 失焦还原');
}

if (failures) { console.error(`V223 FAILED: ${failures}`); process.exit(1); }
console.log('V223 ALL PASSED');
