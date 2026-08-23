// 验证器 v7: 物件生命周期(淡出修复) + 曲库元数据快解析 单元测试
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v7/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v7/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

await import('file://' + out);
console.log('VERIFIER_V7_ALL_TESTS_PASSED');
fs.unlinkSync(out);
