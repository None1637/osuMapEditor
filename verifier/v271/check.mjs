// 验证器 v271: 时间轴半透明模式减淡波形底/频谱底/暗化层 (修复「底色是纯黑的」)。
// 需求: 用户反馈「时间轴半透明仍然无效, 上下两个时间轴的底色是纯黑的」。
// 根因: v255 只降了时间轴 canvas 底 alpha (0.4), 但波形链路还有两层暗色叠加:
//   上时间轴 = WAVE_BG rgba(20,20,20,0.55) + drawDimOverlay rgba(8,8,12,0.5)
//   → 透过率 0.45*0.5 ≈ 22%, 叠在 #111116 画布底色上观感纯黑;
//   下时间轴 = canvas 底 0.4 + 容器 div 0.4 → 透过率 36%, 同样过暗。
// 修复 (半透明开关「开」时, 「关」保持原值):
//   · waveformDraw: WAVE_BG 0.55→0.25 (waveBg()), SPECTRO_BG_ALPHA 140→70 (spectroBgAlpha()),
//     SpectroScroll 缓存键补 bgA (开关切换即重建离屏);
//   · Timelines drawDimOverlay 0.5→0.2; 下时间轴容器 div 0.4→0.25。
// 运行: node verifier/v271/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const wd = fs.readFileSync(path.join(root, 'src/osu/waveformDraw.ts'), 'utf8');
assert(/v284: 时间轴半透明为唯一行为/.test(wd), 'v284 注释在 (开关移除, 半透明固定)');
assert(/const waveBg = \(\) => 'rgba\(20,20,20,0\.12\)'/.test(wd), '波形底固定 0.12 (v284: 开关移除)');
assert(/const spectroBgAlpha = \(\) => 40/.test(wd), '频谱底固定 40 (v284: 开关移除)');
assert(/g\.fillStyle = waveBg\(\)/.test(wd), 'drawWave 用 waveBg()');
assert(/const bgA = spectroBgAlpha\(\)/.test(wd), 'renderSpectroStrip 用 spectroBgAlpha()');
assert(/bgA: number \}.*v271: bgA 入缓存键/.test(wd), 'SpectroScroll 缓存键含 bgA');
assert(/sc\.bgA !== bgA/.test(wd), '透明度开关变化触发频谱全量重绘');

const tl = fs.readFileSync(path.join(root, 'src/components/Timelines.tsx'), 'utf8');
assert(/g\.fillStyle = 'rgba\(8,8,12,0\.1\)'/.test(tl), '暗化层固定 0.1 (v284: 开关移除)');
assert(/background: 'rgba\(21,21,32,0\.1\)'/.test(tl), '下时间轴容器底固定 0.1 (v284: 开关移除)');

if (failures) { console.error(`\nV271_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV271_ALL_PASSED');
