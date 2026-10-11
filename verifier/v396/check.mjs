// 验证器 v396: 滑条转连加快捷键 (默认 Ctrl+Shift+F)
// 运行: cd app && node verifier/v396/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('hotkeys.ts: stream 动作注册');
{
  const src = readSrc('src/osu/hotkeys.ts');
  assert(/id: 'stream'[\s\S]{0,200}defaults: \['Ctrl\+Shift\+F'\][\s\S]{0,120}menuId: 'compose-stream'/.test(src),
    "stream 动作: 默认 Ctrl+Shift+F + menuId compose-stream (可改键)");
  assert(/category: '变换'/.test(src), '归入 变换 分类');
}

section('App.tsx: keydown 派发');
{
  const src = readSrc('src/App.tsx');
  assert(/case 'stream':[\s\S]{0,200}openConversion\('stream'\)/.test(src), "case 'stream' => openConversion('stream')");
  assert(/case 'stream':[\s\S]{0,200}selected\.has\(o\.id\) && o\.type === 'slider'/.test(src), '选中集含滑条才开窗 (与 compose-stream 菜单同规则)');
}

section('main.cjs: 原生菜单快捷键显示');
{
  const src = readSrc('electron/main.cjs');
  assert(/compose-stream", mT\("menu\.stream"\), "CmdOrCtrl\+Shift\+F"/.test(src), 'compose-stream 菜单显示 CmdOrCtrl+Shift+F (acc() 同步改键)');
}

section('Inspector.tsx + zh-CN 词典: 快捷键提示');
{
  const insp = readSrc('src/components/Inspector.tsx');
  assert(/sliders_to_stream[\s\S]{0,120}hotkeyLabel\('stream'\)/.test(insp), '滑条转连打按钮带快捷键提示 (随改键同步)');
  const hotkeyDict = readSrc('src/i18n/dicts/zh-CN/hotkey.ts');
  assert(hotkeyDict.includes("'hotkey.action.stream': '滑条转连打窗口'"), 'zh-CN: hotkey.action.stream');
  const inspDict = readSrc('src/i18n/dicts/zh-CN/inspector.ts');
  assert(inspDict.includes("滑条转连打 ({n} 条, {key})"), 'zh-CN: sliders_to_stream 加 {key}');
}

if (failures) { console.error(`V396 FAILED (${failures})`); process.exit(1); }
console.log('V396 ALL PASSED');
