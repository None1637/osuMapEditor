// 验证器 v263: 窗口条隐藏 (Electron)。
// 需求: soulten「視窗條隱藏」「再許個願 視窗條可以隱藏」。
// 实现: 显示设置面板 Electron 专属开关 → IPC set-hide-title-bar 写 settings.json;
//   createWindow 读 hideTitleBar → titleBarStyle:'hidden' + titleBarOverlay (保留原生窗口按钮);
//   页签栏兼作拖拽区 (-webkit-app-region: drag), 各按钮 no-drag, 右侧留白 140px 避开 overlay;
//   重启后生效 (frame/titleBarStyle 只能建窗时指定)。
// 运行: node verifier/v263/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
assert(/hideTitleBar: !!s\.hideTitleBar/.test(main), 'get-settings 返回 hideTitleBar');
assert(/ipcMain\.handle\("set-hide-title-bar"/.test(main), 'set-hide-title-bar IPC 写 settings.json');
assert(/titleBarStyle: "hidden"/.test(main), 'createWindow 按开关 titleBarStyle hidden');
assert(/titleBarOverlay: \{ color: "#101016"/.test(main), 'titleBarOverlay 保留原生窗口按钮并着色');

const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
assert(/setHideTitleBar: \(b\) => ipcRenderer\.invoke\("set-hide-title-bar", b\)/.test(preload), 'preload 暴露 setHideTitleBar');

const bridge = fs.readFileSync(path.join(root, 'src/osu/electronBridge.ts'), 'utf8');
assert(/hideTitleBar: boolean;/.test(bridge), 'ElectronSettings 类型含 hideTitleBar');
assert(/setHideTitleBar\(b: boolean\): Promise<boolean>;/.test(bridge), 'ElectronAPI 类型含 setHideTitleBar');

const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
assert(/WebkitAppRegion: 'drag' \} as CSSProperties : undefined/.test(app), '页签栏拖拽区 (v280 二轮: paddingRight 140 移至菜单条行 — overlay 只覆盖窗口顶行)');
assert((app.match(/WebkitAppRegion: 'no-drag'/g) ?? []).length >= 4, '页签栏各按钮 no-drag (页签×3 + 音量 + 显示设置)');

const panel = fs.readFileSync(path.join(root, 'src/components/DisplayPanel.tsx'), 'utf8');
assert(/data-display-toggle="hideTitleBar"/.test(panel), '显示设置面板有窗口条隐藏开关行');
assert(/重启后生效/.test(panel), '标注重启后生效');

if (failures) { console.error(`\nV263_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV263_ALL_PASSED');
