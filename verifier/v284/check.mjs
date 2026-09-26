// 验证器 v284: 时间轴半透明成为唯一行为 — 显示设置开关移除 (用户要求: 默认就是半透明, 不要开关)
// 实现:
//   · displaySettings.ts: timelineTransparent 字段/默认值/持久化读取移除 (localStorage 残留键忽略)
//   · DisplayPanel.tsx: 开关行移除
//   · 所有按开关三元的底色固定为「开」值: waveformDraw waveBg 0.12 / spectroBgAlpha 40;
//     Timelines 上帧填充 0.15 / 下静态层+无谱面分支 0.15 / 暗化层 0.1 / 容器 div 0.1 /
//     SelectionInfoPanel 0.15; 静态层缓存 key 不再含开关
// 运行: node verifier/v284/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const ds = readSrc('src/osu/displaySettings.ts');
assert(!/timelineTransparent: boolean/.test(ds), 'DisplaySettings 无 timelineTransparent 字段');
assert(!/timelineTransparent: (true|p\.)/.test(ds), '默认值/持久化读取移除');

const panel = readSrc('src/components/DisplayPanel.tsx');
assert(!/key: 'timelineTransparent'/.test(panel), '显示设置面板无该开关行');

const wd = readSrc('src/osu/waveformDraw.ts');
assert(/const waveBg = \(\) => 'rgba\(20,20,20,0\.12\)'/.test(wd), '波形底固定 0.12');
assert(/const spectroBgAlpha = \(\) => 40/.test(wd), '频谱底固定 40');
assert(!/displaySettings/.test(wd), 'waveformDraw 不再依赖 displaySettings');

const tl = readSrc('src/components/Timelines.tsx');
assert(!/timelineTransparent/.test(tl), 'Timelines 无 timelineTransparent 残留');
assert(/g\.fillStyle = 'rgba\(12,12,17,0\.15\)'/.test(tl), '上时间轴帧填充 0.15');
assert((tl.match(/fillStyle = 'rgba\(16,16,24,0\.15\)'/g) ?? []).length === 2, '下时间轴两处填充 0.15');
assert(/g\.fillStyle = 'rgba\(8,8,12,0\.1\)'/.test(tl), '暗化层 0.1');
assert(/background: 'rgba\(21,21,32,0\.1\)'/.test(tl), '下时间轴容器 0.1');
assert(/background: 'rgba\(12,12,17,0\.15\)' \}\}/.test(tl), 'SelectionInfoPanel 0.15');

// src 全局无残留引用
import { execSync } from 'child_process';
const grep = execSync('grep -rn "timelineTransparent" src --include="*.ts" --include="*.tsx" | grep -v "v284" || true', { cwd: root, shell: 'bash' }).toString().trim();
assert(grep === '', `src 无 timelineTransparent 残留引用 (v284 注释除外)${grep ? ': ' + grep : ''}`);

if (failures) { console.error(`\nV284_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV284_ALL_PASSED');
