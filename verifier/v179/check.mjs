// 验证器 v179: 滚轮 seek — 播放中可用 + 统一 1/beatSnap 网格步进 (seekByBeats, lazer EditorClock.seek 语义)
// 背景: ① 游玩区滚轮被 !store.playing 屏蔽, 播放中无法滚轮改时间;
//       ② 上时间轴滚轮 currentTime±step 不吸附 (播放中连续时间落点在网格外), 底部时间轴固定 len/40 与细分无关
// (v193 修订: 三处滚轮入口收敛到 store.wheelSeek — 暂停分支仍走 seekByBeats 网格吸附, 语义不变)
// 运行: node verifier/v179/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const canvas = read('src/components/EditorCanvas.tsx');
const tl = read('src/components/Timelines.tsx');
const storeSrc = read('src/osu/store.ts');

// 1. 游玩区滚轮: 播放中可用 (v193 起统一走 store.wheelSeek; 暂停分支内部仍是 seekByBeats 网格步进)
const canvasWheel = canvas.slice(canvas.lastIndexOf('onWheel'));
assert(/store\.wheelSeek\(e\.deltaY, e\.deltaMode\)/.test(canvasWheel), '游玩区滚轮走 store.wheelSeek (v193 收敛)');
assert(!/if\s*\(\s*!store\.playing\s*\)/.test(canvasWheel), '游玩区滚轮不再屏蔽播放中 (v179; 注释提及不计)');
assert(!/snapTime\(store\.currentTime \+/.test(canvasWheel), '旧的 ±step+就近吸附 已移除');
assert(/seekByBeats\(bm\.timingPoints, this\.beatSnap, t, dir\)/.test(storeSrc), 'wheelSeek 暂停分支仍走 seekByBeats 网格吸附');

// 2. 上/下时间轴滚轮: 同样收敛到 wheelSeek (各一处), 旧实现移除
const tlSeeks = tl.match(/store\.wheelSeek\(e\.deltaY, e\.deltaMode\)/g) ?? [];
assert(tlSeeks.length === 2, `上+下时间轴滚轮均走 store.wheelSeek (实际 ${tlSeeks.length})`);
assert(!/len \/ 40/.test(tl), '底部时间轴固定 len/40 步进已移除');
assert(!/store\.currentTime \+ \(e\.deltaY > 0 \? step : -step\)/.test(tl), '上时间轴不吸附的 ±step 已移除');

// 3. Ctrl+滚轮缩放时间轴保留 (上时间轴)
assert(/e\.ctrlKey/.test(tl) && /timelineZoom/.test(tl), 'Ctrl+滚轮缩放 TimelineZoom 保留');

console.log(failures ? '\nV179_CHECK_FAILED: ' + failures : '\nV179_CHECK_PASSED');
process.exit(failures ? 1 : 0);
