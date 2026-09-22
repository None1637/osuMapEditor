// 验证器 v279: 窗口条隐藏只隐标题栏, 保留应用菜单栏 — 原生方案实测不可行 (已被 v280 取代)。
// 需求: 用户反馈「隐藏标题栏应该只隐藏标题栏, 不要把exe的菜单栏也隐藏了」。
// 结论: Windows 上 titleBarStyle:'hidden' (WCO) 不渲染菜单栏, autoHideMenuBar:false +
//   setMenuBarVisibility(true) 实测均无效 (exe 截图实证 menubar-shot.png, 2026-09 打包实跑);
//   菜单栏改应用内 HTML 自绘 → v280。本文件保留作结论记录: 断言 v279 代码已移除且 v280 在。
// 运行: node verifier/v279/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
assert(/v279: Windows 上 titleBarStyle:'hidden' \(WCO\) 会连带隐藏应用菜单栏/.test(main), 'v279 结论注释在 (实测无效)');
assert(!/autoHideMenuBar: false/.test(main) && !/win\.setMenuBarVisibility\(true\) \/\/ v279/.test(main), 'v279 无效代码已移除 (注释提及不算)');
assert(/serializeMenuItems/.test(main), 'v280 应用内菜单栏接替 (serializeMenuItems)');

if (failures) { console.error(`\nV279_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV279_ALL_PASSED');
