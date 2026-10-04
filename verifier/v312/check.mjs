// 验证器 v312: 波形漂移修复 — computePeaks 分桶边界精确换算 (44100Hz 设备 +0.227% 线性漂移)
// 根因: spb = round(sr/1000) 在 44100Hz 下 44.1→44, 每桶少算 0.1 采样;
//       48000Hz 设备 spb=48 整数无误差 → 开发机无法复现, 用户机器 (44.1k) 越往后越偏。
// 运行: node verifier/v312/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('纯函数单测 (44100Hz 落桶精确)');
{
  try {
    execSync('npx esbuild verifier/v312/tests.ts --bundle --platform=node --outfile=node_modules/.cache/v312-tests.cjs', { cwd: root, stdio: 'pipe' });
    const out = execSync('node node_modules/.cache/v312-tests.cjs', { cwd: root, encoding: 'utf8' });
    assert(out.includes('V312_TESTS_PASSED'), 'V312_TESTS_PASSED');
  } catch (e) {
    failures++;
    console.error('  FAIL: 单测执行失败\n', String(e.stdout ?? '') + String(e.stderr ?? ''));
  }
}

section('computePeaks 精确分桶');
{
  const wd = readSrc('src/osu/waveformData.ts');
  assert(!/const spb|\/ spb\)/.test(wd), 'spb 取整已移除 (注释提及不算)');
  assert(/const k = 1000 \/ \(buf\.sampleRate \* msPerBucket\);/.test(wd), '采样下标→桶号 精确比例 k (= 时间ms/msPerBucket)');
  assert(/const b = \(i \* k\) \| 0;/.test(wd), '逐采样 floor(i×k) 分桶');
  assert(/Math\.ceil\(buf\.length \* k\)/.test(wd), '桶数按精确比例上取整');
}

section('编译');
{
  execSync('npx tsc -b', { cwd: root, stdio: 'pipe' });
  console.log('  ok: tsc -b 通过');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv312 全部通过');
process.exit(failures ? 1 : 0);
