// 验证器 v253: 帧数显示开关 (显示设置)。
// 需求: soulten「fps顯示開關」— 右下角 FpsCounter 可在显示设置面板关闭。
// 实现: displaySettings.showFps (默认 true) + DisplayPanel 开关行 + App.tsx 条件挂载。
// 运行: node verifier/v253/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const ds = fs.readFileSync(path.join(root, 'src/osu/displaySettings.ts'), 'utf8');
assert(/showFps: boolean/.test(ds), 'displaySettings 有 showFps 项');
assert(/showFps: true,\s*\/\/ v253/.test(ds), 'showFps 默认开启 (保持 v220 行为)');
assert(/showFps: p\.showFps !== false/.test(ds), 'showFps 持久化读取');

const panel = fs.readFileSync(path.join(root, 'src/components/DisplayPanel.tsx'), 'utf8');
assert(/key: 'showFps'/.test(panel), '显示设置面板有帧数显示开关行');

const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
assert(/\{displaySettings\.showFps && <FpsCounter \/>\}/.test(app), 'FpsCounter 按开关条件挂载 (v253)');
assert(/import \{ displaySettings \} from '@\/osu\/displaySettings'/.test(app), 'App.tsx 引入 displaySettings');

if (failures) { console.error(`\nV253_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV253_ALL_PASSED');
