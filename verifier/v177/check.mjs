// 验证器 v177: spinner 转盘转速对齐 osu!lazer
// ambient: DefaultSpinnerDisc.cs — RotateTo(25*duration/2000, preempt+duration) 从 preempt/2 前起
// 主动旋转: OsuAutoGenerator.cs — "0.05 rad/ms, or ~477 RPM[SPM], as per stable" (转盘期间)
// 背景: v125 误把 ambient 当恒定 12.5°/s, 且完全没有主动旋转 → 转盘看起来几乎静止
// 运行: node verifier/v177/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v177/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v177/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V177_TESTS_*)
fs.unlinkSync(out);

const renderer = readSrc('src/osu/renderer.ts');

// 函数签名: 需要 duration (ambient 速率与主动旋转 clamp 都依赖它)
assert(/export function spinnerAmbientRotation\(dtMs: number, preemptMs: number, durationMs: number\): number/.test(renderer), 'spinnerAmbientRotation 三参导出 (含 durationMs)');

// ambient 语义: (preempt+duration) 内转 25*duration/2000 度 (v125 误作恒定 12.5°/s)
assert(/25 \* durationMs \/ 2000\) \/ Math\.max\(1, preemptMs \+ durationMs\)/.test(renderer), 'ambient 速率 = 25*duration/2000 度 / (preempt+duration)');
assert(/Math\.min\(dtMs \+ preemptMs \/ 2, preemptMs \+ durationMs\)/.test(renderer), 'ambient 从 preempt/2 前起, duration+preempt/2 止 (lazer RotateTo 时序)');

// 主动旋转: 0.05 rad/ms (477 SPM), 转盘期间 [0, duration], 结束后保持
assert(/const spin = 0\.05 \* Math\.max\(0, Math\.min\(dtMs, durationMs\)\);/.test(renderer), '主动旋转 0.05 rad/ms (lazer OsuAutoGenerator, as per stable), clamp [0, duration]');

// 接线: drawSpinner 传入 duration
assert(/spinnerAmbientRotation\(dt, preempt, Math\.max\(1, end - o\.time\)\)/.test(renderer), 'drawSpinner 传入 duration = end - o.time');

// 旧的错误实现已移除
assert(!/0\.0125 \* Math\.max\(0, dtMs \+ preemptMs \/ 2\)/.test(renderer), 'v125 恒定 12.5°/s 已移除');

console.log(failures ? `\nV177 FAILED: ${failures}` : '\nV177 ALL PASSED');
process.exit(failures ? 1 : 0);
