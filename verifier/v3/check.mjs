// 验证器 v3: v2 + [Events]背景文件名解析(带引号/不带引号)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v3/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v3/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

await import('file://' + out);
console.log('VERIFIER_V3_ALL_TESTS_PASSED');
fs.unlinkSync(out);
