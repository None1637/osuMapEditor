// 验证器 v39: F4 卡特姆(C)<->贝塞尔(B) 滑条互转 + sliderPath catmull 端点约定对齐 lazer
// 依据: lazer BezierConverter.cs ConvertCatmullToBezierAnchors(:259) (C->B 精确公式, v37 bezierPath.ts 复用);
//   ConvertHitObjectParser.cs:403-407 (传统格式 catmull 不按重复点分段); PathApproximator 端点约定 (首 clamp/末端外推)
// 运行: cd app && node verifier/v39/check.mjs; node verifier/v39/cdp-curve.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v39/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v39/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

// v141 适配: 曲线互转 (c2b / b2c / CurveDialog / curveConvert.ts) 整体废弃,
// 原「curveConvert.ts 接线」「Inspector 曲线互转按钮」「CurveDialog + App 挂载」三节与
// tests.ts 的 C->B/B->C 纯函数断言随之移除; 下方 sliderPath 断言仍有效。

section('sliderPath.ts: catmull 端点约定对齐 lazer + buildEvenSpacing 丢长修复');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(src.includes('2 * b.x - a.x'), 'catmullPath 末端外推 (v4 = 2*v3 - v2, lazer PathApproximator 同款)');
  assert(/首端 clamp/.test(src), '首端 clamp 注释 (v1 = v2)');
  assert(/acc \+= d; since \+= d;/.test(src), 'buildEvenSpacing 累积全部细分长度 (v39 丢长修复)');
  assert(/if \(since > 0\.5\)/.test(src), '点距按距上次保留点判定 (不再整步跳丢)');
}

if (failures) { console.error(`\nVERIFIER_V39_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V39_ALL_TESTS_PASSED');
