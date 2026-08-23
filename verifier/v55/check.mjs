// 验证器 v55: 物件吸附 (lazer 6.4px) + Ctrl+方向键逐 px 移动 + Prev/Next (px) 显示
// 运行: cd app && node verifier/v55/check.mjs; node verifier/v55/cdp-v55.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v55/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v55/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('objectSnap.ts: lazer TrySnapToNearbyObjects');
{
  const src = readSrc('src/osu/objectSnap.ts');
  assert(/OBJECT_SNAP_RADIUS = 6\.4/.test(src), '阈值 6.4 osu px');
  assert(/export function objectSnapPoints/.test(src), '目标点集合 (中心+滑条尾)');
  assert(/export function snapToNearby/.test(src) && /d < bestD/.test(src), '严格小于判定');
  assert(/export function snapDragDelta/.test(src), '拖拽位移修正');
}

section('EditorCanvas.tsx: 放置/拖拽吸附接线 (物件吸附 > 锁定间距)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/import \{ objectSnapPoints, snapToNearby, snapDragDelta(, type Pt)? \} from '@\/osu\/objectSnap'/.test(src), '引入 objectSnap');
  const iNear = src.indexOf('snapToNearby(p, objectSnapPoints');
  const iLock = src.indexOf("if (!store.distanceLock || bm.editor.distanceSpacing <= 0) return gridSnapAt(bm, p);");
  assert(iNear > 0 && iLock > 0 && iNear < iLock, 'snapPlacement 先物件吸附后锁定间距');
  assert(/snapDragDelta\(dragPts, targets, dx, dy\)/.test(src), '拖拽移动应用 snapDragDelta');
  assert(/new SliderPath\(o\.curveType \?\? 'L', \[\{ x: orig\.x, y: orig\.y \}/.test(src), '拖拽滑条尾用快照几何');
  assert(/isVisibleAt\(bm, o, store\.currentTime\)/.test(src), '目标限可见物件 (lazer alive blueprints)');
}

section('store.ts + App.tsx: Ctrl+方向键逐 px 移动');
{
  const src = readSrc('src/osu/store.ts');
  assert(/nudgeSelectedPosition\(dx: number, dy: number\)/.test(src), 'nudgeSelectedPosition');
  assert(/this\.pushUndo\(\)[\s\S]{0,200}o\.x \+= dx; o\.y \+= dy/.test(src), '一次按键一次 undo + 位置平移');
  const app = readSrc('src/App.tsx');
  const iNudge = app.indexOf('store.nudgeSelectedPosition(v[0], v[1])');
  const iSeek = app.indexOf("if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')");
  assert(iNudge > 0 && iSeek > 0 && iNudge < iSeek, 'Ctrl+方向键 nudge 在时间 seek 处理器之前');
  assert(/e\.ctrlKey \|\| e\.metaKey/.test(app) && /store\.selected\.size/.test(app), '有选区时优先生效');
}

section('Timelines.tsx: Prev/Next 格式 "{n}x({px}px)"');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/\$\{info\.prev\.toFixed\(2\)\}x\(\$\{info\.prevPx\}px\)/.test(src), 'Prev 格式');
  assert(/\$\{info\.next\.toFixed\(2\)\}x\(\$\{info\.nextPx\}px\)/.test(src), 'Next 格式');
}

if (failures) { console.error(`\nVERIFIER_V55_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V55_ALL_TESTS_PASSED');
