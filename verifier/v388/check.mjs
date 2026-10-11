// 验证器 v388: 数值框滚轮优先调值 + 选中集 B4 一键转贝塞尔
//   1) src/osu/numberWheel.ts (新): window 全局 wheel 监听 (冒泡阶段非 passive), 指针悬停在
//      input[type=number] 上时滚轮改数值并 preventDefault (不滚背景/侧栏); DraftNum (v304) 自带
//      元素级处理先执行, 检查 e.defaultPrevented 跳过不重复; 步长按 step 属性, Shift×10/Alt×0.1,
//      原生 setter + input 事件触发 React onChange; 改键捕获态让位。
//   2) 选中物件含 B<n> 时 Inspector 加「B 样条→贝塞尔」按钮 (单选/多选共用 SliderConvertButtons):
//      convertB4.convertBSplineSlidersToBezier 加 onlyIds 参数; store.convertSelectedBSplineSliders
//      (原地改不换 id, 一次 undo, toast 报告)。
// 运行: node verifier/v388/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v388/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v388/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 纯函数断言 (内部自报 V388_TESTS_*)
fs.unlinkSync(out);

section('numberWheel.ts: 全局数值框滚轮调值');
{
  const src = read('src/osu/numberWheel.ts');
  assert(/export function installNumberWheel\(\)/.test(src), 'installNumberWheel 导出');
  assert(/t instanceof HTMLInputElement\) \|\| t\.type !== 'number'/.test(src), '只作用于 input[type=number]');
  assert(/e\.preventDefault\(\)/.test(src), 'preventDefault 阻止背景/侧栏滚动');
  assert(/e\.defaultPrevented/.test(src), 'DraftNum 已处理的跳过 (不重复加减)');
  assert(/hotkeyCaptureActive\(\)/.test(src), '改键捕获态让位');
  assert(/addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(src), '冒泡阶段非 passive 监听 (晚于 DraftNum 元素级处理)');
  assert(/HTMLInputElement\.prototype, 'value'\)\?\.set/.test(src) && /dispatchEvent\(new Event\('input'/.test(src), '原生 setter + input 事件触发 React onChange');
  assert(/e\.shiftKey \? 10 : e\.altKey \? 0\.1 : 1/.test(src), 'Shift×10 / Alt×0.1 倍率');
  const app = read('src/App.tsx');
  assert(/import \{ installNumberWheel \} from '@\/osu\/numberWheel'/.test(app) && /useEffect\(\(\) => installNumberWheel\(\), \[\]\)/.test(app), 'App 挂载 installNumberWheel');
}

section('convertB4 + store: 选中集转换');
{
  const conv = read('src/osu/convert/convertB4.ts');
  assert(/convertBSplineSlidersToBezier\(bm: Beatmap, onlyIds\?: Set<number>\)/.test(conv), 'onlyIds 可选参数');
  assert(/if \(onlyIds && !onlyIds\.has\(o\.id\)\) continue;/.test(conv), 'onlyIds 过滤');
  const store = read('src/osu/store.ts');
  assert(/convertSelectedBSplineSliders\(\)/.test(store), 'store.convertSelectedBSplineSliders');
  assert(/convertBSplineSlidersToBezier\(bm, this\.selected\)/.test(store), '按选中集转换');
}

section('Inspector: B 样条→贝塞尔按钮 (单选/多选共用)');
{
  const insp = read('src/components/Inspector.tsx');
  assert(/data-conv-apply="b4toB"/.test(insp), '按钮 data-conv-apply=b4toB');
  assert(/selB4 = sliders\.filter\(o => parseBSplineType\(o\.curveType\) !== null\)/.test(insp), 'selB4 过滤 B<n>');
  assert(/store\.convertSelectedBSplineSliders\(\)/.test(insp), '点击调 store.convertSelectedBSplineSliders');
  assert(/inspector\.bspline_to_bezier/.test(insp), 'i18n key 引用');
}

section('i18n: zh-CN 文案');
{
  assert(/'inspector\.bspline_to_bezier'/.test(read('src/i18n/dicts/zh-CN/inspector.ts')), 'inspector.bspline_to_bezier');
}

if (failures) { console.error(`V388 FAILED: ${failures}`); process.exit(1); }
console.log('V388 ALL PASSED');
