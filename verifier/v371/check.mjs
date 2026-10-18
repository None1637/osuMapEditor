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

section('store.ts: altPickSliders 已移除 (v459)');
{
  const src = read('src/osu/store.ts');
  // v459: v453 只删显示后判定仍在, soulten/None1637 确认判定也不用留 — Alt 点选机制整体移除
  assert(!/altPickSliders/.test(src) && !/toggleAltPickSlider|clearAltPickSliders/.test(src), 'v459: altPickSliders 状态/方法全删');
}

section('EditorCanvas.tsx: 框选收窄 (v459 起仅剩 v440 已选滑条 + v371b 第一框到)');
{
  const src = read('src/components/EditorCanvas.tsx');
  assert(/firstFramedSliderId/.test(src) && /import \{[^}]*firstFramedSliderId[^}]*\} from '@\/osu\/nodeSelection'/.test(src), '导入 firstFramedSliderId');
  assert(!/toggleAltPickSlider/.test(src), 'v459: Alt+点击滑条本体切换点选分支已删 (未命中锚点 = 起节点框选)');
  assert(!/altPickSliders/.test(src), 'v459: altPick 收窄分支已删');
  assert(/inRect0\.some\(\(\[a\]\) => a !== inRect0\[0\]\[0\]\)/.test(src),
    '框到多条滑条时走 firstFramedSliderId 收窄 (v371b 保留)');
  // v453/v459: 渲染层不得再画 altPick 高亮
  assert(!/#4df3ff/.test(src.match(/if \(store\.nodeSelectionCount\) \{[\s\S]*?\n        \}/)?.[0] ?? ''), 'v453: 点选滑条青色虚线高亮块已移除');
}

if (failures) { console.error(`V371 FAILED: ${failures}`); process.exit(1); }
console.log('V371 ALL PASSED');
