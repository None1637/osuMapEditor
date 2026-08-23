// v106 源码接线断言: 频谱逐列自适应 (窗口居中) + 波形/频谱视觉偏移归 0
// 运行: node verifier/v106/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const wd = read('src/osu/waveformData.ts');
// v127 适配: WaveformPanel 废弃, 绘制层移到 waveformDraw.ts (import 路径随之改 './waveformData')
const wp = read('src/osu/waveformDraw.ts');

// 数据层: 逐列 FFT, 窗口以列中心为中心 (前缘取窗 = 能量右偏半窗 ~23ms 的根因)
assert(/export function spectroColumnAt\(mono: Float32Array, sampleRate: number, centerMs: number/.test(wd), 'spectroColumnAt 逐列接口');
assert(/const start = center - SPECTRO_FRAME \/ 2/.test(wd), 'FFT 窗口以列中心为中心 (start = center − 帧长/2)');
assert(/v106 窗口居中/.test(wd), '窗口居中注释 (根因记录)');
assert(/if \(s >= 0 && s < mono\.length\)/.test(wd), '边缘零填充 (越界采样不取)');

// 列缓存: WeakMap 随 buffer 回收 + LRU 有界
assert(/export function getSpectroColumn\(buf: AudioBufferLike, centerMs: number\)/.test(wd), 'getSpectroColumn 缓存接口');
assert(/export const SPECTRO_LRU_CAP = 10000/.test(wd), 'LRU 上限 10000 列 (~10MB)');
assert(/sc\.lru\.length > SPECTRO_LRU_CAP/.test(wd) && /sc\.cols\.delete\(sc\.lru\.shift\(\)!\)/.test(wd), '超上限逐出最老列');
assert(/new WeakMap<AudioBufferLike, SpectroCols>/.test(wd), 'WeakMap 列缓存随 buffer 回收');

// 整曲固定 hop 路径已移除 (21.3ms 帧 → 放大出方格; 且前缘取窗是右偏根因)
assert(!/computeSpectrogram|getSpectrogram|ensureSpectrogram|SpectroData|SPECTRO_HOP/.test(wd), '整曲帧阵列路径已删除 (computeSpectrogram/getSpectrogram/ensureSpectrogram/SpectroData/SPECTRO_HOP)');
assert(!/framesDone/.test(wd), '渐进帧计数已删除');

// 面板: v112 恢复 +20ms 显示偏移 (lazer WAVEFORM_VISUAL_OFFSET; v106 归 0 后任意谱面波形右偏 ~20ms)
assert(/WAVEFORM_VISUAL_OFFSET_MS = 20/.test(wd), 'v112: WAVEFORM_VISUAL_OFFSET_MS = 20 (waveformData, lazer Editor.WAVEFORM_VISUAL_OFFSET)');
assert(/ppy\/osu PR#26136|PR#26136/.test(wd), 'v112 注释引用 lazer PR#26136 (历史系统延迟 ~20ms 依据)');
assert(/const ms = t0 \+ \(\(x0 \+ cx \+ 0\.5\) \/ W\) \* win \+ WAVEFORM_VISUAL_OFFSET_MS/.test(wp), '列采样点在像素中心 + v112 显示偏移');
assert(!/ensureSpectrogram|SpectroData|framesDone/.test(wp), '面板不再引用整曲频谱数据');

// 面板: 逐列渲染
assert(/import \{ getPeaks, getSpectroColumn, spectroColor, spectroScrollStep, WAVEFORM_VISUAL_OFFSET_MS \} from '.\/waveformData'/.test(wp), '面板改引 getSpectroColumn (v111: pixelShift → spectroScrollStep; v112: +WAVEFORM_VISUAL_OFFSET_MS)');
assert(/\+ WAVEFORM_VISUAL_OFFSET_MS;/.test(wp), '频谱列采样应用 v112 显示偏移');
assert(/const col = getSpectroColumn\(buf, ms\)/.test(wp), '逐列取频谱');
assert(/renderSpectroStrip\(sc\.cv, buf, newImgT0, win, W - dx, W\)/.test(wp), '滚动只补新露出列 (LRU 复用旧列; v111: newImgT0 时间基准)');
assert(/ms < 0 \|\| ms >= lenMs/.test(wp), '歌曲范围外列留半透明黑底');

console.log(failures ? `\nV106_CHECK_FAILED: ${failures}` : '\nV106_CHECK_PASSED');
process.exit(failures ? 1 : 0);
