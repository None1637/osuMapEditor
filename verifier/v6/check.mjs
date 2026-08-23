// 验证器 v6: M0 无损往返(真实谱面) + M1 AudioClock/HitSoundScheduler 单元测试
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v6/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v6/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

await import('file://' + out);
console.log('VERIFIER_V6_ALL_TESTS_PASSED');
fs.unlinkSync(out);
