// 验证器 v1: 解析器 / 滑条路径 / CS·AR换算 / timing查询 / 撤销逻辑
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v1/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v1/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

await import('file://' + out);
console.log('VERIFIER_V1_ALL_TESTS_PASSED');
fs.unlinkSync(out);
