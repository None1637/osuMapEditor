// 验证器 v421: 测试游玩 HUD — Combo 数字弹出动画
//  - 左下 combo 计数在 combo 增加时弹跳: 瞬时 ~1.6x, 180ms ease-out 回 1.0 (lazer ComboCounter pop);
//    combo 归零/断连击不弹跳 (combo 减小不触发)。
// 运行: node verifier/v421/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v421/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v421/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V421_TESTS_*)
fs.unlinkSync(out);

const hud = read('src/osu/gameplay/hud.ts');
assert(/COMBO_POP_MS = 180/.test(hud), '弹跳时长 180ms');
assert(/export function comboPopScale/.test(hud) && /1 \+ 0\.6 \* \(1 - k\) \* \(1 - k\)/.test(hud), '1.6x ease-out 公式');

const ov = read('src/components/TestPlayOverlay.tsx');
assert(/let prevCombo = 0, comboPopAt = -1/.test(ov), '追踪 prev combo 与增长时刻');
assert(/if \(sc\.combo > prevCombo\) comboPopAt = time/.test(ov), '仅 combo 增加触发 (断连击不弹)');
assert(/comboPopScale\(time - comboPopAt\)/.test(ov), 'rAF 每帧算缩放');
// 缩放包裹 combo 绘制 (皮肤数字与文字回退都在 save/restore 内)
assert(/g\.scale\(popS, popS\)/.test(ov), '缩放变换应用');
const pi = ov.indexOf('g.scale(popS, popS)'), ci = ov.indexOf('drawSkinNumber(`${sc.combo}x`');
assert(pi > 0 && pi < ci, '缩放包裹 combo 绘制');

console.log(failures ? `\nVERIFIER_V421_FAILED: ${failures} 处失败` : '\nVERIFIER_V421_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
