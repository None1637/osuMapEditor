import assert from 'node:assert';
import { spinnerApproachRatio, spinnerAmbientRotation } from '../../src/osu/renderer';

// 缩圈比例 (lazer LegacyOldStyleSpinner.cs: 开始前恒定 ~1.4x, 转盘期间线性缩到 ~0.08x)
assert.strictEqual(spinnerApproachRatio(-0.5), 1.4, '开始前(负 frac)恒定 1.4x');
assert.strictEqual(spinnerApproachRatio(0), 1.4, '转盘开始时刻 1.4x');
assert.ok(Math.abs(spinnerApproachRatio(0.5) - 0.74) < 1e-9, '转盘中期 = 1.4 与 0.08 中点');
assert.ok(Math.abs(spinnerApproachRatio(1) - 0.08) < 1e-9, '转盘结束缩到 0.08x (缩进转盘内部)');
assert.ok(Math.abs(spinnerApproachRatio(2) - 0.08) < 1e-9, '超出结束仍 0.08x (clamp)');

// ambient 自转 (v177 适配: lazer DefaultSpinnerDisc.cs RotateTo(25*duration/2000, preempt+duration),
// 从 preempt/2 前起; v125 的恒定 12.5°/s 系误读。转盘期间另有 0.05 rad/ms 主动旋转, 详见 v177)
const DEG = Math.PI / 180;
assert.strictEqual(spinnerAmbientRotation(-1200, 600, 2000), 0, 'preempt/2 之前不转');
assert.strictEqual(spinnerAmbientRotation(-300, 600, 2000), 0, 'preempt/2 起点角度为 0');
assert.ok(Math.abs(spinnerAmbientRotation(0, 600, 2000) - (25 / 2600) * 300 * DEG) < 1e-12, '转盘开始时仅 ambient (preempt/2 的量)');
assert.ok(Math.abs(spinnerAmbientRotation(2000, 0, 2000) - (100 + 25 * DEG)) < 1e-9, 'preempt=0 全程: 100rad 主动旋转 + 25° ambient (v177)');

console.log('V125_TESTS_PASSED');
