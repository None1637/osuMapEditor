// 验证器 v5: v4 + AR官方公式全区间断言/preempt与fadeIn严格2/3关系(用户提供的AR参考文档)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v5/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v5/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

await import('file://' + out);
console.log('VERIFIER_V5_ALL_TESTS_PASSED');
fs.unlinkSync(out);
