// 验证器 v332: Alt 按下/松开选中物件/滑条点 hover 高亮仍不即时刷新 — 主进程拦截
//   v328 在渲染端对 Alt keydown preventDefault, 但 Electron 原生菜单的 Alt 激活是 OS 层行为
//   (非 DOM 默认行为), 渲染端拦不住 → autoHideMenuBar 下 Alt 仍唤起菜单抢焦点 (blur 复位 altHeldRef)。
// 修法: electron/main.cjs 主窗口 before-input-event 拦截 Alt (e.preventDefault)。
//   菜单 accelerator 无 Alt 组合 (grep 确认), 不受影响; DOM keydown/keyup 仍正常下发,
//   渲染端 v328 的 preventDefault 保留作双保险。
// 运行: node verifier/v332/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const main = readSrc('electron/main.cjs');
const ec = readSrc('src/components/EditorCanvas.tsx');

section('主进程: before-input-event 拦截 Alt');
{
  assert(/win\.webContents\.on\("before-input-event", \(e, input\) => \{[\s\S]{0,200}?input\.key === "Alt"[\s\S]{0,200}?e\.preventDefault\(\)/.test(main),
    '主窗口 before-input-event: Alt → preventDefault');
  // 拦截挂在主窗口创建处 (win), 在 loadURL 之前注册
  const winIdx = main.indexOf('win = new BrowserWindow(');
  const hookIdx = main.indexOf('"before-input-event"');
  assert(winIdx > 0 && hookIdx > winIdx && hookIdx < main.indexOf('win.loadURL'), '拦截注册在窗口创建后、loadURL 前');
  // 菜单 accelerator 不含 Alt (拦截不破坏任何菜单快捷键)
  const accels = main.match(/accelerator:\s*["'][^"']*Alt[^"']*["']/g) ?? [];
  assert(accels.length === 0, `菜单 accelerator 无 Alt 组合 (实际 ${accels.length} 个)`);
}

section('渲染端双保险保留 (v328)');
{
  assert(/if \(e\.key === 'Alt'\) e\.preventDefault\(\);/.test(ec), 'EditorCanvas Alt preventDefault 保留');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv332 全部通过');
process.exit(failures ? 1 : 0);
