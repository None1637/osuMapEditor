// v125 源码接线断言: spinner 缩圈 + 转盘旋转对齐 osu!lazer
// (LegacyOldStyleSpinner.cs: 缩圈 1.4x→0.08x 贯穿转盘期间; DefaultSpinnerDisc.cs: 12.5°/s ambient 自转)
// 运行: node verifier/v125/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const renderer = read('src/osu/renderer.ts');

// 纯函数存在并导出
assert(/export function spinnerApproachRatio\(frac: number\): number/.test(renderer), 'spinnerApproachRatio 导出');
assert(/export function spinnerAmbientRotation\(dtMs: number, preemptMs: number, durationMs: number\): number/.test(renderer), 'spinnerAmbientRotation 导出 (v177 适配: 加 durationMs 参)');

// 缩圈语义: 1.4 → 0.08 (lazer SPRITE_SCALE*1.86 起, ScaleTo(SPRITE_SCALE*0.1) 终)
assert(/frac <= 0 \? 1\.4 : 1\.4 \+ \(0\.08 - 1\.4\) \* Math\.min\(1, frac\)/.test(renderer), '缩圈: 开始前恒定 1.4x, 期间线性缩至 0.08x');
assert(!/2\.2 - 1\.2 \* frac/.test(renderer), '旧的错误缩圈范围 (2.2→1.0) 已移除');

// 自转语义 (v177 适配: ambient = (preempt+duration) 内转 25*duration/2000°, 从 preempt/2 前起;
// v125 的恒定 12.5°/s 系误读; 另加 0.05 rad/ms 主动旋转, 详见 v177)
assert(/25 \* durationMs \/ 2000\) \/ Math\.max\(1, preemptMs \+ durationMs\)/.test(renderer), 'ambient 自转速率 (v177 修正后语义)');
assert(/const spin = 0\.05 \* Math\.max\(0, Math\.min\(dtMs, durationMs\)\);/.test(renderer), '主动旋转 0.05 rad/ms (v177, lazer OsuAutoGenerator)');

// 接线: drawSpinner 接收 preempt, 转盘用 drawSprite 带角度, 缩圈用 spinnerApproachRatio
assert(/function drawSpinner\(rc: RenderCtx, o: HitObject, dt: number, preempt: number\)/.test(renderer), 'drawSpinner 接收 preempt 参数');
assert(/else drawSpinner\(rc, o, dt, preempt\);/.test(renderer), '调用处传入 preempt');
assert(/drawSprite\(g, skin\.spinnerCircle, cx, cy, size, spinnerAmbientRotation\(dt, preempt, Math\.max\(1, end - o\.time\)\)\)/.test(renderer), '转盘带旋转角绘制 (v177: 传入 duration)');
assert(/drawSprite\(g, skin\.spinnerApproach, cx, cy, apSize\)/.test(renderer), '缩圈仍绘制');
assert(/const apSize = size \* spinnerApproachRatio\(frac\);/.test(renderer), '缩圈尺寸走 spinnerApproachRatio');
assert(!/360 \* \(1 - frac \* 0\.12\)/.test(renderer), '旧的转盘缩放 (360*(1-frac*0.12)) 已移除 (lazer 转盘恒定大小)');

console.log(failures ? `\nV125_CHECK_FAILED: ${failures}` : '\nV125_CHECK_PASSED');
process.exit(failures ? 1 : 0);
