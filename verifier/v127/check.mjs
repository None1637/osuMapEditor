// v127 源码接线断言: 删除标题行 + 波形/频谱默认画在上方时间轴背景 (废弃 WaveformPanel 悬浮窗)
// 运行: node verifier/v127/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const app = read('src/App.tsx');
const tl = read('src/components/Timelines.tsx');
const store = read('src/osu/store.ts');

// 1. 标题行删除 (无实际功能)
assert(!/osu! 谱面编辑器/.test(app), '标题行文字已删除');
assert(!/h-12 bg-\[#1a1a22\]/.test(app), 'h-12 标题行容器已删除');

// 2. WaveformPanel 废弃
assert(!fs.existsSync(path.join(root, 'src/components/WaveformPanel.tsx')), 'WaveformPanel.tsx 已删除');
assert(!/import \{ WaveformPanel \}/.test(app) && !/<WaveformPanel/.test(app), 'App 不再引入/渲染 WaveformPanel');
assert(fs.existsSync(path.join(root, 'src/osu/waveformDraw.ts')), '绘制层抽到 src/osu/waveformDraw.ts');
const wd = read('src/osu/waveformDraw.ts');
assert(/export function drawWave/.test(wd) && /export function drawSpectro/.test(wd), 'waveformDraw 导出 drawWave/drawSpectro');

// 3. store: 默认开 + 模式/层级状态持久化
assert(/v === null \? true : v === '1'/.test(store), '波形显示默认开 (无存储时 true)');
assert(/waveMode: 'wave' \| 'spectro' = loadWaveMode\(\)/.test(store), 'waveMode 状态 (默认 wave)');
assert(/waveOnTop = loadWaveOnTop\(\)/.test(store), 'waveOnTop 状态 (默认 false=背景)');
assert(/setWaveMode\(m: 'wave' \| 'spectro'\)/.test(store) && /setWaveOnTop\(b: boolean\)/.test(store), 'setWaveMode/setWaveOnTop');
assert(/osu-editor:wavepanel:mode/.test(store) && /osu-editor:wavepanel:ontop/.test(store), '模式/层级 localStorage 持久化');

// 4. TopTimeline: 波形画在时间轴内, 背景模式在内容下层 (物件/各种线在上层), 上层模式在帧尾
// (v137: 两分支均加 drawDimOverlay 暗化层 — 背景模式暗化波形, 上层模式暗化内容; 波形与内容的相对层级不变)
assert(/import \{ drawWave, drawSpectro, type SpectroScroll \} from '@\/osu\/waveformDraw'/.test(tl), 'TopTimeline 引入绘制层');
assert(/if \(store\.wavePanelOpen && !store\.waveOnTop\) \{ drawWaveLayer\(g, r, dpr, t0, win\); drawDimOverlay\(g, r\); \}/.test(tl), '背景模式: 时间轴内容之前绘制 (物件/线在上层; v137 波形随暗化层)');
assert(/if \(store\.wavePanelOpen && store\.waveOnTop\) \{ drawDimOverlay\(g, r\); drawWaveLayer\(g, r, dpr, t0, win(, true)?\); \}/.test(tl), '上层模式: 当前时间针之后绘制 (v137 先暗化内容再画波形; v138 离屏贴回)');
const bgIdx = tl.indexOf('!store.waveOnTop) { drawWaveLayer');
const objIdx = tl.indexOf('drawTimelineObject(g, sx, ex, lay.yOf'); // v162: 堆叠绘制参数改名
const topIdx = tl.indexOf('store.wavePanelOpen && store.waveOnTop) { drawDimOverlay');
assert(bgIdx > 0 && objIdx > bgIdx, '背景波形在物件绘制之前 (物件显示在波形上层)');
assert(topIdx > objIdx, '上层波形在物件绘制之后');

// 5. 时间轴右侧切换钮: 波形图/频谱图 + 背景/上层; 按钮组 z-10 不被上层波形遮挡
assert(/data-wave="mode"/.test(tl), '波形图/频谱图切换钮');
assert(/store\.setWaveMode\(store\.waveMode === 'wave' \? 'spectro' : 'wave'\)/.test(tl), '模式切换回写 store');
assert(/data-wave="layer"/.test(tl), '背景/上层切换钮');
assert(/store\.setWaveOnTop\(!store\.waveOnTop\)/.test(tl), '层级切换回写 store');
assert(/absolute right-1 top-1 flex gap-1 z-10/.test(tl), '右侧按钮组 z-10 (高于 canvas 内上层波形)');
assert(/\{store\.waveMode === 'wave' \? '波形图' : '频谱图'\}/.test(tl) && /\{store\.waveOnTop \? '上层' : '背景'\}/.test(tl), '按钮文案随状态');

console.log(failures ? '\nV127_CHECK_FAILED: ' + failures : '\nV127_CHECK_PASSED');
process.exit(failures ? 1 : 0);
