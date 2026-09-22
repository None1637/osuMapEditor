// 验证器 v280: 应用内 HTML 菜单栏 (hideTitleBar 模式下)。
// 需求: 用户反馈「隐藏标题栏应该只隐藏标题栏, 不要把exe的菜单栏也隐藏了」。
// 结论: v279 原生方案 (autoHideMenuBar:false + setMenuBarVisibility) 实测无效 —
//   Windows 上 titleBarStyle:'hidden' (WCO) 不渲染原生菜单栏 (exe 截图实证 verifier/v279/menubar-shot.png);
//   改 VS Code 同款方案: 主进程 buildMenu 模板序列化推送 → 渲染端 MenuBar 组件自绘菜单条。
// 实现:
//   · main.cjs: serializeMenuItems (label/enabled/type/checked/accelerator/submenu, 叶子分配 id),
//     menuActions id→执行表 (click 闭包 / role: reload/toggleDevTools/quit 等价实现),
//     buildMenu 末尾 send("menu-definition") + get-menu-definition handle (首拉) + menu-item-click 执行;
//   · preload/bridge: getMenuDefinition/onMenuDefinition/menuItemClick;
//   · MenuBar.tsx: 顶级横排 + 下拉 + hover 子菜单, separator/radio●/checkbox✓/accelerator(CmdOrCtrl→Ctrl),
//     点击外部/Esc 关闭, 菜单条兼拖拽区 (右侧留白 140 避开 overlay);
//   · App.tsx: hideTitleBar 时页签栏上方渲染 <MenuBar />;
//   · 原生菜单仍 setApplicationMenu (非隐藏模式照常, accelerator 全局生效)。
// 运行: node verifier/v280/check.mjs; E2E: node verifier/v280/cdp-v280.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
assert(/function serializeMenuItems\(items\)/.test(main), '菜单模板序列化函数');
assert(/menuActions\.set\(id/.test(main), '叶子项 id → 执行表');
assert(/role === "reload"/.test(main) && /role === "toggleDevTools"/.test(main) && /role === "quit"/.test(main), 'role 等价实现 (reload/devtools/quit)');
assert(/ipcMain\.handle\("get-menu-definition"/.test(main), 'get-menu-definition 首拉 handle');
assert(/ipcMain\.on\("menu-item-click"/.test(main), 'menu-item-click 执行');
assert(/webContents\.send\("menu-definition", lastMenuDef\)/.test(main), 'buildMenu 推送菜单定义');
assert(/Menu\.setApplicationMenu\(menu\)/.test(main), '原生菜单保留 (accelerator 全局生效)');
assert(!/autoHideMenuBar: false/.test(main), 'v279 无效的 autoHideMenuBar 已移除');

const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
assert(/getMenuDefinition/.test(preload) && /onMenuDefinition/.test(preload) && /menuItemClick/.test(preload), 'preload 暴露三个菜单栏 API');

const bridge = fs.readFileSync(path.join(root, 'src/osu/electronBridge.ts'), 'utf8');
assert(/ElectronMenuNode/.test(bridge), 'ElectronMenuNode 类型');

const mb = fs.readFileSync(path.join(root, 'src/components/MenuBar.tsx'), 'utf8');
assert(/data-menu-bar/.test(mb) && /data-menu-top/.test(mb) && /data-menu-item/.test(mb), '菜单条 DOM 标记');
assert(/onMouseEnter/.test(mb), '已打开时 hover 切换顶级菜单');
assert(/Escape/.test(mb), 'Esc 关闭下拉');
assert(/CmdOrCtrl/g.test(mb), 'accelerator CmdOrCtrl→Ctrl 显示');
assert(/paddingRight: 140/.test(mb), '右侧留白避开窗口按钮 overlay');

const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
// v281: 两种标题栏模式统一渲染 MenuBar (非隐藏模式原生菜单栏由主进程 autoHideMenuBar 隐藏)
assert(/<MenuBar overlay=\{hideTitleBar\} \/>/.test(app), '统一渲染 MenuBar (页签栏上方)');

if (failures) { console.error(`\nV280_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV280_ALL_PASSED');
