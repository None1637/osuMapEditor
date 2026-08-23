// v102 源码接线断言: 时间轴下半框选/边缘滚动/绿线选择拖拽/复制粘贴
// 运行: node verifier/v102/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const tl = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
const sel = fs.readFileSync(path.join(root, 'src/osu/timelineSelect.ts'), 'utf8');

// timelineSelect 纯函数模块
assert(/EDGE_TOLERANCE_PX = 40/.test(sel) && /EDGE_MAX_VELOCITY = 10/.test(sel) && /EDGE_RAMP_MS = 5000/.test(sel),
  'timelineSelect: lazer handleScrollViaDrag 常量 40/10/5000');
assert(/export function edgeScrollVelocity/.test(sel) && /export function marqueeObjectIds/.test(sel)
  && /export function marqueeGreenTimes/.test(sel) && /export function bandHit/.test(sel),
  'timelineSelect: 四个纯函数导出');

// Timelines 接线
assert(/from '@\/osu\/timelineSelect'/.test(tl), 'Timelines: 引入 timelineSelect');
assert(/tAnchor: store\.currentTime - win \/ 2 \+ \(px \/ r\.width\) \* win/.test(tl), 'Timelines: 框选锚定按下时刻 (lazer TimelineDragBox)');
assert(!/e\.clientY - r\.top <= OBJ_H\)[\s\S]{0,80}marqueeRef\.current = \{/.test(tl), 'Timelines: 框选不再限物件行内起手 (全高度)');
assert(/edgeScrollVelocity\(mq\.x1, r\.width\)/.test(tl), 'Timelines: 边缘滚动基础速度');
assert(/edgeScrollRamp\(mq\.scrollAccum\)/.test(tl), 'Timelines: ramp 在速度非 0 时累计 (防 ramp=0 死锁)');
assert(/store\.seek\(t \+ v \* edgeScrollRamp\(mq\.scrollAccum\) \* dtMs \* \(win \/ r\.width\)\)/.test(tl), 'Timelines: 边缘滚动换算谱面时间');
assert(/marqueeObjectIds\(bm\.hitObjects, objEnd, msA, msB\)/.test(tl), 'Timelines: 框选物件走纯函数');
assert(/marqueeGreenTimes\(bm\.timingPoints, msA, msB\)/.test(tl), 'Timelines: 框选绿线走纯函数');
assert(/store\.selectWithGreens\(\[\.\.\.mq\.base, \.\.\.objIds\], \[\.\.\.mq\.baseGreens, \.\.\.greens\]\)/.test(tl), 'Timelines: 框选同时设物件+绿线 (含 base)');
assert(/PILL_LIME, store\.selectedGreenLines\.has\(p\.time\)\)/.test(tl), 'Timelines: 选中绿线黄描边');
assert(/greenDragRef\.current = \{ tp: pill\.tp/.test(tl), 'Timelines: 绿线按住预备拖拽');
assert(/snapMs\(gd\.origTime/.test(tl), 'Timelines: 绿线拖拽吸附节拍');
assert(/window\.addEventListener\('mousemove', move\)/.test(tl), 'Timelines: window 兜底移动 (拖出边界继续跟踪)');
assert(/const hitTestTimingPill = \(e: React\.MouseEvent\): \{ idx: number; tp: TimingPoint \} \| null/.test(tl), 'Timelines: 药丸命中返回 {idx,tp}');

// store 接线
assert(/selectedGreenLines = new Set<number>\(\)/.test(store), 'store: selectedGreenLines 字段');
assert(/selectGreenLines\(times: number\[\], additive = false\)/.test(store), 'store: selectGreenLines');
assert(/selectWithGreens\(ids: number\[\], greenTimes: number\[\]\)/.test(store), 'store: selectWithGreens');
assert(/private clipboardGreens: TimingPoint\[\] = \[\]/.test(store), 'store: 绿线剪贴板');
assert(/this\.clipboardGreens = deepCopy\(greens\)\.map\(tp => \(\{ \.\.\.tp, time: tp\.time - t0 \}\)\)/.test(store), 'store: copy 绿线时间相对化');
assert(/Object\.assign\(existing, deepCopy\(c\), \{ time: t \}\)/.test(store), 'store: 粘贴覆盖同时刻绿线');
assert(/if \(!this\.beatmap \|\| \(!this\.clipboard\.length && !this\.clipboardGreens\.length\)\) return/.test(store), 'store: 纯绿线也可粘贴');
assert(/this\.selected\.clear\(\); this\.selectedGreenLines\.clear\(\);/.test(store), 'store: 非加选 select 同时清空绿线');

if (failures) { console.error(`\nV102_CHECK_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV102_CHECK_PASSED');
