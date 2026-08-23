// 验证器 v2: 在 v1 基础上增加 fadeIn公式/kiai位/转盘往返/路径重建一致性
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v2/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v2/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

await import('file://' + out);
console.log('VERIFIER_V2_ALL_TESTS_PASSED');
fs.unlinkSync(out);
