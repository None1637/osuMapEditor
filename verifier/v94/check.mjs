// 验证器 v94: exe 启动恢复上次谱面 (recents[0]) — 无新纯函数 (recentsCore.pushRecent 已在 v77 覆盖),
// 本批 = check 接线断言 + cdp 端到端 (注入 mock window.osuEditor 模拟 Electron 环境)
// 运行: cd app && node verifier/v94/check.mjs; node verifier/v94/cdp-v94.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('main.cjs + preload.cjs: get-recents IPC');
{
  const main = readSrc('electron/main.cjs');
  assert(/ipcMain\.handle\("get-recents", \(\) => readSettings\(\)\.recents \?\? \[\]\)/.test(main), 'get-recents 处理器');
  const preload = readSrc('electron/preload.cjs');
  assert(/getRecents: \(\) => ipcRenderer\.invoke\("get-recents"\)/.test(preload), 'preload 暴露 getRecents');
}

section('electronBridge.ts: 类型化 API');
{
  const bridge = readSrc('src/osu/electronBridge.ts');
  assert(/getRecents\(\): Promise<ElectronRecentEntry\[\]>/.test(bridge), 'ElectronAPI.getRecents');
  assert(/interface ElectronRecentEntry/.test(bridge) && /folderRel: string/.test(bridge), 'ElectronRecentEntry 类型');
}

section('App.tsx: 启动恢复上次谱面, 失败回退演示谱面');
{
  const app = readSrc('src/App.tsx');
  assert(/import \{ handleMenuCommand, openServerDifficulty \} from '@\/osu\/electronMenu'/.test(app), '引入 openServerDifficulty');
  assert(/const \[r\] = await api\.getRecents\(\)/.test(app), '取 recents[0]');
  assert(/await openServerDifficulty\(r\.folderRel, r\.file\)/.test(app), '经服务器目录加载');
  assert(/setShowLibrary\(false\)/.test(app), '成功直进编辑器 (跳过曲库界面)');
  assert(/createSampleBeatmap\(\)/.test(app), '回退演示谱面保留');
}

if (failures) { console.error(`\nVERIFIER_V94_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V94_ALL_PASSED');
