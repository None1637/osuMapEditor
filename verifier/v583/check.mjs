// v583: 镜像/旋转/缩放/反转后保持首件与前件的锁定间距
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v583/_bundle.mjs');
const rawText = {
  name: 'raw-text',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'raw-text' }));
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
  },
};
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
try {
  await build({ entryPoints: [path.join(root, 'verifier/v583/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
  console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim());
} finally { if (fs.existsSync(out)) fs.unlinkSync(out); }
const spacing = fs.readFileSync(path.join(root, 'src/osu/spacing.ts'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');
assert(spacing.includes('export function lockDistanceAfterTransform') && spacing.includes('new Set(objs.map(o => o.id))'), '共享校正函数排除选区找前件');
assert((store.match(/if \(this\.distanceLock\) for \(const s of lockDistanceAfterTransform/g) ?? []).length === 3, 'applyTransform/reverseSelected/reflectSelected 三处接入');
console.log(failures ? `\nVERIFIER_V583_FAILED: ${failures}` : '\nVERIFIER_V583_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
