// v597: Timing/Bookmarks 菜单增删入口 + lazer 2000ms 最近书签删除阈值
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v597/_bundle.mjs');
const rawText = { name: 'raw', setup(build) {
  build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'raw' }));
  build.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
} };
await build({ entryPoints: [path.join(root, 'verifier/v597/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }

let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const main = read('electron/main.cjs');
const bridge = read('src/osu/electronBridge.ts');
const route = read('src/osu/electronMenu.ts');
const hotkeys = read('src/osu/hotkeys.ts');
const store = read('src/osu/store.ts');

assert(main.includes('mT("menu.bookmarks")') && main.includes('mT("menu.bookmark_add")') && main.includes('mT("menu.bookmark_remove")'), 'Timing 菜单含 Bookmarks 增删子菜单');
assert(main.includes('acc("bookmark-add", "CmdOrCtrl+B")') && main.includes('acc("bookmark-remove", "CmdOrCtrl+Shift+B")'), '菜单显示并注册现有增删快捷键');
assert(bridge.includes("{ type: 'bookmark-add' }") && bridge.includes("{ type: 'bookmark-remove' }"), 'Electron 命令类型完整');
assert(route.includes("case 'bookmark-add': store.addBookmark(store.currentTime)")
  && route.includes("case 'bookmark-remove': store.removeBookmarkNear(store.currentTime)"), '菜单命令路由到现有 store 书签操作');
assert(hotkeys.includes("id: 'bookmark-add'") && hotkeys.includes("id: 'bookmark-remove'"), '快捷键仍可在设置面板查看和改键');
assert(store.includes('removeBookmarkNear(t: number, threshold = 2000)'), '删除阈值对齐 lazer BookmarkController = 2000ms');

console.log(failures ? `\nVERIFIER_V597_FAILED: ${failures}` : '\nVERIFIER_V597_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
