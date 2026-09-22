// v281: 未隐藏标题栏模式也统一使用应用内自绘菜单条 (v280 的 MenuBar 组件)
// 背景: v280 只为 hideTitleBar (WCO 不渲染原生菜单栏) 做了自绘菜单条; 用户要求两种模式统一外观
// 方案:
//   · App.tsx: 无条件渲染 <MenuBar overlay={hideTitleBar} /> (非 Electron 下组件内部返回 null)
//   · MenuBar.tsx: 新增 overlay prop — hideTitleBar 时保留拖拽区 + paddingRight:140 (避开 WCO 窗口按钮);
//     非隐藏模式 (原生标题栏在窗口上方) 不需拖拽区/留白
//   · electron/main.cjs: 主窗口 autoHideMenuBar: true — 原生菜单栏默认隐藏 (避免与自绘菜单条重复);
//     原生菜单仍 setApplicationMenu, accelerator 全局快捷键保留 (Alt 可临时呼出原生菜单, Electron 固有行为)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failures = 0;
function assert(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); }
  else { failures++; console.error(`  FAIL ${label}`); }
}

const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const mainWin = main.match(/win = new BrowserWindow\(\{[\s\S]*?\}\)/)?.[0] ?? '';
assert(/autoHideMenuBar: true/.test(mainWin), '主窗口 autoHideMenuBar: true (原生菜单栏默认隐藏)');
assert(/Menu\.setApplicationMenu\(menu\)/.test(main), '原生菜单仍注册 (accelerator 保留)');

const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
assert(/<MenuBar overlay=\{hideTitleBar\} \/>/.test(app), 'App 无条件渲染 MenuBar 并传 overlay prop');
assert(!/\{hideTitleBar && <MenuBar/.test(app), '不再仅 hideTitleBar 时渲染');

const mb = fs.readFileSync(path.join(root, 'src/components/MenuBar.tsx'), 'utf8');
assert(/MenuBar\(\{ overlay \}: \{ overlay: boolean \}\)/.test(mb), 'MenuBar 接收 overlay prop');
assert(/overlay\s*\?[\s\S]*?paddingRight: 140/.test(mb), 'overlay 模式才留白 140 (避开 WCO 窗口按钮)');

if (failures) { console.error(`\nV281_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV281_ALL_PASSED');
