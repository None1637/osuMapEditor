// v103 源码接线断言: 波形/频谱悬浮窗
// 运行: node verifier/v103/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

// ---- 纯函数单测 (esbuild bundle 后 node 跑) ----
try {
  execSync('npx esbuild verifier/v103/tests.ts --bundle --platform=node --outfile=node_modules/.cache/v103-tests.cjs', { cwd: root, stdio: 'pipe' });
  const out = execSync('node node_modules/.cache/v103-tests.cjs', { cwd: root, encoding: 'utf8' });
  assert(out.includes('V103_TESTS_PASSED'), '纯函数单测 V103_TESTS_PASSED');
} catch (e) {
  failures++;
  console.error('  FAIL: 纯函数单测执行失败\n', String(e.stdout ?? '') + String(e.stderr ?? ''));
}

// ---- fft.ts ----
const fft = read('src/osu/fft.ts');
assert(/export function fft\(re: Float32Array, im: Float32Array\)/.test(fft), 'fft.ts 导出原位 radix-2 fft');
assert(/n & \(n - 1\)/.test(fft), 'fft 长度 2 的幂校验');
assert(/export function hannWindow/.test(fft), 'fft.ts 导出 hannWindow');
assert(/export function frameMagnitudes/.test(fft), 'fft.ts 导出 frameMagnitudes');

// ---- waveformData.ts ----
const wd = read('src/osu/waveformData.ts');
assert(/export interface AudioBufferLike/.test(wd), 'waveformData 定义 AudioBufferLike (node 可测)');
assert(/export function computePeaks/.test(wd) && /msPerBucket = 1/.test(wd), 'computePeaks 默认 1ms 分桶');
assert(/for \(let ch = 0; ch < buf.numberOfChannels; ch\+\+\)/.test(wd), 'peaks 覆盖所有声道');
assert(/export const SPECTRO_BINS = 256/.test(wd), '频谱 256 对数 bin');
assert(/export const SPECTRO_FMIN = 30/.test(wd) && /export const SPECTRO_FMAX = 16000/.test(wd), '频谱 30Hz–16kHz');
assert(/export const SPECTRO_FRAME = 1024/.test(wd), 'STFT 帧长 1024 (v194: 2048→1024 对齐 Bpm-Measurer, 瞬态更锐利; v106 适配: 固定 hop 已随逐列化移除)');
assert(/export function logBinForFreq/.test(wd) && /export function freqForLogBin/.test(wd), '对数频率 bin 双向映射');
assert(/export function normalizeDb/.test(wd) && /SPECTRO_DB_RANGE = 80/.test(wd), 'dB 归一化 80dB 动态范围');
assert(/export function spectroColumnAt\(/.test(wd), 'v106 适配: 逐列 spectroColumnAt (替代 computeSpectrogram)');
assert(/export function getSpectroColumn/.test(wd), 'v106 适配: 列缓存 getSpectroColumn (替代 getSpectrogram/ensureSpectrogram)');
assert(/new WeakMap<AudioBufferLike, SpectroCols>/.test(wd) && /new WeakMap<AudioBufferLike, WavePeaks>/.test(wd), 'WeakMap 缓存随 buffer 回收');
assert(/export function spectroColor/.test(wd), '频谱色带 (v194: Bpm-Measurer 分段式)');
assert(/if \(x < 0\.25\)/.test(wd) && /else if \(x < 0\.5\)/.test(wd) && /else if \(x < 0\.75\)/.test(wd), 'v194: 色带黑→紫(0.25)→红(0.5)→黄(0.75)→白(1) 分段');
assert(/export function pixelShift/.test(wd), '滚动移位纯函数');

// ---- waveformDraw.ts (v127 适配: WaveformPanel 悬浮窗已废弃, 绘制层抽出; 波形画在 TopTimeline 背景/上层) ----
assert(!fs.existsSync(path.join(root, 'src/components/WaveformPanel.tsx')), 'v127: WaveformPanel.tsx 已删除');
const wp = read('src/osu/waveformDraw.ts');
assert(/export function drawWave/.test(wp), 'drawWave 导出');
assert(/export function drawSpectro/.test(wp), 'drawSpectro 导出 (滚动缓存)');
assert(/WAVE_CORE = '#7fe07f'/.test(wp) && /WAVE_EDGE = '#1e6e2e'/.test(wp), 'Audition 绿波形配色');
assert(/createLinearGradient/.test(wp), '波形垂直渐变');
assert(/drawImage\(sc\.cv, dx, 0, W - dx, H, 0, 0, W - dx, H\)/.test(wp), '频谱滚动缓存 drawImage 平移');
assert(/renderSpectroStrip\(sc\.cv, buf, newImgT0, win, W - dx, W\)/.test(wp), 'v106 适配: 滚动只补新露出列 (逐列 LRU 复用, 原 framesDone 补绘已移除); v111: 按位图时间基准 newImgT0 采样');
assert(/低频在下/.test(wp), '频谱低频在下高频在上');

// ---- TopTimeline 波形层接线 (v127) ----
const tl = read('src/components/Timelines.tsx');
assert(/drawWave, drawSpectro/.test(tl) && /@\/osu\/waveformDraw/.test(tl), 'TopTimeline 引入波形绘制层');
assert(/store\.wavePanelOpen && !store\.waveOnTop/.test(tl), '背景模式: 波形画在时间轴内容下层');
assert(/store\.wavePanelOpen && store\.waveOnTop/.test(tl), '上层模式: 波形画在时间轴内容上层');
assert(/6000 \/ \(bm\.editor\.timelineZoom \|\| 1\)/.test(tl), '视口公式一致 (逐像素对齐)');
assert(/store\.currentTime/.test(tl), '中心 = store.currentTime');

// ---- store 接线 ----
const store = read('src/osu/store.ts');
assert(/getAudioBuffer\(\): AudioBuffer \| null \{ return this\.audioBuffer; \}/.test(store), 'store 公开 getAudioBuffer');
assert(/osu-editor:wavepanel-open/.test(store), '显示开关 localStorage 持久化');
assert(/wavePanelOpen = loadWavePanelOpen\(\)/.test(store), 'wavePanelOpen 默认从 localStorage 读');
assert(/setWavePanelOpen\(b: boolean\)/.test(store), 'setWavePanelOpen setter');

// ---- App 接线 ----
const app = read('src/App.tsx');
assert(!/import \{ WaveformPanel \}/.test(app) && !/<WaveformPanel/.test(app), 'v127: App 不再引入/渲染 WaveformPanel');
assert(/data-wave-input="toggle"/.test(app), '工具栏「波形」切换按钮 (显示/隐藏时间轴波形)');

console.log(failures ? `\nV103_CHECK_FAILED: ${failures}` : '\nV103_CHECK_PASSED');
process.exit(failures ? 1 : 0);
