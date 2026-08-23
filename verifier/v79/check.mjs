// 验证器 v79: 上方时间轴点击不 seek + 尾圆可命中 (选中/右键删除)
// 运行: cd app && node verifier/v79/check.mjs; node verifier/v79/cdp-v79.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v79/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v79/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('timelineHit.ts: 纯函数命中');
{
  const src = readSrc('src/osu/timelineHit.ts');
  assert(/export function timelineMarkerHit</.test(src), '导出 timelineMarkerHit (泛型)');
  assert(/dTail/.test(src) && /end - o\.time > 1/.test(src), '尾圆同为命中目标');
  assert(/dHead < or \+ 3/.test(src), '像素阈值 rad+3 (v162: 按件半径 or)');
  assert(/export function timelineBarHit</.test(src) && /end - o\.time <= 1/.test(src), 'v80: timelineBarHit 连体条兜底 (排除无时长物件)');
  assert(/o\.time >= bestTime/.test(src), '条重叠时取 time 最晚者 (最上层)');
}

section('Timelines.tsx: 点击不 seek + 接线');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/timelineMarkerHit\(bm\.hitObjects, objEnd, t0, win, r\.width, px, RAD, py, stackGeomOf/.test(src), 'hitTestMarker 走纯函数 (v162: 带堆叠几何)');
  assert(/timelineBarHit\(bm\.hitObjects, objEnd/.test(src), 'v80: 单击/右键落空走连体条兜底 (barHit)');
  const m = src.match(/const finishMarkerDrag = \(\) => \{[\s\S]*?\n  \};/);
  assert(!!m, 'finishMarkerDrag 可定位');
  assert(m && !/store\.seek/.test(m[0]), 'finishMarkerDrag 内无 seek (点击/框选/拖尾单击均不改时间)');
  assert(/if \(!mq\.base\.length && !mq\.baseGreens\.length\) store\.clearSelection\(\)/.test(src), '单击空白落空仅清空选区 (条命中优先; v102 含绿线 base)');
  assert(!/seekFromEvent\(e\)/.test(src.split('export function BottomTimeline')[0]) && /finishMarkerDrag[\s\S]*?store\.clearSelection\(\)/.test(src), 'tick 行点击仅清空选区不 seek (v102: 下半部分单击 = 未拖动框选落空, 同样仅清空; 下方时间轴的 seekFromEvent 不在断言范围)');
  assert(!/e\.buttons === 1 && hitTestMarker/.test(src), '按住拖动 scrub seek 已移除');
  // TopTimeline 不再有 seekFromEvent (BottomTimeline 自有同名函数, 定位 TopTimeline 区段判断)
  const top = src.slice(0, src.indexOf('// 下方全局时间轴'));
  assert(!/const seekFromEvent/.test(top), 'TopTimeline seekFromEvent 已移除');
}

if (failures) { console.error(`\nVERIFIER_V79_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V79_ALL_PASSED');
