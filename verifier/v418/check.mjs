// 验证器 v418: 测试游玩 HUD — 底部歌曲进度条
//  - 进度 = (currentTime - 首物件时间) / (末物件结束时间 - 首物件时间), 钳 [0,1];
//  - 细轨道 (白 0.25) + 已播放高亮填充 (白 0.85), 居中横向避开左下 combo。
// 运行: node verifier/v418/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v418/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v418/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

await import('file://' + out); // 数值断言 (内部自报 V418_TESTS_*)
fs.unlinkSync(out);

const hud = read('src/osu/gameplay/hud.ts');
assert(/export function playProgress/.test(hud) && /\(time - firstTime\) \/ \(lastEnd - firstTime\)/.test(hud), '进度公式 (首物件→末物件结束)');
assert(/Math\.max\(0, Math\.min\(1,/.test(hud), '钳 [0,1]');

const sess = read('src/osu/gameplay/testPlaySession.ts');
assert(/readonly firstTime: number/.test(sess) && /this\.firstTime = first/.test(sess), '会话暴露 firstTime');

const ov = read('src/components/TestPlayOverlay.tsx');
assert(/playProgress\(time, session\.firstTime, session\.lastEnd\)/.test(ov), '进度条取会话首/末时间');
assert(/rgba\(255,255,255,0\.25\)/.test(ov) && /rgba\(255,255,255,0\.85\)/.test(ov), '轨道+高亮填充 (白色半透明)');
assert(/bw \* p/.test(ov), '已播放部分按进度填充');
// v492 适配: lazer SongProgressBar — 铺满窗口底边 (原居中 60% 宽语义作废)
assert(/bw = r\.width, bh = 3 \* scale/.test(ov) && /bx = 0, by = r\.height - bh - 1/.test(ov), '铺满窗口底边 (v492)');
// 进度条画在 HUD 段 (combo 之后, restore 之前)
assert(ov.indexOf('playProgress(time, session.firstTime') > ov.indexOf('`${sc.combo}x`'), '进度条在 combo 之后绘制');

console.log(failures ? `\nVERIFIER_V418_FAILED: ${failures} 处失败` : '\nVERIFIER_V418_ALL_TESTS_PASSED');
process.exit(failures ? 1 : 0);
