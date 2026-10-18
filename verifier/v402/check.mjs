// 验证器 v402: 关「打击动画」(暂留模式) 下滑条锚点可交互时间范围异常变大
// 根因: 锚点交互候选 (Alt 点选/框选/hover/整组拖/未选滑条锚点按下) 用 isVisibleAt 过滤,
//   暂留模式 (点击特效开+打击动画关) 下 isVisibleAt 为头/尾圈渲染残留放到 end+HIT_LINGER(800ms),
//   而滑条身 end+HIT_FADE(240ms) 已消失 — 锚点不可见却仍能被框选/点选 (soulten 反馈)。
// 修复: lifecycle.ts 新增 sliderAnchorInteractiveAt (= [time-preempt, end+HIT_FADE], 与 v342
//   hover 预览渲染门控同窗), EditorCanvas 锚点候选过滤全部改用之; isVisibleAt 渲染窗口不变。
// 运行: cd app && node verifier/v402/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v402/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v402/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('lifecycle.ts: sliderAnchorInteractiveAt');
{
  const src = readSrc('src/osu/lifecycle.ts');
  assert(/export function sliderAnchorInteractiveAt\(bm: Beatmap, o: HitObject, time: number\): boolean/.test(src), 'sliderAnchorInteractiveAt 导出');
  assert(/sliderAnchorInteractiveAt[\s\S]*?return time >= o\.time - preempt && time <= hitObjectEndTime\(bm, o\) \+ HIT_FADE;/.test(src),
    '窗口 = [time-preempt, end+HIT_FADE] (无 HIT_LINGER 分支)');
  assert(/v402/.test(src), 'v402 版本注释');
  // isVisibleAt 渲染窗口不受影响 (v147/v215 暂留延长保留)
  assert(/const linger = \(o\.type === 'circle' \|\| o\.type === 'slider'\) && displaySettings\.hitExplosion && !displaySettings\.hitAnimation \? HIT_LINGER : HIT_FADE;/.test(src),
    'isVisibleAt 暂留延长保留 (渲染窗不变)');
}

section('EditorCanvas.tsx: 锚点候选过滤改用锚点窗口');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  const n = (src.match(/sliderAnchorInteractiveAt\(bm, o, store\.currentTime\) \|\| store\.selected\.has\(o\.id\) \|\| store\.selectedNodes\.has\(o\.id\)/g) ?? []).length;
  assert(n === 6, `锚点候选 6 处全部改用 sliderAnchorInteractiveAt (实际 ${n}: playfieldNodePress/nodeAltPress/nodeGroupDragPress/singleSliderNodePress(v410)/unselectedSliderNodePress/hoverNode)`); // v410: 单滑条点选候选 +1 (5→6)
  assert(!/isVisibleAt\(bm, o, store\.currentTime\) \|\| store\.selected\.has\(o\.id\) \|\| store\.selectedNodes/.test(src),
    '锚点候选不再用 isVisibleAt (残留窗)');
  assert(/const sliders = bm\.hitObjects\.filter\(o => o\.type === 'slider' && sliderAnchorInteractiveAt\(bm, o, store\.currentTime\)\); \/\/ v402/.test(src),
    '节点框选 candidates 改用锚点窗口');
  assert(/return !!o && !sliderAnchorInteractiveAt\(bm, o, store\.currentTime\);/.test(src),
    '框选 keepNodes 保留例外同口径 (v277)');
  // v467: hitTest 物件级过滤也收紧 — 滑条走 objectSelectableAt (= 锚点窗口), 单点/转盘仍 isVisibleAt
  assert(/const objs = bm\.hitObjects\.filter\(o => objectSelectableAt\(bm, o, store\.currentTime\) \|\| store\.selected\.has\(o\.id\)\);/.test(src),
    'hitTest 物件级过滤走 objectSelectableAt (v467: 滑条同锚点窗口, 其余 isVisibleAt)');
}

if (failures) { console.error(`V402 FAILED (${failures})`); process.exit(1); }
console.log('V402 ALL PASSED');
