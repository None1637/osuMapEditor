// 验证器 v328: Alt 按下/松开时选中物件/滑条点 hover 高亮不即时更新 — 修复
//   根因: electron/main.cjs autoHideMenuBar:true + 原生菜单仍 setApplicationMenu
//   (注释自述 "Alt 可临时呼出原生菜单") → Windows 下按 Alt 唤出原生菜单并抢焦点,
//   窗口 blur → blur 处理器复位 altHeldRef → Alt 层 hover (v316 F18a 锚点高亮环 /
//   v304 F10 框选配色) 按下/松开都无即时变化。
// 修法: EditorCanvas 全局 key 处理器对 Alt 键 preventDefault (keydown/keyup 同 handler),
//   阻止菜单激活的默认行为; 菜单 accelerator 全局快捷键不受影响。
// 运行: node verifier/v328/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const ec = readSrc('src/components/EditorCanvas.tsx');

section('Alt preventDefault (阻止原生菜单抢焦点)');
{
  assert(/if \(e\.key === 'Alt'\) e\.preventDefault\(\);/.test(ec), 'Alt 键 preventDefault 存在');
  // 必须在 altHeldRef 更新之前生效, 且处于 keydown/keyup 共用 handler 内
  const blk = ec.match(/const key = \(e: KeyboardEvent\) => \{[\s\S]{0,400}?altHeldRef\.current = e\.altKey;/);
  assert(!!blk && /e\.key === 'Alt'\) e\.preventDefault\(\)/.test(blk[0]), 'preventDefault 在 keydown/keyup 共用 handler 内且先于 Alt 态更新');
  assert(/window\.addEventListener\('keydown', key\)/.test(ec) && /window\.addEventListener\('keyup', key\)/.test(ec), 'keydown/keyup 均挂该 handler');
}

section('Alt 即时刷新链路保留 (v304/v316)');
{
  assert(/altHeldRef\.current = e\.altKey;[^\n]*\n\s*refreshHover\(\);/.test(ec), 'Alt 态更新 + refreshHover 即时重算');
  assert(/const blur = \(\) => \{ altHeldRef\.current = false; refreshHover\(\);/.test(ec), 'blur 复位保留 (真正失焦时兜底; v333: 追加框选同步)');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv328 全部通过');
process.exit(failures ? 1 : 0);
