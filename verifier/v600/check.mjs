// v600: 普通换图暂停, 右上角刷新谱面保留播放
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v600/_bundle.mjs');
const rawText = { name: 'raw', setup(build) {
  build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'raw' }));
  build.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
} };
await build({ entryPoints: [path.join(root, 'verifier/v600/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const store = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
ok(store.includes('initialDirty = false, preservePlayback = false') && store.includes('this.playing && !preservePlayback'), 'load 默认暂停, 仅显式 preservePlayback 保留');
ok(app.includes('src, r.audioKey, false, true'), '右上角 reloadMap 显式保留播放');
ok(app.includes('store.seek(Math.min(t0, lastEnd + 5000))'), '刷新后 seek 在新谱面上重锚定播放位置');
console.log(failures ? `VERIFIER_V600_FAILED: ${failures}` : 'VERIFIER_V600_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
