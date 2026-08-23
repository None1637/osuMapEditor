// v107 源码接线断言 (v127 重写): 原「波形窗点击穿透」语义随 WaveformPanel 悬浮窗废弃 —
// 波形不再是悬浮 DOM 面板, 而是画在 TopTimeline canvas 内 (背景/上层), 不存在"穿透到下层"问题。
// 保留此文件作为语义记录, 断言新架构: 面板文件已删, 时间轴按钮保持 DOM 最高层 (z-10, 波形上层模式也不被遮挡)
// 运行: node verifier/v107/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

assert(!fs.existsSync(path.join(root, 'src/components/WaveformPanel.tsx')), 'v127: WaveformPanel.tsx 已删除 (悬浮窗废弃, 无穿透问题)');

const tl = read('src/components/Timelines.tsx');
assert(/absolute right-1 top-1 flex gap-1 z-10/.test(tl), '时间轴右侧按钮组 z-10 (波形切到上层也不被遮挡)');
assert(/data-wave="mode"/.test(tl) && /data-wave="layer"/.test(tl), '波形模式/层级切换钮在时间轴右侧');

console.log(failures ? '\nV107_CHECK_FAILED: ' + failures : '\nV107_CHECK_PASSED');
process.exit(failures ? 1 : 0);
