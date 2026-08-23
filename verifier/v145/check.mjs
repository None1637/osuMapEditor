// 验证器 v145: ① 锁定间距修复 — 放置参考滑条结束时刻/尾端 (原误用开始时刻/头部), 滑条头放置走锁定间距,
//              拖动物件投影到锁定间距圆 (lazer CircularDistanceSnapGrid), 指示线从滑条尾端画
//            ② 间距面板实时更新 — 拖动末尾 emitSelection + 放置预览 placementPreview
// 运行: node verifier/v145/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v145/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v145/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V145_TESTS_*)
fs.unlinkSync(out);

section('spacing.ts: 锁定间距共享纯函数');
{
  const src = readSrc('src/osu/spacing.ts');
  assert(/export function distanceLockRef\(bm: Beatmap, time: number, exclude\?: ReadonlySet<number>\)/.test(src), 'distanceLockRef 导出 (time + exclude)');
  assert(/hitObjectEndTime\(bm, o\)/.test(src), '参考时刻 = 物件结束时刻 (滑条含时长, 修复 endTime bug)');
  assert(/path\.positionAt\(\(o\.slides \?\? 1\) % 2 === 0 \? 0 : \(o\.length \?\? path\.totalLength\)\)/.test(src), '滑条结束位置按折返奇偶取头/尾');
  assert(/export function distanceLockDistance\(bm: Beatmap, endTime: number, time: number\)/.test(src), 'distanceLockDistance 导出');
  assert(/Math\.max\(0, \(time - endTime\) \/ red\.beatLength\)/.test(src), '拍数下限 0 (v211: 移除 0.25 下限, 对齐 lazer 无下限)');
  assert(/return distanceSnapPxPerBeat\(bm, endTime\) \* beats;/.test(src), '期望距离 = DS*100*SM*SV * 拍数 (v149: 随 SV, lazer DurationToDistance 同源)');
  assert(/export function previewSpacingInfo\(bm: Beatmap, p: \{ x: number; y: number \}, time: number\)/.test(src), 'previewSpacingInfo 导出');
}

section('EditorCanvas: 放置锁定间距修复 (snapPlacement 复用共享纯函数)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(!src.includes('(o.endTime ?? o.time) <='), '不再用 (o.endTime ?? o.time) 找参考件 — 滑条结束时刻 bug 已修');
  assert(/import \{ distanceLockRef, distanceLockDistance \} from '@\/osu\/spacing';/.test(src), '导入共享纯函数');
  assert(/const ref = distanceLockRef\(bm, store\.currentTime\);/.test(src), 'snapPlacement 参考件走 distanceLockRef');
  assert(/const dist = distanceLockDistance\(bm, ref\.endTime, store\.currentTime\);/.test(src), 'snapPlacement 期望距离走 distanceLockDistance');
  // v55 旧断言保持: 物件吸附优先于锁定间距
  const iNear = src.indexOf('if (near) return gridSnapAt(bm, near);');
  const iLock = src.indexOf('if (!store.distanceLock || bm.editor.distanceSpacing <= 0) return gridSnapAt(bm, p);');
  assert(iNear >= 0 && iLock > iNear, 'v55 保持: 物件吸附先于锁定间距');
  // 指示线从参考件结束位置画
  assert(/g\.moveTo\(ref\.endX, ref\.endY\)/.test(src), '锁定间距指示线从参考件结束位置 (滑条尾端) 画起');
  // 滑条头放置走 snapPlacement
  assert(/const sp0 = isHead \? snapPlacement\(p\)/.test(src), '滑条头部放置走 snapPlacement (锁定间距生效)');
  // v207: 控制点公式收敛到 snapSliderCtrlPoint — 内部仍是 物件吸附+辅助线 > 网格, 不走锁定间距
  assert(/: snapSliderCtrlPoint\(p\); \/\/ v207/.test(src), '滑条控制点走 snapSliderCtrlPoint (v207 收敛)');
  assert(/const snapSliderCtrlPoint[\s\S]{0,260}?gridSnapAt\(bm0, snapWithGeo\(bm0, p, snapToNearby/.test(src), 'snapSliderCtrlPoint 内部维持原规则 (不走锁定间距)');
}

section('EditorCanvas: 拖拽锁定间距投影 (间距辅助之后, 网格之前)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  const iGeoDist = src.indexOf('v134: 拖拽吸附间距辅助线');
  const iLock = src.indexOf('v145: 拖拽锁定间距');
  const iGrid = src.indexOf('v56: 网格吸附 (lazer TryMoveBlueprints');
  assert(iLock > iGeoDist && iGrid > iLock, '顺序: 间距辅助线 < 锁定间距投影 < 网格吸附');
  assert(/const ref = distanceLockRef\(bm, anchor\.time, new Set\(d\.ids\)\);/.test(src), '参考件排除被拖物件, 时刻取锚件开始时间');
  assert(/dx = Math\.round\(ref\.endX \+ rx \/ rl \* dist - aOrig\.x\);/.test(src), '锚头投影到期望距离圆上 (多选同 delta)');
}

section('EditorCanvas + store: 间距面板实时更新');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/if \(d\.moved\) store\.emitSelection\(\);/.test(src), '拖动末尾 emitSelection (拖动中面板实时刷新)');
  assert(/store\.setPlacementPreview\(snapPlacement\(\{ x: cp\.x, y: cp\.y \}\)\)/.test(src), 'onMouseMove 写放置预览 (与画布幻影同走 snapPlacement)');
  assert(/store\.tool === 'circle' \|\| \(store\.tool === 'slider' && store\.pendingSlider\.length === 0\)/.test(src), '仅圆圈/滑条无锚点时预览');
  // v163 适配: 区外置空条件改为 (inside || !limitToPlayfield) — 关闭"限制物件在游玩区域内"后区外也显示预览
  assert(/!store\.playing && !store\.canvasDragging && \(cursorRef\.current\.inside \|\| !store\.limitToPlayfield\)/.test(src), '拖拽/播放/区外时置空 (v163: 关闭限制后区外也预览)');
  const st = readSrc('src/osu/store.ts');
  assert(/placementPreview: \{ x: number; y: number \} \| null = null;/.test(st), 'store.placementPreview 字段');
  assert(/setPlacementPreview\(p: \{ x: number; y: number \} \| null\)/.test(st), 'setPlacementPreview 方法');
  assert(/if \(!q && !cur\) return;/.test(st) && /if \(q && cur && q\.x === cur\.x && q\.y === cur\.y\) return;/.test(st), '相同值不重复 emit (防重渲染风暴)');
}

section('SelectionInfoPanel: 放置预览间距显示');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/import \{ selectionSpacingInfo, previewSpacingInfo \} from '@\/osu\/spacing';/.test(src), '导入 previewSpacingInfo');
  assert(/const pv = !info && bm && store\.placementPreview \? previewSpacingInfo\(bm, store\.placementPreview, store\.currentTime\) : null;/.test(src), '无选区时显示放置预览间距 (time = currentTime)');
  assert(src.includes('selectionSpacingInfo(bm, store.selected)'), 'v45 保持: 选中间距仍走 selectionSpacingInfo');
}

section('回归: v45/v55 旧断言仍成立');
{
  const sp = readSrc('src/osu/spacing.ts');
  assert(/distPx \/ \(distanceSnapPxPerBeat\(bm, fromEndTime\) \* beats\)/.test(sp), 'v45: 间距倍率公式 (v149 起基准含 SM*SV)');
  assert(/export function selectionSpacingInfo/.test(sp), 'v45: selectionSpacingInfo 保留');
}

if (failures) { console.error(`\nV145_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV145_ALL_PASSED');
