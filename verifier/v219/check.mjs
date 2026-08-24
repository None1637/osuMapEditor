// 验证器 v219: 滑条长度对齐补漏 —
//   ① 亚 tick (几何不足 1 个长度细分 tick): snapSliderLength 对齐到 1 tick, 允许超几何全长;
//      placementLength 亚 tick 分支不再受 20px 下限 / geoCap 钳制 (否则时间轴预览/落盘退化为不对齐的 floor(几何))。
//   ② 游玩区放置预览: drawPendingSlider 滑条身按 placementLength 吸附后长度截断 (truncatePathAtLength),
//      与 finishSlider 落盘/时间轴预览同一规则; 控制点/连线不截断, 仍随光标实时走。
// 运行: node verifier/v219/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v219/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v219/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// 纯函数测试 (亚 tick 对齐 / placementLength 例外 / 路径截断)
await import('file://' + out);
fs.unlinkSync(out);

section('sliderPath.ts: 亚 tick 对齐接线');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(/if \(ticks === 1 && tickPx > geometryLength \+ vel \* 1\) return Math\.max\(1, snapped\);/.test(src), 'snapSliderLength: 亚 tick 返回 1 tick (允许超几何)');
  assert(/const tickPx = vel \* red\.beatLength \/ sliderLengthSnapDivisor\(beatSnap\);/.test(src), 'placementLength: 用 v218 细分算 tickPx');
  assert(/if \(tickPx > geometryLength \+ vel \* 1\) return snapped;/.test(src), 'placementLength: 亚 tick 跳过 20px 下限/geoCap');
  assert(/return Math\.min\(Math\.max\(20, snapped\), geoCap\);/.test(src), '常规路径钳制不变');
  assert(/export function truncatePathAtLength\(raw: Vec2\[\], length: number\): Vec2\[\]/.test(src), '导出 truncatePathAtLength');
}

section('renderer.ts: 放置预览滑条身按吸附长度截断');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/import \{[^}]*placementLength[^}]*truncatePathAtLength[^}]*\} from '\.\/sliderPath';/.test(src), '导入 placementLength + truncatePathAtLength');
  assert(/renderPlayfield\(rc: RenderCtx, pending\?[^)]*cursor\?[^)]*pendingDistanceLock = false\)/.test(src), 'renderPlayfield 第 4 参 pendingDistanceLock');
  assert(/drawPendingSlider\(rc, pending, cursor \?\? null, pendingDistanceLock\)/.test(src), 'drawPendingSlider 透传 distanceLock');
  assert(/const expected = placementLength\(bm\.timingPoints, time, bm\.difficulty\.sliderMultiplier,\s*\n?\s*computed\.length, distanceLock, bm\.editor\.distanceSpacing, bm\.editor\.beatDivisor\)/.test(src), '预览预期长度 = placementLength (与落盘同规则)');
  assert(/sliderBodySprite\(truncatePathAtLength\(raw, expected\)/.test(src), '滑条身按吸附长度截断');
}

section('EditorCanvas.tsx: 调用点传 distanceLock');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/: null, store\.distanceLock\);/.test(src), 'renderPlayfield 调用传 store.distanceLock');
}

if (failures) { console.error(`V219 FAILED: ${failures}`); process.exit(1); }
console.log('V219 ALL PASSED');
