// 验证器 v138: 波形上层模式修复 — 离屏合成, 下层时间轴内容透出 (半透明底, 旧独立窗口观感)
// 根因: drawWave/drawSpectro 内部 setTransform(identity) + clearRect(W,H) — 上层模式直接画主画布时
//   clearRect 把已画好的时间轴内容 (物件/红绿线/暗化层) 整片抹成透明, 下层内容完全看不到。
// 修复: drawWaveLayer 加 onTop 参数 — 上层模式先画到离屏画布 (clearRect 只清离屏) 再 drawImage 贴回,
//   波形半透明底 (WAVE_BG 0.55 / 频谱 SPECTRO_BG_ALPHA 140) 透出下层暗化后的内容; 背景模式下方无内容, 直接画。
// 运行: node verifier/v138/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const tl = read('src/components/Timelines.tsx');

// 1. onTop 参数与离屏画布
assert(/drawWaveLayer = \(g: CanvasRenderingContext2D, r: DOMRect, dpr: number, t0: number, win: number, onTop = false\)/.test(tl), 'drawWaveLayer 加 onTop 参数 (默认 false = 背景模式不变)');
assert(/waveTopScratchRef = useRef<HTMLCanvasElement \| null>\(null\)/.test(tl), '上层模式离屏画布 ref');

// 2. 上层分支: 波形/频谱画到离屏 (sg), drawImage 贴回主画布
const fnIdx = tl.indexOf('onTop = false) => {');
const fn = tl.slice(fnIdx, fnIdx + 1500);
assert(/if \(!onTop\) \{/.test(fn), '背景模式: 直接画 (clearRect 无害)');
assert(/drawWave\(sg, buf/.test(fn) && /drawSpectro\(sg, buf/.test(fn), '上层模式: 波形/频谱画到离屏 sg (clearRect 只清离屏)');
assert(/g\.drawImage\(scratch, 0, 0\)/.test(fn), '离屏整体贴回主画布 (下层内容透出)');
assert(!/g\.drawImage\(waveTopScratch/.test(fn), '无遗留的模块级 scratch 变量引用');

// 3. 调用点: 上层模式传 onTop=true, 背景模式不传
assert(/store\.waveOnTop\) \{ drawDimOverlay\(g, r\); drawWaveLayer\(g, r, dpr, t0, win, true\); \}/.test(tl), '上层模式调用传 onTop=true (暗化层在波形下)');
assert(/!store\.waveOnTop\) \{ drawWaveLayer\(g, r, dpr, t0, win\); drawDimOverlay\(g, r\); \}/.test(tl), '背景模式调用不传 onTop (直接画 + 暗化波形)');

// 4. 半透明底设计仍在 (透出下层内容的关键)
const wd = read('src/osu/waveformDraw.ts');
assert(/WAVE_BG = 'rgba\(20,20,20,0\.55\)'/.test(wd), '波形底 rgba(20,20,20,0.55) 半透明 (v105)');
assert(/SPECTRO_BG_ALPHA = 140/.test(wd), '频谱底 alpha 140 半透明 (v105)');

console.log(failures ? `\nV138_CHECK_FAILED: ${failures}` : '\nV138_CHECK_PASSED');
process.exit(failures ? 1 : 0);
