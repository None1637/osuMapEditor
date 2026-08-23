// v121 源码接线断言: 未保存改动指示器的脏标记链路 (v123 起指示器本体移到应用内顶栏, 见 v123)
// 运行: node verifier/v121/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const main = read('electron/main.cjs');
const store = read('src/osu/store.ts');
const menu = read('src/osu/electronMenu.ts');

// v123: 菜单项指示器已移除 (原生菜单项无法右对齐); 菜单模板不再含指示项
assert(!main.includes('⚪ 有未保存改动'), 'v123: 菜单栏指示器已移除 (改应用内顶栏)');
// 脏标记链路保留 (关闭拦截的数据源)
assert(/ipcMain\.on\("dirty-state", \(_e, b\) => \{ isDirty = !!b \}\)/.test(main), 'dirty-state: isDirty 更新 (关闭拦截用)');
assert(/this\.setDirty\(false\);/.test(store) && /refreshDirty\(\)/.test(store), 'store: save+load 清脏; v140 起置脏改 emit() 指纹对比 (refreshDirty)');
assert(/getElectronAPI\(\)\?\.dirtyState\(b\)/.test(menu), 'electronMenu: reportDirtyState 上报');

console.log(failures ? `\nV121_CHECK_FAILED: ${failures}` : '\nV121_CHECK_PASSED');
process.exit(failures ? 1 : 0);
