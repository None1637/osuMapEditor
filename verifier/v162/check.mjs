// 验证器 v162: 上方时间轴同刻物件按文件顺序从下往上堆叠 (渲染 + 命中跟随)
// 运行: node verifier/v162/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v162/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v162/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V162_TESTS_*)
fs.unlinkSync(out);

section('timelineHit.ts: stackInfo / stackLayout + 命中扩展');
{
  const src = readSrc('src/osu/timelineHit.ts');
  assert(/export function stackInfo/.test(src), '导出 stackInfo');
  assert(/export function stackLayout/.test(src), '导出 stackLayout');
  assert(/counts\.get\(o\.time\)/.test(src), '按 time 分组计数');
  assert(/Math\.hypot\(dx, gm\.y - py\)/.test(src), 'markerHit 堆叠件 2D 距离');
  assert(/Math\.abs\(py - gm\.y\) > gm\.rad/.test(src), 'barHit 条带垂直厚度 = 堆叠半径');
  // 向后兼容: py/geom 为可选参数 (旧 7 参调用不变)
  assert(/py\?: number, geom\?: \(o: T\)/.test(src), 'markerHit 可选参数 (旧调用兼容)');
}

section('Timelines.tsx: 渲染堆叠');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/const stacks = stackInfo\(drawList\);/.test(src), '绘制前计算堆叠信息');
  assert(/drawTimelineObject\(g, sx, ex, lay\.yOf\(si\.level\), lay\.rad,/.test(src), '按堆叠位置/半径绘制');
  assert(/const stackGeomOf = /.test(src), 'stackGeomOf: 非堆叠 undefined (旧 x-only 行为)');
}

section('Timelines.tsx: 命中跟随 (4 处)');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/timelineMarkerHit\(bm\.hitObjects, objEnd, t0, win, r\.width, px, RAD, py, stackGeomOf/.test(src), 'hitTestMarker 传 py + 堆叠几何');
  assert(/Math\.hypot\(dx, stackLayout\(si\.count, OBJ_H, RAD\)\.yOf\(si\.level\) - py\)/.test(src), '滑条尾端堆叠 2D 命中');
  const barCalls = src.match(/timelineBarHit\([^\n]*?stackGeomOf\(stackInfo\(/g) ?? []; // v217 起坐标包 zoomClientX(...) 有嵌套括号, [^)]* 会漏匹配, 改按单行匹配
  assert(barCalls.length === 3, `三处 barHit 调用点都传堆叠几何 (单击兜底/mousedown 中段/右键; 实际 ${barCalls.length})`);
}

console.log(failures ? `\nV162 FAILED: ${failures}` : '\nV162 ALL PASSED');
process.exit(failures ? 1 : 0);
