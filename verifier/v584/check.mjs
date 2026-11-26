// v584: 换谱/刷新统一暂停播放
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v584/_bundle.mjs');
const rawText = { name: 'raw', setup(build) {
  build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'raw' }));
  build.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
} };
await build({ entryPoints: [path.join(root, 'verifier/v584/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); } finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
const src = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
if (!src.includes('this.playing && !preservePlayback')) { console.error('VERIFIER_V584_FAILED: 普通 load 未暂停'); process.exit(1); }
console.log('VERIFIER_V584_ALL_TESTS_PASSED');
