// v598: 皮肤异步加载代次保护 (默认晚到 / 并发换肤)
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v598/_bundle.mjs');
await build({
  entryPoints: [path.join(root, 'verifier/v598/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  define: { 'import.meta.env.BASE_URL': "'/'" },
});
try { console.log(execSync(`node "${out}"`, { cwd: root, encoding: 'utf8' }).trim()); }
finally { if (fs.existsSync(out)) fs.unlinkSync(out); }

let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); };
const src = fs.readFileSync(path.join(root, 'src/osu/skin.ts'), 'utf8');
assert(src.includes('let skinLoadSeq = 0') && src.includes('const generation = ++skinLoadSeq'), '每次 reset 递增皮肤加载代次');
assert((src.match(/generation !== skinLoadSeq/g) ?? []).length >= 8, '默认图片、自定义图片、ini、动画和最终收尾均检查失效代次');
assert(src.includes('if (url) URL.revokeObjectURL(url)'), '图片解码失败/失效时释放 object URL');

console.log(failures ? `\nVERIFIER_V598_FAILED: ${failures}` : '\nVERIFIER_V598_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
