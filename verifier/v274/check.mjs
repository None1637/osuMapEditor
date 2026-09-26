// 验证器 v274: 上下时间轴每帧清画布 (修复残影 + 半透明累积成不透明的真根因)。
// 需求: 用户反馈「v272改动导致播放时上方时间轴有残影, 且上下时间轴仍然完全不透明」。
// 根因: TopTimeline/BottomTimeline 的 draw 循环从不 clearRect — v246 后 backing 尺寸不变时
//   canvas 位图保留, 半透明底 fillRect 每帧 source-over 叠加:
//   · alpha 0.4/0.72 时 3~5 帧收敛到≈不透明黑 = 历轮「半透明无效/底色纯黑」的主因
//     (v270/v271/v272 降 alpha 都只能延缓收敛, 波形开时"有点透明"是因 drawWave 内部有 clearRect);
//   · alpha 降到 0.15 (v272) 后收敛变慢 (残量 0.85^n), 移动物件拖出残影尾巴。
// 修复: 两个 draw 循环开头 setTransform(identity) + clearRect 全画布, 再进入 css px 坐标系。
// 运行: node verifier/v274/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const tl = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
const clears = tl.match(/v274: 每帧先清画布[\s\S]{0,200}?g\.clearRect\(0, 0, c\.width, c\.height\);/g) ?? [];
assert(clears.length === 2, `上/下时间轴 draw 开头各一处每帧清画布 (实际 ${clears.length})`);
assert(/g\.setTransform\(1, 0, 0, 1, 0, 0\);\s*g\.clearRect/.test(tl), '清画布在 identity 变换下 (设备像素全幅)');
// 回归保护: 半透明底色值仍是 v272 终值 (v284 适配: 开关移除, 固定)
assert(/g\.fillStyle = 'rgba\(12,12,17,0\.15\)'/.test(tl), '上时间轴底 0.15 (v272) 保留');
assert(/lg\.fillStyle = 'rgba\(16,16,24,0\.15\)'/.test(tl), '下时间轴底 0.15 (v272) 保留');

if (failures) { console.error(`\nV274_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV274_ALL_PASSED');
