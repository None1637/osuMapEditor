// v585: bookmark 区间整体 hitsound 编辑
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v585/_bundle.mjs');
const rawText = { name: 'raw', setup(build) {
  build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'raw' }));
  build.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
} };
await build({ entryPoints: [path.join(root, 'verifier/v585/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const store = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src/osu/electronBridge.ts'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/osu/electronMenu.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const dlg = fs.readFileSync(path.join(root, 'src/components/BookmarkHitSoundDialog.tsx'), 'utf8');
assert(store.includes('bookmarkHitSoundObjects()') && store.includes('applyBookmarkHitSound('), 'store 区间查询与批量应用');
assert(main.includes('"menu.hitsound_bookmarks"') && main.includes('mT("menu.hitsound_bookmarks")'), 'Timing 菜单项与三语文案');
assert(bridge.includes("timing-hitsound-bookmarks") && route.includes("store.openBookmarkHitSound()"), 'bridge → 路由');
assert(app.includes('store.bookmarkHitSoundOpen && <BookmarkHitSoundDialog />'), 'App 挂载窗口');
assert(dlg.includes('data-bookmark-hs-apply') && dlg.includes('store.applyBookmarkHitSound(enabled'), '窗口应用区间 hitsound');
console.log(failures ? `\nVERIFIER_V585_FAILED: ${failures}` : '\nVERIFIER_V585_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
