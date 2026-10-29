// v511: Selection Centre 点集质心 + 等边三角形旋转回归
// 运行: node verifier/v511/check.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v511/_bundle.mjs');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const rawText = {
  name: 'raw-text',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'raw-text' }));
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' }));
  },
};

console.log('== A: 质心/旋转/预览提交单测');
try {
  await build({ entryPoints: [path.join(root, 'verifier/v511/tests.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, plugins: [rawText] });
  const r = execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' });
  console.log(r.trim().split('\n').map(l => '  ' + l).join('\n'));
} finally {
  if (fs.existsSync(out)) fs.unlinkSync(out);
}

console.log('== B: 源码契约');
{
  const tr = read('src/osu/transform.ts');
  assert(/sumX \+= p\.x/.test(tr) && /sumY \+= p\.y/.test(tr) && /x: sumX \/ n, y: sumY \/ n/.test(tr), 'selectionCenter 使用点集算术平均');
  assert(!/minX \+ maxX/.test(tr), '旧 AABB 中心已移除');
  const st = read('src/osu/store.ts');
  assert((st.match(/选区点集质心 \(v511\)/g) ?? []).length === 2, 'store 两处 Selection Centre 注释同步');
  assert(/选区点集质心 \(v511\)/.test(read('src/osu/duplicate.ts')), '批量复制 Selection Centre 注释同步');
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\nVERIFIER_V511_FAILED: ${failures} 处失败` : '\nVERIFIER_V511_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
