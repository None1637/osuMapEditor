// v120 源码接线断言: 未保存改动提示 — 脏标记 + 切换谱面/难度/关闭编辑器前弹保存/废弃弹窗
// 运行: node verifier/v120/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const store = read('src/osu/store.ts');
const menu = read('src/osu/electronMenu.ts');
const bridge = read('src/osu/electronBridge.ts');
const preload = read('electron/preload.cjs');
const main = read('electron/main.cjs');
const app = read('src/App.tsx');
const lib = read('src/components/SongLibrary.tsx');
const dlg = read('src/components/UnsavedDialog.tsx');

// store: 脏标记与拦截
assert(/dirty = false;/.test(store) && /pendingAction: \(\(\) => void\) \| null = null;/.test(store), 'store: dirty + pendingAction 字段');
assert(/pushUndo\(\) \{[\s\S]{0,300}v140: 不再在此置脏/.test(store), 'pushUndo: v140 起不再盲置脏 (改 emit() 指纹对比, 无实际改动不脏)');
assert(/this\.setDirty\(false\); \/\/ v120/.test(store), 'save 成功: 清脏标记');
assert(/async save\(\): Promise<boolean>/.test(store), 'save: 返回是否成功 (保存并继续依赖)');
assert(/this\.pendingAction = null; \/\/ v120/.test(store) && /this\.setDirty\(false\); \/\/ v120: 载入即干净状态/.test(store), 'load: 清脏 + 丢弃待执行动作');
assert(/guardUnsaved\(action: \(\) => void\): boolean \{[\s\S]{0,600}if \(!this\.beatmap \|\| !this\.dirty\) return true;/.test(store), 'guardUnsaved: 干净/无谱面放行 (v136 起前有 bypass 一次性放行块)');
assert(/resolvePendingAction\(run: boolean\)/.test(store), 'resolvePendingAction: 取消/确认');

// 拦截点: 曲库 / 菜单打开 (v141: 拖文件开谱面已废弃, 原 .osz/.osu 两处拦截随之移除)
assert(/if \(!store\.guardUnsaved\(\(\) => \{ void openDiff\(fileName\); \}\)\) return;/.test(lib), '曲库 openDiff: 切换谱面/难度拦截');
assert(/if \(!store\.guardUnsaved\(\(\) => \{ void openServerDifficulty\(folderRel, file\); \}\)\) return true;/.test(menu), '菜单/最近打开 openServerDifficulty: 拦截');

// 关闭编辑器: Electron 主进程 + preload + 桥接 + App 订阅; 浏览器 beforeunload
assert(/win\.on\("close", \(e\) => \{[\s\S]{0,120}e\.preventDefault\(\)[\s\S]{0,80}"close-request"/.test(main), 'main: 脏时拦截关窗并发 close-request');
assert(/ipcMain\.on\("dirty-state"/.test(main) && /ipcMain\.on\("close-confirmed", \(\) => \{ isDirty = false; win\?\.close\(\) \}\)/.test(main), 'main: dirty-state 上报 + close-confirmed 真正关窗');
assert(/dirtyState: \(b\) => ipcRenderer\.send\("dirty-state", b\)/.test(preload) && /confirmClose: \(\) => ipcRenderer\.send\("close-confirmed"\)/.test(preload) && /ipcRenderer\.on\("close-request"/.test(preload), 'preload: 三通道暴露');
assert(/dirtyState\(b: boolean\): void;/.test(bridge) && /onCloseRequest\(cb: \(\) => void\): \(\) => void;/.test(bridge) && /confirmClose\(\): void;/.test(bridge), 'electronBridge: 类型声明');
assert(/reportDirtyState/.test(menu) && /getElectronAPI\(\)\?\.dirtyState\(b\)/.test(menu), 'electronMenu: reportDirtyState (非 Electron 无操作)');
assert(/ed\.onCloseRequest\(\(\) => \{ store\.guardUnsaved\(\(\) => ed\.confirmClose\(\)\); \}\)/.test(app), 'App: 关窗请求 -> 弹保存/废弃提示');
assert(/beforeunload/.test(app) && /if \(store\.dirty\) \{ e\.preventDefault\(\);/.test(app), 'App: 浏览器 beforeunload 原生提示 (仅非 Electron)');

// 弹窗组件
assert(/store\.pendingAction/.test(dlg) && /if \(!action\) return null;/.test(dlg), 'UnsavedDialog: pendingAction 非空时显示');
assert(/data-unsaved-dialog="save"/.test(dlg) && /data-unsaved-dialog="discard"/.test(dlg) && /data-unsaved-dialog="cancel"/.test(dlg), 'UnsavedDialog: 三按钮 (测试挂钩)');
assert(/const ok = await store\.save\(\);[\s\S]{0,80}if \(ok\) store\.resolvePendingAction\(true\);/.test(dlg), '保存并继续: 保存成功才执行后续动作');
assert(/<UnsavedDialog \/>/.test(app), 'App: 挂载 UnsavedDialog');

console.log(failures ? `\nV120_CHECK_FAILED: ${failures}` : '\nV120_CHECK_PASSED');
process.exit(failures ? 1 : 0);
