// 验证器 v203: 暂留模式 (点击特效开+打击动画关) 滑条头同单点暂留 — 原大小 HIT_LINGER 渐隐 + 本体变白
// 运行: node verifier/v203/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v203/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v203/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V203_TESTS_*)
fs.unlinkSync(out);

section('renderer.ts: 暂留模式滑条头');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/1 - dt \/ HIT_LINGER/.test(src), '暂留模式头圈 HIT_LINGER 渐隐 (替代 60ms)');
  assert(!/1 - dt \/ 60/.test(src), '60ms 闪没分支已删');
  assert(/import \{[^}]*HIT_LINGER[^}]*\} from '\.\/lifecycle'/.test(src), 'HIT_LINGER 从 lifecycle 导入');
  assert(/const headColor = headLinger && dt >= 0 \? '#ffffff' : color;/.test(src), '暂留命中后头圈本体变白 (同 v200 单点)');
  assert(/tintedSprite\(skin\.sliderstartcircle, headColor\)/.test(src), 'sliderstartcircle 用 headColor 染色');
}

if (failures) { console.error(`V203 FAILED: ${failures}`); process.exit(1); }
console.log('V203 ALL PASSED');
