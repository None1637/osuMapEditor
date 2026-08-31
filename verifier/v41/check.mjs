// 验证器 v41: circleToBezier 顺时针弧修复 (合并/拆分 P 滑条变形) + 转连打语义修正 (时间等距/变距只改空间) + 节拍下拉框 + endPercent 0~400
// 运行: cd app && node verifier/v41/check.mjs; node verifier/v41/cdp-v41.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v41/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v41/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('bezierPath.ts: 顺时针弧修复 (step 带符号, 不再双重 dir)');
{
  const src = readSrc('src/osu/convert/bezierPath.ts');
  assert(/const a0 = start \+ step \* i, a1 = a0 \+ step/.test(src), '角度推进用带符号 step (不乘 dir)');
  assert(/Math\.abs\(total\) \/ thetaMax/.test(src), '分块数取 |total| (v237: thetaMax 误差驱动, 下钳 90° 段数不增)');
  assert(!/dir \* step/.test(src), '无 dir*step 双重取反残留');
}

section('stream.ts: v41 语义 (时间等距 + streamFractions 空间分布)');
{
  const src = readSrc('src/osu/convert/stream.ts');
  assert(/export function streamFractions/.test(src), '导出 streamFractions');
  assert(/Math\.max\(0, p\.endPercent \/ 100\)/.test(src), 'endPercent 允许 0');
  assert(/fracs\[i\] \* slides/.test(src), '位置取 streamFractions (非时间比例)');
  // streamTimes 内不得再引用 weight (时间恒等距)
  const fn = src.slice(src.indexOf('export function streamTimes'), src.indexOf('export function streamFractions'));
  assert(!/weight\(/.test(fn), 'streamTimes 不再用 weight (时间恒等距)');
}

section('StreamDialog: 节拍下拉框 + endPercent 0~400');
{
  const dlg = readSrc('src/components/convert/StreamDialog.tsx');
  assert(/SPACINGS.*\[1, 2, 3, 4, 6, 8, 12, 16\]/.test(dlg.replace(/\s/g, ' ')) || /\[1, 2, 3, 4, 6, 8, 12, 16\]\.map/.test(dlg), '节拍分母与节拍吸附同组');
  assert(/data-conv="spacing"/.test(dlg) && /<select/.test(dlg), '间距为下拉框 (data-conv=spacing)');
  assert(/Math\.max\(0, Math\.min\(400, v\)\)/.test(dlg), 'endPercent 钳制 0~400');
}

if (failures) { console.error(`\nVERIFIER_V41_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V41_ALL_TESTS_PASSED');
