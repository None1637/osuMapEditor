// 验证器 v77: Electron 原生 "文件" 菜单 (保存/打开难度/最近难度/歌曲文件夹/记事本)
// 运行: cd app && node verifier/v77/check.mjs; node verifier/v77/cdp-v77.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v77/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v77/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('electron/main.cjs: "文件" 菜单 (最左侧)');
{
  const src = readSrc('electron/main.cjs');
  assert(/label: "文件",\s*submenu/.test(src), '"文件" 菜单存在');
  assert(src.indexOf('label: "文件"') < src.indexOf('label: "设置"'), '"文件" 在 "设置" 之前 (最左侧)');
  assert(/label: "保存", accelerator: "CmdOrCtrl\+S"/.test(src) && /send\(\{ type: "save" \}\)/.test(src), '保存 (CmdOrCtrl+S) => menu-cmd save');
  assert(/label: "打开一个难度"/.test(src) && /menuState\.difficulties\.map/.test(src) && /type: "open", folderRel: menuState\.folderRel, file: d\.file/.test(src), '打开一个难度 => 当前谱面难度子菜单');
  assert(/label: "打开最近的难度"/.test(src) && /readSettings\(\)\.recents/.test(src) && /type: "open", folderRel: r\.folderRel, file: r\.file/.test(src), '打开最近的难度 => settings.recents 子菜单');
  assert(/ipcMain\.on\("menu-state"/.test(src) && /writeSettings\(s\)/.test(src) && /pushRecent\(s\.recents/.test(src), 'menu-state 上报 => 最近列表持久化 settings.json');
  assert(/buildMenu\(\)/.test(src), 'menu-state 后重建菜单');
  assert(/label: "打开歌曲文件夹"/.test(src) && /shell\.openPath\(curFolderAbs\)/.test(src), '打开歌曲文件夹 => shell.openPath');
  assert(/在记事本中打开\.osu文件/.test(src) && /spawn\("notepad\.exe", \[curFileAbs\]/.test(src), '记事本打开 .osu => spawn notepad.exe');
  assert(/enabled: !!curFolderAbs/.test(src) && /enabled: !!curFileAbs/.test(src), '无服务器来源时文件夹/记事本项禁用');
}

section('electron/preload.cjs: menuState / onMenuCommand 暴露');
{
  const src = readSrc('electron/preload.cjs');
  assert(/menuState: \(state\) => ipcRenderer\.send\("menu-state", state\)/.test(src), 'menuState 上报通道');
  assert(/ipcRenderer\.on\("menu-cmd", listener\)/.test(src) && /removeListener\("menu-cmd"/.test(src), 'onMenuCommand 订阅 (可退订)');
}

section('src/osu/electronMenu.ts: 状态上报 + 命令处理');
{
  const src = readSrc('src/osu/electronMenu.ts');
  assert(/export async function reportMenuState/.test(src) && /listDifficulties\(source\.dir\)/.test(src) && /ed\.menuState\(/.test(src), 'reportMenuState: 难度列表 + menuState 上报');
  assert(/source\?\.dir\.serverRel \?\? null/.test(src), 'folderRel 取自 serverDir.serverRel (非服务器来源 null)');
  assert(/serverDir\('songs', folderRel, folderRel\)/.test(src) && /loadDifficulty\(dir, file\)/.test(src) && /store\.load\(r\.bm/.test(src), 'openServerDifficulty: 服务器目录加载 + store.load 记录来源');
  assert(/if \(cmd\.type === 'save'\) \{ await store\.save\(\)/.test(src), 'save 命令 = store.save (与 Ctrl+S 相同)');
  assert(/__osuMenuCmd = handleMenuCommand/.test(src), 'CDP 调试暴露');
}

section('store.ts / App.tsx / serverFs.ts: 接线');
{
  const store = readSrc('src/osu/store.ts');
  assert(/void reportMenuState\(bm, source\)/.test(store), 'store.load 后上报菜单状态');
  const app = readSrc('src/App.tsx');
  assert(/ed\.onMenuCommand\(async \(cmd\)/.test(app) && /handleMenuCommand\(cmd\)/.test(app) && /setShowLibrary\(false\)/.test(app), 'App 订阅菜单命令 (open 后关曲库)');
  const serverFs = readSrc('src/osu/serverFs.ts');
  assert(/serverRel: rel,/.test(serverFs), 'serverDir 携带 serverRel');
  const bridge = readSrc('src/osu/electronBridge.ts');
  assert(/menuState\(state: ElectronMenuState\): void/.test(bridge) && /onMenuCommand\(cb/.test(bridge), 'electronBridge 类型同步');
}

if (failures) { console.error(`\nVERIFIER_V77_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V77_ALL_PASSED');
