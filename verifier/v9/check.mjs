// 验证器 v9: hitsound 采样解析纯函数 + 真实谱面目录采样收集 (M: 真实采样播放)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v9/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v9/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

await import('file://' + out);
console.log('VERIFIER_V9_ALL_TESTS_PASSED');
fs.unlinkSync(out);
