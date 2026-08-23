// 验证器 v4: v3 + [Editor]段解析/完整General与Metadata字段/往返保留(用户真实谱面片段)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v4/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v4/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

await import('file://' + out);
console.log('VERIFIER_V4_ALL_TESTS_PASSED');
fs.unlinkSync(out);
