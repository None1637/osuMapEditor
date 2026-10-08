// 验证器 v371: Alt 节点框选收窄 (soulten 反馈) —
//   a) Alt/Shift+Alt 框选只框「第一个框到的滑条」的锚点 (一次几乎不会同时动两条滑条);
//   b) 新增 Alt 点选滑条 (可复选): Alt+点击滑条本体切换点选, 存在点选滑条时框选只框这些滑条;
//      点选滑条画青色虚线控制多边形高亮, 换谱自动清空。
// 运行: node verifier/v371/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v371/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v371/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 纯函数断言 (内部自报 V371_TESTS_*)
fs.unlinkSync(out);

section('nodeSelection.ts: firstFramedSliderId');
{
  const src = read('src/osu/nodeSelection.ts');
  assert(/export function firstFramedSliderId/.test(src), '导出 firstFramedSliderId');
  assert(/Math\.hypot\(p\.x - ox, p\.y - oy\)/.test(src), '按距框选起点最近判定');
}

section('store.ts: altPickSliders 状态');
{
  const src = read('src/osu/store.ts');
  assert(/altPickSliders = new Set<number>\(\);/.test(src), 'altPickSliders 字段');
  assert(/toggleAltPickSlider\(id: number\)/.test(src), 'toggleAltPickSlider (可复选)');
  assert(/clearAltPickSliders\(\)/.test(src), 'clearAltPickSliders');
  assert(/this\.altPickSliders = new Set\(\); \/\/ v371: 换谱清空/.test(src), 'load 换谱清空');
}

section('EditorCanvas.tsx: Alt 点选 + 框选收窄');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert(/firstFramedSliderId/.test(src) && /import \{[^}]*firstFramedSliderId[^}]*\} from '@\/osu\/nodeSelection'/.test(src), '导入 firstFramedSliderId');
  assert(/const hitObj = hitTest\(p\.x, p\.y\);\s*\n\s*if \(hitObj && hitObj\.type === 'slider'\) \{ store\.toggleAltPickSlider\(hitObj\.id\); return; \}/.test(src),
    'Alt+点击滑条本体 = 切换点选 (未命中锚点时)');
  assert(/inRect0\.filter\(\(\[objId\]\) => store\.altPickSliders\.has\(objId\)\)/.test(src),
    '存在点选滑条: 框选只框被点选滑条');
  assert(/inRect0\.some\(\(\[a\]\) => a !== inRect0\[0\]\[0\]\)/.test(src),
    '无点选且框到多条滑条时走 firstFramedSliderId 收窄');
  assert(/if \(store\.altPickSliders\.size\) \{[\s\S]{0,400}?#4df3ff/.test(src), '点选滑条青色虚线高亮块');
  // 高亮块独立于 nodeSelectionCount 门控 (点选后未框节点也要显示)
  const hi = src.indexOf('// v371: Alt 点选滑条高亮');
  const gate = src.indexOf('if (store.nodeSelectionCount) {', src.indexOf('// v117: 选中节点高亮'));
  assert(hi > 0 && gate > 0 && hi > gate && src.slice(gate, hi).includes('g.restore();\n        }'),
    '高亮块在 nodeSelectionCount 门控之外');
}

if (failures) { console.error(`V371 FAILED: ${failures}`); process.exit(1); }
console.log('V371 ALL PASSED');
