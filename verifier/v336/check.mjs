// 验证器 v336: exe 下 Alt 按下/松开完全无反应 (框选颜色都不变) — 主进程拦截后转发 Alt 态
//   用户反馈: 松开/按下 Alt 时选中的物件/滑条点仍无即时变化; 现在松开 Alt 后框选颜色都不变了。
//   根因: v332 在 electron/main.cjs 的 before-input-event 里对 Alt 一律 e.preventDefault(),
//   而 preventDefault 会阻止事件下发到页面 — 渲染端 keydown/keyup 永远收不到 Alt,
//   altHeldRef 恒定 false (exe 下 Alt 框选/hover 切换全失效; 浏览器不受影响)。
// 修法:
//   1) electron/main.cjs: 拦截照旧 (防 OS 菜单抢焦点), 同时把按下/松开态经 "alt-key" 通道转发渲染端;
//   2) electron/preload.cjs: 暴露 onAltKey(cb) (返回退订);
//   3) src/osu/electronBridge.ts: ElectronAPI 加 onAltKey;
//   4) EditorCanvas.tsx: v536 修饰键 useEffect 内订阅 onAltKey — 状态变化时同步 altHeldRef +
//      refreshHover + syncMarqueeMode + recomputeMarqueeSelection (与 keydown/keyup 同一套后续动作)。
// 运行: node verifier/v336/check.mjs
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
const ec = readSrc('src/components/EditorCanvas.tsx');

section('主进程: keyUp 拦截 + 双向转发 (v336 CDP 实测修正)');
{
  const handler = main.match(/before-input-event", \(e, input\) => \{[\s\S]{0,500}?\}\)/);
  assert(!!handler, 'before-input-event 处理器存在');
  assert(!!handler && /if \(input\.type === "keyUp"\) e\.preventDefault\(\)/.test(handler[0]),
    '只拦 keyUp (Windows 菜单激活在 Alt 松开时发生; keyDown 放行让页面走 DOM)');
  assert(!!handler && /webContents\.send\("alt-key", input\.type !== "keyUp"\)/.test(handler[0]),
    'alt-key 转发 (按下=true/松开=false; keyUp 被吞后渲染端靠此同步松开)');
}

section('preload + 桥接类型');
{
  assert(/onAltKey: \(cb\) => \{/.test(preload) && /ipcRenderer\.on\("alt-key", listener\)/.test(preload), 'preload 暴露 onAltKey');
  assert(/removeListener\("alt-key", listener\)/.test(preload), 'onAltKey 返回退订函数');
  assert(/onAltKey\(cb: \(down: boolean\) => void\): \(\) => void;/.test(bridge), 'ElectronAPI 声明 onAltKey');
}

section('渲染端: 订阅同步 Alt 态');
{
  assert(/import \{ getElectronAPI \} from '@\/osu\/electronBridge';/.test(ec), 'EditorCanvas 引入 getElectronAPI');
  const sub = ec.match(/getElectronAPI\(\)\?\.onAltKey\(\(down\) => \{[\s\S]{0,400}?\}\)/);
  assert(!!sub, '订阅 onAltKey');
  assert(!!sub && /if \(altHeldRef\.current === down\) return;/.test(sub[0]), '状态未变时跳过 (幂等)');
  assert(!!sub && /altHeldRef\.current = down;/.test(sub[0]), '同步 altHeldRef');
  assert(!!sub && /refreshHover\(\);/.test(sub[0]) && /syncMarqueeMode\(\); recomputeMarqueeSelection\(\);/.test(sub[0]),
    '同步后走 hover/框选重算 (与 keydown/keyup 同一套)');
  assert(/offAlt\?\.\(\);/.test(ec), '卸载时退订');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv336 全部通过');
process.exit(failures ? 1 : 0);
