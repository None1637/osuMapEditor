// 验证器 v11: hitsound 与 osu! 行为对齐 (音量 / 距离制 tick / 头节点继承)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v11/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v11/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

await import('file://' + out);
console.log('VERIFIER_V11_ALL_TESTS_PASSED');
fs.unlinkSync(out);
