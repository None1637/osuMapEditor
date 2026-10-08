// 验证器 v370: Shift 锁比只对 4 个斜角手柄生效 (修复 cl/cr 左右边中点被 isCorner 误判为角)。
// 用户反馈: 单物件时左右边中点按 Shift 会锁比缩放 (lazer 不该有), 多物件时按 Shift 拖左右边
// 手柄脱离游标 (sy 清零后被锁比取 (sx+1)/2 同赋两轴 → X 倍率减半 + Y 凭空缩放, 扁框最明显)。
// 运行: node verifier/v370/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v370/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v370/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }

await import('file://' + out); // 纯函数断言 (内部自报 V370_TESTS_*)
fs.unlinkSync(out);

section('selectionBox.ts: isCorner 修正');
{
  const src = fs.readFileSync(path.join(root, 'src/osu/selectionBox.ts'), 'utf8');
  assert(/isCorner = \(a: ScaleAnchor\) => a\.length === 2 && a\[0\] !== 'c' && a\[1\] !== 'c';/.test(src),
    'isCorner: 两轴都不居中才是真角 (lazer !x1 && !y1)');
  assert(/if \(shiftLock && isCorner\(anchor\)\)/.test(src), 'Shift 锁比仍走 isCorner 门控');
}

if (failures) { console.error(`V370 FAILED: ${failures}`); process.exit(1); }
console.log('V370 ALL PASSED');
