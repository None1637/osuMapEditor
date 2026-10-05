// 验证器 v338: 崩溃日志 — 远程用户白屏 (Ctrl+Shift+R/Ctrl+Shift+S 打开旋转/缩放窗口即白, 本地无法复现)
//   没有现场数据可查 → 加全链路崩溃日志, 让用户的机器自己记录:
//   1) electron/main.cjs: logCrash() 追加写 <userData>/crash.log (单条截 4KB, 文件超 1MB 重开);
//      "renderer-error" IPC 接收渲染端上报; render-process-gone / unresponsive 直接落盘;
//   2) preload.cjs: reportError(msg);
//   3) electronBridge.ts: ElectronAPI.reportError;
//   4) src/main.tsx: window error + unhandledrejection 钩子 (仅 Electron; 同消息 5s 节流防渲染循环刷屏)。
// 运行: node verifier/v338/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const main = readSrc('electron/main.cjs');
const preload = readSrc('electron/preload.cjs');
const bridge = readSrc('src/osu/electronBridge.ts');
const entry = readSrc('src/main.tsx');

section('主进程: 落盘链路');
{
  assert(/const crashLogFile = \(\) => path\.join\(app\.getPath\("userData"\), "crash\.log"\)/.test(main), 'crash.log 在 userData');
  assert(/function logCrash\(kind, payload\)/.test(main) && /fs\.appendFileSync\(f,/.test(main), 'logCrash 追加写');
  assert(/size > 1024 \* 1024/.test(main), '文件超 1MB 重开 (防无限膨胀)');
  assert(/ipcMain\.on\("renderer-error", \(_e, payload\) => logCrash\("renderer-error", payload\)\)/.test(main), 'renderer-error IPC');
  assert(/win\.webContents\.on\("render-process-gone", \(_e, details\) => logCrash\("render-process-gone", JSON\.stringify\(details\)\)\)/.test(main), 'render-process-gone 落盘 (白屏=渲染进程崩溃时拿到 reason)');
  assert(/win\.webContents\.on\("unresponsive",/.test(main), 'unresponsive 落盘');
}

section('preload + 桥接');
{
  assert(/reportError: \(msg\) => ipcRenderer\.send\("renderer-error", msg\)/.test(preload), 'preload 暴露 reportError');
  assert(/reportError\(msg: string\): void;/.test(bridge), 'ElectronAPI 声明 reportError');
}

section('渲染端: 全局钩子 (main.tsx 最早期)');
{
  assert(entry.indexOf("window.addEventListener('error'") < entry.indexOf('createRoot(document.getElementById'), '钩子装在 createRoot 之前');
  assert(/window\.addEventListener\('error',/.test(entry), 'window error 钩子');
  assert(/window\.addEventListener\('unhandledrejection',/.test(entry), 'unhandledrejection 钩子');
  assert(/msg === lastMsg && now - lastAt < 5000/.test(entry), '同消息 5s 节流 (渲染循环每帧抛错不刷屏)');
  assert(/api\.reportError\(msg\.slice\(0, 3500\)\)/.test(entry), '上报截断');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv338 全部通过');
process.exit(failures ? 1 : 0);
