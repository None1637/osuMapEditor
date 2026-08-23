// 验证器 v178: 滑条表现对齐 osu!lazer — ① 滑条头被点击后头圈消失 ② slider tick 渐进显示
// lazer 出处:
//   DrawableHitCircle.UpdateHitStateTransforms — 命中后头圈 FadeOut (无打击动画 60ms; 有则 240ms 放大 1.4x 爆炸淡出)
//   DrawableSliderTick + DrawableOsuHitObject.InitialLifetimeOffset=TimePreempt — tick 各自在
//   (自身时间-preempt) 出现, FadeIn(ANIM_DURATION=150ms) + ScaleTo(0.5→1, 600ms, OutElasticHalf)
//   (OutElasticHalf 公式逐字取自 osu-framework DefaultEasingFunction.cs)
// 运行: node verifier/v178/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v178/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v178/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V178_TESTS_*)
fs.unlinkSync(out);

const renderer = readSrc('src/osu/renderer.ts');

// 1. 纯函数导出
assert(/export function outElasticHalf\(t: number\): number/.test(renderer), 'outElasticHalf 导出 (osu-framework 公式)');
assert(/export function sliderHeadHitState\(dt: number\)/.test(renderer), 'sliderHeadHitState 导出');
assert(/export function sliderTickState\(time: number, tickTime: number, spanStart: number, spanIndex: number, preempt: number\)/.test(renderer), 'sliderTickState 导出 (v204: 加 spanStart/spanIndex)');

// 2. 滑条头命中后消失: 头部三块绘制被 hs.alpha 门控, 数字盒子随 hs.scale
assert(/const hs = sliderHeadHitState\(dt\);/.test(renderer), 'drawSlider 计算头部命中状态');
assert(/if \(hs\.alpha > 0\) \{/.test(renderer), '头圈/overlay/数字被 alpha 门控 (点击后消失)');
assert(/drawNumber\(g, skin, num, o\.x, o\.y, size \* hs\.scale\)/.test(renderer), '头部数字随命中爆炸缩放');
assert(/!displaySettings\.hitExplosion/.test(renderer), '关「note点击特效」时头圈命中立即消失 (与单点一致)');

// 3. tick 渐进显示: 走 sliderTickState(time, t.timeMs, preempt), 尺寸乘 ts.scale
assert(/const ts = sliderTickState\(time, t\.timeMs, o\.time \+ t\.spanIndex \* span, t\.spanIndex, preempt\);/.test(renderer), 'tick 循环走 sliderTickState (v204: lazer SliderTick 公式出现时机)');
assert(/drawSprite\(g, skin\.sliderscorepoint, p\.x, p\.y, r \* 0\.6 \* ts\.scale\)/.test(renderer), 'tick 尺寸乘弹入缩放 (0.5→1 OutElasticHalf)');
assert(!/if \(time > t\.timeMs \+ 150\) continue;/.test(renderer), '旧的一次性全显示 tick 循环已移除');

// 4. lazer 数值: 150ms 淡入 (ANIM_DURATION) / 600ms 弹入 / 60ms 无动画淡出 / 240ms 爆炸
assert(/fadeIn = Math\.min\(1, \(time - showAt\) \/ 150\)/.test(renderer), 'tick 150ms 淡入 (lazer ANIM_DURATION)');
assert(/outElasticHalf\(Math\.min\(1, \(time - showAt\) \/ 600\)\)/.test(renderer), 'tick 600ms 弹入 (lazer ANIM_DURATION*4)');
assert(/Math\.max\(0, 1 - dt \/ HIT_LINGER\)/.test(renderer), 'v203: 头圈暂留模式同单点 HIT_LINGER 渐隐 (替代 60ms 淡出)');
assert(/dt \/ 240/.test(renderer), '头圈打击动画 240ms (与单点命中爆炸一致)');

console.log(failures ? `\nV178 FAILED: ${failures}` : '\nV178 ALL PASSED');
process.exit(failures ? 1 : 0);
