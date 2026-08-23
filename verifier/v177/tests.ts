import assert from 'node:assert';
import { spinnerAmbientRotation } from '../../src/osu/renderer';

// v177: spinner 转盘转速对齐 osu!lazer —
// ambient (DefaultSpinnerDisc.cs): 从 preempt/2 前起, (preempt+duration) 内共转 25*duration/2000 度
// 主动旋转 (OsuAutoGenerator.cs: "0.05 rad/ms, or ~477 RPM[SPM], as per stable"): 转盘期间 0.05 rad/ms
const DEG = Math.PI / 180;

// 时序边界
assert.strictEqual(spinnerAmbientRotation(-1200, 600, 2000), 0, 'preempt/2 之前不转');
assert.strictEqual(spinnerAmbientRotation(-300, 600, 2000), 0, 'preempt/2 起点角度为 0');

// 转盘开始 (dt=0): 仅 ambient = 25/(600+2000) °/ms × 300ms
assert.ok(Math.abs(spinnerAmbientRotation(0, 600, 2000) - (25 / 2600) * 300 * DEG) < 1e-12, '开始时仅 ambient (preempt/2 的量)');

// 转盘期间: 0.05 rad/ms 主动旋转 + ambient
assert.ok(Math.abs(spinnerAmbientRotation(1000, 0, 2000) - (50 + 12.5 * DEG)) < 1e-9, '1000ms: 50rad 主动旋转 + 12.5° ambient');
assert.ok(Math.abs(spinnerAmbientRotation(2000, 0, 2000) - (100 + 25 * DEG)) < 1e-9, '2000ms 全程: 100rad + 25° ambient');

// 主动旋转速率: 0.05 rad/ms ≈ 477.46 SPM (lazer 注释的 ~477)
const spm = (0.05 * 60000) / (2 * Math.PI);
assert.ok(Math.abs(spm - 477.46) < 0.01, '0.05 rad/ms ≈ 477 SPM');

// ambient 在 dt = duration + preempt/2 时恰好完成 (lazer RotateTo 终点), 之后角度保持
assert.ok(Math.abs(spinnerAmbientRotation(2300, 600, 2000) - (100 + 25 * DEG)) < 1e-9, 'ambient 于 duration+preempt/2 完成');
assert.strictEqual(spinnerAmbientRotation(5000, 600, 2000), spinnerAmbientRotation(3000, 600, 2000), '结束后保持最终角度');

console.log('V177_TESTS_PASSED');
