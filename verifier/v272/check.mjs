// 验证器 v272: 时间轴半透明 alpha 再降 (修复「还是会遮挡物件」)。
// 需求: 用户反馈「上下时间轴还是会遮挡物件, 上时间轴开启波形图后倒是有点透明」(附截图:
//   下时间轴带完全遮住大圆环; 上时间轴波形模式隐约透出物件)。
// 分析: v271 后各模式透过率 — 上时间轴无波形 0.6 / 波形模式 0.6 (0.25 底 × 0.2 暗化 → 0.75*0.8),
//   下时间轴 0.45 (canvas 0.4 × 容器 0.25) — 白色物件理论上可见但仍太暗, 观感=遮挡。
// 修复 (半透明开关「开」时, 「关」保持原值): 全部再降一档 —
//   上时间轴帧填充 0.4→0.15; 下时间轴静态层/无谱面分支 0.4→0.15; 容器 div 0.25→0.1;
//   SelectionInfoPanel 0.4→0.15; 波形底 0.25→0.12; 频谱底 70→40; 暗化层 0.2→0.1。
//   现透过率: 上时间轴无波形 0.85 / 波形模式 0.88*0.9≈0.79 / 下时间轴 0.85*0.9≈0.77。
// 运行: node verifier/v272/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const tl = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
// v284 适配: 开关移除, 全部固定为「开」值
assert(/g\.fillStyle = 'rgba\(12,12,17,0\.15\)'/.test(tl), '上时间轴帧填充 0.15 (v284: 固定)');
assert((tl.match(/fillStyle = 'rgba\(16,16,24,0\.15\)'/g) ?? []).length === 2, '下时间轴两处填充 0.15 (v284: 固定)');
assert(/background: 'rgba\(21,21,32,0\.1\)'/.test(tl), '下时间轴容器 0.1 (v284: 固定)');
assert(/background: 'rgba\(12,12,17,0\.15\)' \}\}/.test(tl), 'SelectionInfoPanel 0.15 (v284: 固定)');
assert(/g\.fillStyle = 'rgba\(8,8,12,0\.1\)'/.test(tl), '暗化层 0.1 (v284: 固定)');
assert(!/timelineTransparent \?/.test(tl), 'v284: 开关三元全部移除');

const wd = fs.readFileSync(path.join(root, 'src/osu/waveformDraw.ts'), 'utf8');
assert(/const waveBg = \(\) => 'rgba\(20,20,20,0\.12\)'/.test(wd), '波形底 0.12 (v284: 固定)');
assert(/const spectroBgAlpha = \(\) => 40/.test(wd), '频谱底 40 (v284: 固定)');

if (failures) { console.error(`\nV272_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV272_ALL_PASSED');
