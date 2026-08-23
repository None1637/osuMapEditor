// v123 源码接线断言: 未保存改动指示器链路 (v124 起指示器位置移到游玩区左下角, 见 v124)
// 运行: node verifier/v123/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const app = read('src/App.tsx');
const store = read('src/osu/store.ts');

// v124: 顶栏指示器已移除 (改游玩区左下角); 顶栏不再含指示器
const bar = app.slice(app.indexOf('h-12 bg-[#1a1a22]'), app.indexOf('页签栏'));
assert(!bar.includes('data-dirty-indicator'), 'v124: 顶栏指示器已移除 (改游玩区左下角)');
// 即时显隐链路保留
assert(/this\.emitPlayback\(\);/.test(store) && /private setDirty/.test(store), 'store: setDirty 翻转即刷新 UI');
assert(/data-dirty-indicator/.test(app), 'App: 指示器仍存在 (位置见 v124)');

console.log(failures ? `\nV123_CHECK_FAILED: ${failures}` : '\nV123_CHECK_PASSED');
process.exit(failures ? 1 : 0);
