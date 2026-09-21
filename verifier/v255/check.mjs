// 验证器 v255: 上下时间轴半透明开关 (显示设置)。
// 需求: soulten「上下時間軸UI半透明」— 时间轴背景更透明可透视游玩区。
// 实现: displaySettings.timelineTransparent (默认 true = 更透 alpha≈0.4; 关 = v129 的 0.7 暗底)。
//   触点: 上时间轴帧填充 / 下时间轴静态层 (缓存 key 含开关) / 无谱面分支 / 底栏容器 / 右上信息面板。
// 运行: node verifier/v255/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const ds = fs.readFileSync(path.join(root, 'src/osu/displaySettings.ts'), 'utf8');
assert(/timelineTransparent: boolean/.test(ds), 'displaySettings 有 timelineTransparent 项');
assert(/timelineTransparent: true,\s*\/\/ v255/.test(ds), 'timelineTransparent 默认开启 (用户需求)');
assert(/timelineTransparent: p\.timelineTransparent !== false/.test(ds), 'timelineTransparent 持久化读取');

const panel = fs.readFileSync(path.join(root, 'src/components/DisplayPanel.tsx'), 'utf8');
assert(/key: 'timelineTransparent'/.test(panel), '显示设置面板有时间轴半透明开关行');

const tl = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
assert(/displaySettings\.timelineTransparent \? 'rgba\(12,12,17,0\.15\)' : 'rgba\(12,12,17,0\.72\)'/.test(tl), '上时间轴帧填充按开关切换透明度 (v272 适配: 开 0.4→0.15)');
assert((tl.match(/displaySettings\.timelineTransparent \? 'rgba\(16,16,24,0\.15\)' : 'rgba\(16,16,24,0\.7\)'/g) ?? []).length === 2, '下时间轴静态层 + 无谱面分支按开关切换透明度 (v272 适配: 开 0.4→0.15)');
assert(/displaySettings\.timelineTransparent \? 1 : 0\]\.join/.test(tl), '静态层缓存 key 含开关 (切换即重建)');
assert(!/bg-\[#151520\]\/70/.test(tl) && !/bg-\[#0c0c11\]\/72/.test(tl), '底栏容器/信息面板不再用固定透明度类');
assert((tl.match(/style=\{\{ background: displaySettings\.timelineTransparent/g) ?? []).length === 2, '底栏容器 + 右上信息面板内联样式按开关切换');

if (failures) { console.error(`\nV255_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV255_ALL_PASSED');
