// 验证器 v320: F22 — 转盘时长: 最短 1 tick + 时间轴拖右缘改 endTime
//   a) spinnerPlacementEnd 最短时长 1 拍 → 1 个吸附 tick (beatLength/beatSnap)
//   b) 上方时间轴拖转盘右缘改 endTime (stable 同款): hitTestTail 扩到 spinner,
//      spinnerResizeRef 拖拽骨架 (beginDrag/commitDrag/undo), 吸附 snapMs, 最短 1 tick
// 运行: node verifier/v320/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const sp = readSrc('src/osu/sliderPath.ts');
const tl = readSrc('src/components/Timelines.tsx');

section('a) 放置最短时长 = 1 tick');
{
  assert(/Math\.max\(startTime \+ red\.beatLength \/ beatSnap, snapPlacementTime/.test(sp), 'spinnerPlacementEnd 最短 1 tick');
  assert(/v320: F22/.test(sp), '注明 v320');
}

section('b) 时间轴拖转盘右缘');
{
  assert(/spinnerResizeRef = useRef<\{ objId: number; moved: boolean \} \| null>\(null\)/.test(tl), 'spinnerResizeRef 存在');
  assert(/o\.type !== 'slider' && o\.type !== 'spinner'\) continue/.test(tl), 'hitTestTail 扩到转盘');
  const md = tl.match(/if \(o\.type === 'spinner'\) \{[\s\S]{0,400}?store\.canvasDragging = true;\s*return;/);
  assert(!!md && /spinnerResizeRef\.current = \{ objId: tailId, moved: false \}/.test(md[0]) && /store\.beginDrag\(\)/.test(md[0]), 'mousedown: 转盘右缘起手 (选中+快照)');
  const mm = tl.match(/const sr = spinnerResizeRef\.current;[\s\S]{0,800}?\n          \}/);
  assert(!!mm, 'mousemove 分支存在');
  assert(!!mm && /snapMs\(ms\)/.test(mm[0]), '吸附节拍 (snapMs)');
  assert(!!mm && /o\.time \+ red\.beatLength \/ store\.beatSnap/.test(mm[0]), '最短 1 tick (与放置同源)');
  assert(!!mm && /o\.endTime = end; sr\.moved = true; store\.emit\(\);/.test(mm[0]), '实时改 endTime + emit');
  const fin = tl.match(/const srz = spinnerResizeRef\.current;[\s\S]{0,400}?\n    \}/);
  assert(!!fin && /srz\.moved\) \{ store\.commitDrag\(\); return; \}/.test(fin[0]) && /store\.undo\(\);/.test(fin[0]), '收尾: moved=commitDrag 一次 undo, 未移动弹空快照');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv320 全部通过');
process.exit(failures ? 1 : 0);
