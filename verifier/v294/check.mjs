// 验证器 v294: 测试游玩 Mod (EZ/HR/HT/DT/RX/AP/AT)
// 依据: 用户要求「游玩测试支持选择各种mod (比如relax、hardrock、easy、dt等)」。
//   gameplay/mods.ts (新建): toggleMod 互斥 (EZ↔HR, HT↔DT, AT↔RX/AP), adjustDifficulty
//   (lazer 比率: EZ ×0.5; HR hp/od/ar ×1.4 min10, cs ×1.3 min10), clockRate (1.5/0.75/1),
//   isRelax/isAutopilot, applyHardRockFlip (y/curvePoints → 384−y), localStorage 持久化。
//   testPlaySession.ts: update 第 4 参 relax (自动击打按实际 delta 判定 + 滑条免按键跟随),
//   sliderBallAt 提取共用, autoCursorPos (AP: 跟球/跳下一 pending)。
//   TestPlayOverlay.tsx: 左上角 mod 栏 (切换即经 effect deps [mods] 重开会话), effBm 克隆
//   应用 difficulty/翻转, store.setRate(clockRate) + cleanup 恢复 prevRate,
//   AP 时忽略 mousemove 且每帧取 autoCursorPos, 点 mod 栏不触发击打 (data-mods-bar 守卫)。
// 运行: node verifier/v294/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v294/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v294/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const readSrc = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V294_TESTS_*)
fs.unlinkSync(out);

const mods = readSrc('src/osu/gameplay/mods.ts');
assert(/export type TestModId/.test(mods) && /'EZ'/.test(mods) && /'AT'/.test(mods), 'mods.ts: TestModId 七种');
assert(/export function toggleMod/.test(mods) && /CONFLICTS/.test(mods), 'mods.ts: toggleMod 互斥表');
assert(/export function adjustDifficulty/.test(mods) && /1\.4/.test(mods) && /1\.3/.test(mods), 'mods.ts: adjustDifficulty lazer 比率');
assert(/export function clockRate/.test(mods), 'mods.ts: clockRate');
assert(/export function applyHardRockFlip/.test(mods) && /384 - /.test(mods), 'mods.ts: HR 垂直翻转');
assert(/osu-editor:testplay-mods/.test(mods), 'mods.ts: localStorage 持久化');

const sess = readSrc('src/osu/gameplay/testPlaySession.ts');
assert(/update\(time: number, cursor: Vec2, keyHeld: boolean, relax = false\)/.test(sess), 'session: update relax 参数');
assert(/if \(relax\) this\.hit\(time, cursor\)/.test(sess), 'session: Relax 自动击打');
assert(/keyHeld \|\| relax/.test(sess), 'session: Relax 滑条免按键跟随');
assert(/autoCursorPos\(time: number\)/.test(sess), 'session: autoCursorPos (AP)');

const ov = readSrc('src/components/TestPlayOverlay.tsx');
assert(/data-mods-bar/.test(ov) && /testplay-mod-/.test(ov), 'overlay: mod 栏');
assert(/\}, \[mods\]\)/.test(ov), 'overlay: effect deps [mods] (换 mod 重开会话)');
assert(/store\.setRate\(clockRate\(mods\)\)/.test(ov), 'overlay: DT/HT 时钟倍率');
assert(/store\.setRate\(prevRate\)/.test(ov), 'overlay: 退出恢复编辑器倍率');
assert(/session\.autoCursorPos\(time\)/.test(ov), 'overlay: AP 光标自动');
assert(/session\.update\(time, cursorRef\.current, held, relax\)/.test(ov), 'overlay: relax 传入 session');

if (failures) { console.error(`\nV294_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV294_ALL_PASSED');
