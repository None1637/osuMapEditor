// 验证器 v135: 上方时间轴右侧加「关闭波形/频谱」按钮 (data-wave="close")
// 需求: 给上方时间轴加一个关闭波形图/频谱图的按钮 (此前只能从左侧栏「波形」开关关闭)
// 运行: node verifier/v135/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const tl = read('src/components/Timelines.tsx');

assert(/data-wave="close"/.test(tl), '关闭按钮存在 (data-wave="close")');
assert(/store\.setWavePanelOpen\(false\)/.test(tl), '点击调 setWavePanelOpen(false) (与左侧栏开关同一状态, 持久化记忆)');
const modeIdx = tl.indexOf('data-wave="mode"');
const layerIdx = tl.indexOf('data-wave="layer"');
const closeIdx = tl.indexOf('data-wave="close"');
const openIdx = tl.indexOf('{store.wavePanelOpen && (');
assert(openIdx > 0 && modeIdx > openIdx && closeIdx > layerIdx, '按钮在 wavePanelOpen 条件块内, 排在模式/层级钮之后');
assert(/z-10/.test(tl.slice(tl.indexOf('absolute right-1 top-1') - 200, tl.indexOf('absolute right-1 top-1') + 60)) || /absolute right-1 top-1 flex gap-1 z-10/.test(tl), '按钮组保持 z-10 (波形上层模式不被遮挡)');

console.log(failures ? `\nV135_CHECK_FAILED: ${failures}` : '\nV135_CHECK_PASSED');
process.exit(failures ? 1 : 0);
