// 验证器 v92: pattern 收藏归入当前选中分类 + 主界面快捷键提示更新 (Ctrl+G 反转)
// 运行: cd app && node verifier/v92/check.mjs; node verifier/v92/cdp-v92.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v92/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v92/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('patternLibrary.ts + store.ts: 收藏带分类');
{
  const pl = readSrc('src/osu/patternLibrary.ts');
  assert(/objects: HitObject\[\], group: string = DEFAULT_GROUP\)/.test(pl), 'makePattern 第五参 group (缺省未分类)');
  assert(/id, name, group, createdAt/.test(pl), 'makePattern 用入参 group');
  const store = readSrc('src/osu/store.ts');
  assert(/addPatternFromSelection\(name: string, group\?: string\)/.test(store), 'store 收藏签名带 group');
  assert(/makePattern\(newPatternId\(\), name \|\| `pattern \$\{this\.patterns\.length \+ 1\}`, this\.beatmap, objs, group\)/.test(store), 'store 传 group 给 makePattern');
}

section('PatternPanel.tsx: 收藏到当前选中分类');
{
  const panel = readSrc('src/components/PatternPanel.tsx');
  assert(/addPatternFromSelection\(collectName\.trim\(\), group\)/.test(panel), '收藏按钮传当前分类 group');
}

section('App.tsx: 快捷键提示更新');
{
  const app = readSrc('src/App.tsx');
  assert(/Ctrl\+G 反转选区/.test(app), '提示含 Ctrl+G 反转选区');
  assert(!/Ctrl\+G 旋转/.test(app), '旧提示 Ctrl+G 旋转 已移除');
  assert(/Ctrl\+,\/\. 旋转90°/.test(app), '提示含 Ctrl+,/. 旋转90°');
}

if (failures) { console.error(`\nVERIFIER_V92_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V92_ALL_PASSED');
