// 验证器 v50: 选中框修正 — 缩放钳制用 Begin 盒 (卡住) / 单选单点转盘无框 / 光标形状 / 四角旋转手柄 / 时间轴框选修复
// 运行: cd app && node verifier/v50/check.mjs; node verifier/v50/cdp-v50.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v50/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v50/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('selectionBox.ts: v50 修正与旋转手柄');
{
  const src = readSrc('src/osu/selectionBox.ts');
  assert(/applyScaleDrag\([\s\S]*?originalQuad: Quad/.test(src), 'applyScaleDrag 接收 originalQuad (Begin 包围盒)');
  assert(/clampScaleToPlayfield\(rawScale, origin, originalQuad, axis\)/.test(src), '钳制用 Begin 盒 (lazer OriginalSurroundingQuad), 修复卡住');
  assert(/export function selectionBoxVisible/.test(src) && /movable\[0\]\.type === 'slider'/.test(src), 'selectionBoxVisible: 单选仅滑条/多选才有框');
  assert(/export function rotationHandlePoints/.test(src) && /ROT_HANDLE_OUT = 12\.5/.test(src), '旋转手柄四角外 12.5px (lazer Padding -12.5)');
  assert(/export function hitRotationHandle/.test(src), '导出 hitRotationHandle');
  assert(/export function angleDeltaDeg/.test(src), '导出 angleDeltaDeg (atan2 增量)');
  assert(/ROT_SNAP_STEP = 15/.test(src) && /export function snapRotation/.test(src), 'Shift 吸附 15° (lazer snap_step)');
  assert(/export function rotationOrigin/.test(src), '导出 rotationOrigin (头部 MEC 圆心)');
  assert(/export function applyRotateDrag/.test(src), '导出 applyRotateDrag (头绕原点/控制点绕头)');
}

section('EditorCanvas.tsx: 旋转手柄 / 光标 / 可见性接线');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/rotateDragRef = useRef/.test(src), 'rotateDragRef 拖拽状态');
  const rotIdx = src.indexOf('hitRotationHandle(quads0.dq');
  const sclIdx = rotIdx > 0 ? src.indexOf('hitScaleHandle(quads.q', rotIdx) : -1; // onMouseDown 内顺序 (updateHandleHover 里也有同名调用)
  assert(rotIdx > 0 && sclIdx > rotIdx, '旋转手柄命中优先于缩放手柄');
  assert(/angleDeltaDeg\(rd\.origin, rd\.lastP, p\)/.test(src), '累积角度增量 (lazer rawCumulativeRotation)');
  assert(/snapRotation\(rd\.rawAngle, shift\)/.test(src), 'Shift 吸附 15°');
  assert(/origin: rotationOrigin\(objs\)/.test(src), '旋转原点 = 头部 MEC 圆心');
  assert(/applyScaleDrag\(bm, selectedMovable\(bm\), sd\.states, raw, origin, anchorAxis\(sd\.anchor\), store\.beatSnap, sd\.quad\)/.test(src), '缩放钳制传入 Begin 盒 sd.quad');
  assert(/selectionBoxVisible\(objs\)/.test(src), '框可见性走 selectionBoxVisible');
  assert(/ew-resize/.test(src) && /ns-resize/.test(src) && /nwse-resize/.test(src) && /nesw-resize/.test(src), '缩放手柄光标形状');
  assert(/'grabbing'/.test(src) && /'grab'/.test(src), '旋转手柄 grab 光标');
  assert(/hoverHandleRef/.test(src), '悬停手柄跟踪 (旋转手柄淡入)');
  assert(/rotationHandlePoints\(dq\)/.test(src), '渲染旋转手柄');
}

section('Timelines.tsx: 框选修复 (hitTestMarker 像素阈值)');
{
  const src = readSrc('src/components/Timelines.tsx');
  const hit = readSrc('src/osu/timelineHit.ts'); // v79: 命中逻辑抽为纯函数
  assert(/dHead < or \+ 3/.test(hit), 'hitTestMarker 改像素阈值 (RAD+3; v162: 按件半径 or)');
  assert(!/bestD = win \/ 40/.test(src + hit), '旧 win/40 时间窗已移除');
  assert(/timelineMarkerHit\(bm\.hitObjects, objEnd/.test(src), '按像素距离命中 marker (纯函数接线)');
  assert(!/ms >= o\.time && ms <= end/.test(src + hit), '时长条范围短路已移除 (长滑条条不再抢走空白点击, 框选可达)');
}

if (failures) { console.error(`\nVERIFIER_V50_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V50_ALL_TESTS_PASSED');
