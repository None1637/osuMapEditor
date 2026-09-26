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
// v284 适配: 开关移除 — 时间轴半透明成为唯一行为 (用户要求: 默认就是半透明, 不要开关)
assert(!/timelineTransparent: boolean/.test(ds), 'v284: timelineTransparent 字段已移除');

const panel = fs.readFileSync(path.join(root, 'src/components/DisplayPanel.tsx'), 'utf8');
assert(!/key: 'timelineTransparent'/.test(panel), 'v284: 显示设置面板开关行已移除');

const tl = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
// v284 适配: 开关移除, 全部固定为「开」值
assert(/g\.fillStyle = 'rgba\(12,12,17,0\.15\)'/.test(tl), '上时间轴帧填充固定 0.15 (v284)');
assert((tl.match(/fillStyle = 'rgba\(16,16,24,0\.15\)'/g) ?? []).length === 2, '下时间轴静态层 + 无谱面分支固定 0.15 (v284)');
assert(!/timelineTransparent \? 1 : 0\]\.join/.test(tl), 'v284: 静态层缓存 key 不再含开关');
assert(!/bg-\[#151520\]\/70/.test(tl) && !/bg-\[#0c0c11\]\/72/.test(tl), '底栏容器/信息面板不再用固定透明度类');
assert(!/background: displaySettings\.timelineTransparent/.test(tl), 'v284: 底栏容器 + 右上信息面板内联样式不再按开关切换');

if (failures) { console.error(`\nV255_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV255_ALL_PASSED');
