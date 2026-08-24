// 验证器 v218: 滑条长度按当前节拍细分的 1/2 对齐 (如 1/4 -> 1/8)。
// 规则: 仅当 当前细分×2 存在于配置项 (BEAT_SNAP_OPTIONS = [1,2,3,4,6,8,12,16]) 时才用 ×2 细分,
//       否则退回当前细分 (1/12 -> 1/12, 1/16 -> 1/16)。
// 范围: 吸附细分只在 snapSliderLength 内换算一次, 游玩区放置 (finishSlider/finishFreehand -> placementLength)
//       与上方时间轴放置预览 (pendingSliderTimeline -> placementLength) 及节点编辑重吸附 (resnapSliderLength) 全部共用。
// 不变: 放置时刻 snapPlacementTime 仍按当前细分 (beatSnap), 控制点位置不参与此对齐。
// 运行: node verifier/v218/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('sliderPath.ts: 共享配置项与 1/2 细分换算');
{
  const src = readSrc('src/osu/sliderPath.ts');
  const m = src.match(/export const BEAT_SNAP_OPTIONS = \[([\d,\s]+)\]/);
  assert(!!m, '导出 BEAT_SNAP_OPTIONS 配置项常量');
  const opts = m ? m[1].split(',').map(s => parseInt(s.trim(), 10)) : [];
  assert(JSON.stringify(opts) === JSON.stringify([1, 2, 3, 4, 6, 8, 12, 16]), '配置项 = [1,2,3,4,6,8,12,16] (与原下拉框一致)');
  assert(/export function sliderLengthSnapDivisor\(beatSnap: number\): number/.test(src), '导出 sliderLengthSnapDivisor');
  assert(/const half = beatSnap \* 2;/.test(src), '目标细分 = 当前细分 ×2 (即当前细分的 1/2)');
  assert(/BEAT_SNAP_OPTIONS\.includes\(half\) \? half : beatSnap/.test(src), '×2 不在配置中则退回当前细分');

  // 数值验证: 按源码规则重算映射
  const map = snap => opts.includes(snap * 2) ? snap * 2 : snap;
  const expect = { 1: 2, 2: 4, 3: 6, 4: 8, 6: 12, 8: 16, 12: 12, 16: 16 };
  const bad = Object.entries(expect).filter(([k, v]) => map(+k) !== v);
  assert(bad.length === 0, '映射正确: 1→2, 2→4, 3→6, 4→8, 6→12, 8→16, 12→12(无1/24), 16→16(无1/32)');
  assert(map(5) === 5, '配置外细分 (如 SetupPage 手填 5): 5→5 (10 不在配置中)');
}

section('sliderPath.ts: snapSliderLength 走 1/2 细分, 其余入口共用');
{
  const src = readSrc('src/osu/sliderPath.ts');
  const fn = src.slice(src.indexOf('export function snapSliderLength'), src.indexOf('export function resnapSliderLength'));
  assert(/const div = sliderLengthSnapDivisor\(beatSnap\);/.test(fn), 'snapSliderLength 内换算 1/2 细分');
  assert(/const tickPx = vel \* red\.beatLength \/ div;/.test(fn), 'tick 长按换算后细分计算');
  assert(!/tickPx = vel \* red\.beatLength \/ beatSnap/.test(fn), '长度不再直接按 beatSnap 取 tick');
  assert(/if \(ticks \* tickPx > geometryLength \+ vel \* 1\) ticks -= 1;/.test(fn), '保留 1ms 容差退一格 (不超几何全长)');
  assert(/snapped <= geometryLength \? snapped : Math\.floor\(geometryLength\)/.test(fn), '保留硬钳到几何全长');
  assert(/const snapped = snapSliderLength\(points, currentTime, sliderMultiplier, geometryLength, beatSnap\);/.test(src), 'placementLength 非锁定分支仍走 snapSliderLength (游玩区/时间轴预览共用)');
  assert(/o\.length = snapSliderLength\(bm\.timingPoints, o\.time/.test(src), 'resnapSliderLength (节点编辑重吸附) 共用同一规则');
}

section('不变: 放置时刻/控制点不参与 1/2 对齐');
{
  const src = readSrc('src/osu/sliderPath.ts');
  const fn = src.slice(src.indexOf('export function snapPlacementTime'), src.indexOf('export function spinnerPlacementEnd'));
  assert(/const div = red\.beatLength \/ beatSnap;/.test(fn), 'snapPlacementTime 仍按当前细分 (beatSnap) 吸附放置时刻');
  assert(!/sliderLengthSnapDivisor/.test(fn), '放置时刻不换算 1/2 细分');
}

section('App.tsx: 节拍吸附下拉框共用配置项常量');
{
  const src = readSrc('src/App.tsx');
  assert(/import \{ BEAT_SNAP_OPTIONS \} from '@\/osu\/sliderPath';/.test(src), 'App.tsx 导入共享常量');
  assert(/\{BEAT_SNAP_OPTIONS\.map\(n => <option/.test(src), '下拉框选项来自 BEAT_SNAP_OPTIONS');
  assert(!/\{\[1, 2, 3, 4, 6, 8, 12, 16\]\.map/.test(src), '不再硬编码细分列表 (配置单一来源)');
}

if (failures) { console.error(`V218 FAILED: ${failures}`); process.exit(1); }
console.log('V218 ALL PASSED');
