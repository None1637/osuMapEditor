// 验证器 v49: 选中框缩放 (黄色选择框 + 边/角拖拽手柄, 对齐 lazer SelectionBox/SelectionScaleHandler)
// 运行: cd app && node verifier/v49/check.mjs; node verifier/v49/cdp-v49.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v49/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v49/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('selectionBox.ts: 纯函数模块 (lazer SelectionBoxScaleHandle / OsuSelectionScaleHandler)');
{
  const src = readSrc('src/osu/selectionBox.ts');
  for (const fn of ['selectionScaleQuad', 'displayQuad', 'scaleHandleAnchors', 'hitScaleHandle',
    'dragToScale', 'anchorOpposite', 'anchorAxis', 'minimumEnclosingCircleCenter',
    'clampScaleToPlayfield', 'snapshotScaleStates', 'applyScaleDrag', 'movablePoints'])
    assert(new RegExp(`export function ${fn}`).test(src), `导出 ${fn}`);
  assert(/o\.type !== 'spinner'/.test(src), '转盘排除在缩放/包围盒外 (lazer selectedMovableObjects)');
  assert(/anchor\.includes\('l'\)\) sx = -sx/.test(src) && /anchor\[0\] === 't'\) sy = -sy/.test(src), '上/左边手柄方向取反 (lazer adjustScaleFromAnchor)');
  assert(/shiftLock && isCorner/.test(src), '角手柄 Shift 锁长宽比');
  assert(/resnapSliderLength\(bm, o, beatSnap\)/.test(src), '单滑条缩放后 SnapTo 节拍吸附');
  assert(/inBounds && validLen/.test(src), '单滑条出界/非法 -> 回滚 (lazer isQuadInBounds + HasValidLengthForPlacement)');
  assert(/Math\.max\(rawScale\.x, 1e-6\)/.test(src), '单滑条不允许镜像 (ComponentMax FLOAT_EPSILON)');
}

section('EditorCanvas.tsx: 手柄命中 / 拖拽 / 键盘修饰 / 渲染 / undo');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/scaleDragRef = useRef/.test(src), 'scaleDragRef 拖拽状态');
  assert(/hitScaleHandle\(quads\.q, quads\.dq, p, tol\)/.test(src), 'mousedown 命中手柄 (gate=位置盒, 位置=显示盒)');
  const handleIdx = src.indexOf('hitScaleHandle(quads.q');
  const nodeIdx = src.indexOf('nearestCtrlPoint(ctrl, odx, ody, p)');
  assert(handleIdx > 0 && nodeIdx > 0 && handleIdx < nodeIdx, '手柄命中优先于滑条节点编辑');
  assert(/store\.beginDrag\(\)[\s\S]{0,200}scaleDragRef\.current = \{/.test(src), 'mousedown beginDrag (一次拖拽一次 undo)');
  assert(/applyScaleUpdate\(cp, e\.shiftKey, e\.altKey\)/.test(src), 'mousemove 应用缩放 (modifier 实时)');
  assert(/dragToScale\(sd\.anchor, sd\.quad\.w, sd\.quad\.h/.test(src), '倍率 = dragToScale (1 + 位移/边长)');
  assert(/alt \? sd\.defaultOrigin : anchorOpposite\(sd\.quad, sd\.anchor\)/.test(src), 'Alt=默认原点, 否则对角锚点');
  assert(/addEventListener\('keydown', key\)/.test(src) && /addEventListener\('keyup', key\)/.test(src), '拖拽中 Shift/Alt 按下松开实时重算 (lazer OnKeyDown/OnKeyUp)');
  assert(/moved\) store\.commitDrag\(\); else store\.undo\(\)/.test(src), 'mouseup: 有改动 commit, 无改动弹空快照');
  assert(/#f2b544/.test(src) && /strokeRect\(dq\.x, dq\.y, dq\.w, dq\.h\)/.test(src), '黄色边框渲染 (lazer YellowDark)');
  assert(/fillRect\(hp\.x - s \/ 2/.test(src), '手柄方块渲染在显示框锚点上');
}

if (failures) { console.error(`\nVERIFIER_V49_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V49_ALL_TESTS_PASSED');
