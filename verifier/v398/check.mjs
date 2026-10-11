// 验证器 v398: 滑条转连打间距曲线重做 (soulten: 旧「指数」不是底数; UI 改自定义勾选 + 三项)
// 运行: cd app && node verifier/v398/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v398/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v398/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('stream.ts: 新模型');
{
  const src = readSrc('src/osu/convert/stream.ts');
  assert(/customSpacing: false, expoBase: 1, rampPercent: 200, repeats: 1, mirrorRepeat: false/.test(src), '默认参数: 不勾自定义 (固定间距)');
  assert(/export function migrateStreamParams/.test(src) && /case 'bellInv'/.test(src), '遗留参数迁移 (bellInv → 倍率 200-end)');
  assert(/!p\.customSpacing/.test(src), 'streamFractions: 不勾自定义走固定间距分支');
}

section('StreamDialog.tsx: 勾选 + 三项');
{
  const src = readSrc('src/components/convert/StreamDialog.tsx');
  assert(/data-conv="custom-spacing"/.test(src), '自定义连打间距勾选框');
  assert((src.match(/params\.customSpacing && \(/g) || []).length === 3, '勾选后出三行 (底数/倍率/重复+镜像)');
}

section('旧验证器适配标注');
{
  assert(/v398/.test(readSrc('verifier/v36/tests.ts')), 'v36 tests 已适配');
  assert(/v398/.test(readSrc('verifier/v40/tests.ts')), 'v40 tests 已适配');
  assert(/v398/.test(readSrc('verifier/v40/check.mjs')), 'v40 check 已适配');
  assert(/v398/.test(readSrc('verifier/v41/check.mjs')), 'v41 check 已适配');
  assert(/v398/.test(readSrc('verifier/v222/check.mjs')), 'v222 check 已重写到底数模型');
  assert(/v398/.test(readSrc('verifier/v230/tests.ts')), 'v230 tests 已适配');
  assert(/v398/.test(readSrc('verifier/v346/check.mjs')), 'v346 动态域 curve_* → stream_*');
}

if (failures) { console.error(`V398 FAILED (${failures})`); process.exit(1); }
console.log('V398 ALL PASSED');
