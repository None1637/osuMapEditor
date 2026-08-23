// 验证器 v196: paste 取整 round → floor (粘贴时刻 == 底部时间戳显示时刻)
// 运行: node verifier/v196/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v196/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v196/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // store 层断言 (内部自报 V196_TESTS_*)
fs.unlinkSync(out);

section('store.ts: paste 两路径统一 floor');
{
  const src = readSrc('src/osu/store.ts');
  assert(/o\.time = Math\.floor\(c\.time \+ atTime\);/.test(src), '物件时间 floor');
  assert(/o\.endTime = Math\.floor\(c\.endTime \+ atTime\)/.test(src), 'endTime floor');
  assert(/const t = Math\.floor\(c\.time \+ atTime\);/.test(src), '绿线时间 floor');
  assert(!/Math\.round\(c\.time \+ atTime\)/.test(src), '旧 round 路径已删');
  assert(/v196/.test(src), 'v196 注释存在');
}

section('Timelines.tsx: 时间戳显示确为 floor (一致性前提)');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/const m = Math\.floor\(ms \/ 60000\), s = Math\.floor\(\(ms % 60000\) \/ 1000\), mm = Math\.floor\(ms % 1000\)/.test(src), 'fmt 用 floor 显示毫秒');
}

if (failures) { console.error(`V196 FAILED: ${failures}`); process.exit(1); }
console.log('V196 ALL PASSED');
