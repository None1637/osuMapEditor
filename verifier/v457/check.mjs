// 验证器 v457: 设置「Alt拖滑条尾变速还原后续sv」(editorPrefs.svTailRestore, 设置菜单 checkbox, 默认开) —
//   开 = v454 现状 (在后续滑条头插 svOld 还原绿线); 关 = 不插还原绿线 (SV 改动自然泄漏)。
// v466 适配: 扩程的还原红线改插 T0 (MT 1ms 窗口收口, 恒插不受本开关门控), 不再插后续滑条头还原红线。
// 运行: cd app && node verifier/v457/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let failures = 0;
const assert = (cond, msg) => { if (cond) console.log(`  ok - ${msg}`); else { console.error(`  FAIL - ${msg}`); failures++; } };
const section = (s) => console.log(`== ${s}`);

section('editorPrefs: svTailRestore 开关 (默认开)');
{
  const ep = read('src/osu/editorPrefs.ts');
  assert(/svTailRestore: boolean;/.test(ep), 'EditorPrefs 接口含 svTailRestore');
  assert(/svTailRestore: true,\s*\/\/ v457/.test(ep), '默认值 true');
  assert(/svTailRestore: p\.svTailRestore !== false/.test(ep), '持久化读取默认 true (遗留数据无此键取开)');
}

section('设置菜单接线 (v386 通道)');
{
  const br = read('src/osu/electronBridge.ts');
  assert(/svTailRestore: boolean; \/\/ v457/.test(br), 'ElectronEditorPrefsState 含 svTailRestore');
  assert(/'svRedlineBoost' \| 'svTailRestore'/.test(br), 'menu-cmd key 联合类型含 svTailRestore');
  const mc = read('electron/main.cjs');
  assert(/svTailRestore: true \}/.test(mc), '主进程勾选状态默认 true');
  assert(/svTailRestore: s\?\.svTailRestore !== false/.test(mc), 'editor-prefs-state 上报解析默认 true');
  assert(/mT\("menu\.sv_tail_restore"\), type: "checkbox", checked: editorPrefsState\.svTailRestore, click: \(\) => send\(\{ type: "settings-toggle-editor-pref", key: "svTailRestore" \}\)/.test(mc), '设置菜单 checkbox 项');
  assert(/"menu\.sv_tail_restore": \{ en:.+"zh-CN": "Alt拖滑条尾变速还原后续sv", "zh-TW": "Alt拖滑條尾變速還原後續sv" \}/.test(mc), '菜单三语标签');
  const app = read('src/App.tsx');
  assert(/svTailRestore: editorPrefs\.svTailRestore \}\)/.test(app), 'App.tsx 勾选状态上报含 svTailRestore');
}

section('Timelines.tsx: 还原线插入受开关门控');
{
  const src = read('src/components/Timelines.tsx');
  const fn = src.match(/function applySvTailDrag[\s\S]*?\n\}\n/)?.[0] ?? '';
  assert(fn.length > 0, 'applySvTailDrag 存在');
  assert(/if \(!restored && editorPrefs\.svTailRestore\) \{/.test(fn), '还原绿/红线插入受 svTailRestore 门控');
  // 逐帧摘除不受门控 (开关中途关闭也能清掉上一帧的恢复线)
  const iRmG = fn.indexOf('if (tr.restore) {');
  const iRmR = fn.indexOf('if (tr.boostRedRestore) {'); // v466 适配: 还原红线改名 (落点 T0, 不再插后续滑条头)
  const iGate = fn.indexOf('if (!restored && editorPrefs.svTailRestore)');
  assert(iRmG > 0 && iRmR > iRmG && iGate > iRmR, '摘除在门控之前 (中途关闭也能清上一帧恢复线)');
}

if (failures) { console.error(`V457 FAILED: ${failures}`); process.exit(1); }
console.log('V457 ALL PASSED');
