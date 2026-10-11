// 验证器 v196: paste 取整 round → floor (粘贴时刻 == 底部时间戳显示时刻)
// v380 适配: 取整规则统一回 round (与所有放置入口一致, 修复「粘贴物件偏差 1ms」) — 本验证器的 floor
//   断言改为 round 断言; 行为语义以 v380 为准 (粘贴落点 = 点击放置落点)。
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

section('store.ts: paste 两路径统一 round (v380 适配: floor → round, 与放置入口一致)');
{
  const src = readSrc('src/osu/store.ts');
  assert(/o\.time = Math\.round\(c\.time \+ at\);/.test(src), '物件时间 round (v380)');
  assert(/o\.endTime = Math\.round\(c\.endTime \+ at\)/.test(src), 'endTime round (v380)');
  assert(/const t = Math\.round\(c\.time \+ at\);/.test(src), '绿线时间 round (v380)');
  assert(!/Math\.floor\(c\.time \+ at\)/.test(src), 'v196 的 floor 路径已由 v380 移除');
  assert(/v380/.test(src), 'v380 注释存在');
}

section('Timelines.tsx: 时间戳显示确为 floor (一致性前提)');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/const m = Math\.floor\(ms \/ 60000\), s = Math\.floor\(\(ms % 60000\) \/ 1000\), mm = Math\.floor\(ms % 1000\)/.test(src), 'fmt 用 floor 显示毫秒');
}

if (failures) { console.error(`V196 FAILED: ${failures}`); process.exit(1); }
console.log('V196 ALL PASSED');
