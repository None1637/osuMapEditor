// 验证器 v10: 滑条音效规划 (边缘 repeat 音 / slidertick / sliderslide 循环)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v10/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v10/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

await import('file://' + out);
console.log('VERIFIER_V10_ALL_TESTS_PASSED');
fs.unlinkSync(out);
