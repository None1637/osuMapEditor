// v104 源码接线断言: 波形窗钳制修复 + 20ms 对齐补偿
// 运行: node verifier/v104/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

// v127 适配: WaveformPanel 废弃, 绘制层移到 waveformDraw.ts (面板拖动钳制断言随面板删除)
const wp = read('src/osu/waveformDraw.ts');
const wd = read('src/osu/waveformData.ts');

// v112 适配: +20ms 显示偏移恢复 (lazer WAVEFORM_VISUAL_OFFSET, PR#26136 — 谱面计时应含 ~20ms 历史延迟;
// v106 归 0 是误判: Chrome≈ffmpeg 只证明解码管线无额外偏移, 不等于 lazer 的社区显示约定)
assert(/WAVEFORM_VISUAL_OFFSET_MS = 20/.test(wd), 'v112: WAVEFORM_VISUAL_OFFSET_MS = 20 (waveformData, 对齐 lazer)');
assert(/const msA = t0 \+ \(cx \/ W\) \* win \+ WAVEFORM_VISUAL_OFFSET_MS/.test(wp), 'v112: 波形采样取 t+20 (内容左移 20ms)');
assert(/const ms = t0 \+ \(\(x0 \+ cx \+ 0\.5\) \/ W\) \* win \+ WAVEFORM_VISUAL_OFFSET_MS/.test(wp), 'v112: 频谱列采样像素中心 +20ms');
assert(!/innerHeight - 300/.test(wp), '旧单向 maxOff 钳制不存在 (面板已废弃)');

console.log(failures ? '\nV104_CHECK_FAILED: ' + failures : '\nV104_CHECK_PASSED');
process.exit(failures ? 1 : 0);
