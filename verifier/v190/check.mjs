// 验证器 v190: 修复粉药丸 (S 50 音量胶囊) 全部异常收缩成点 —
// v189 物件倒序绘制导致 samplePills 收集为 x 降序, pillLayout 依赖升序
// 运行: node verifier/v190/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v190/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v190/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V190_TESTS_*)
fs.unlinkSync(out);

section('Timelines.tsx: 药丸绘制前按 x 升序排序');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/measureCached\(g, p\.text\) \+ 10 \}\)\)\.sort\(\(a, b\) => a\.x - b\.x\)/.test(src), 'pillLayout 前 sort by x (v190; v245: 测宽改 measureCached 缓存)');
  assert(/for \(let oi = drawList\.length - 1; oi >= 0; oi--\)/.test(src), '物件仍倒序绘制 (v189 语义保留, v197 改倒序索引遍历)');
}

if (failures) { console.error(`V190 FAILED: ${failures}`); process.exit(1); }
console.log('V190 ALL PASSED');
