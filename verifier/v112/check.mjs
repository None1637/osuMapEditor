// v112 源码接线断言: 波形/频谱显示偏移 +20ms 恢复 (对齐 lazer Editor.WAVEFORM_VISUAL_OFFSET, PR#26136)
// 运行: node verifier/v112/check.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

// v127 适配: WaveformPanel 废弃, 绘制层移到 waveformDraw.ts (import 路径随之改 './waveformData')
const wp = read('src/osu/waveformDraw.ts');
const wd = read('src/osu/waveformData.ts');

// 常量在纯数据层 (可单测), 带 lazer 依据注释
assert(/export const WAVEFORM_VISUAL_OFFSET_MS = 20/.test(wd), 'waveformData 导出 WAVEFORM_VISUAL_OFFSET_MS = 20');
assert(/ppy\/osu PR#26136/.test(wd) && /历史系统延迟/.test(wd), '常量注释引用 lazer PR#26136 + 历史系统延迟依据');

// 面板导入并应用于两条采样路径
assert(/WAVEFORM_VISUAL_OFFSET_MS \} from '.\/waveformData'/.test(wp), '面板从 waveformData 导入常量 (非本地定义)');
assert(!/export const WAVEFORM_VISUAL_OFFSET_MS/.test(wp), '面板不再本地定义常量');
assert(/const msA = t0 \+ \(cx \/ W\) \* win \+ WAVEFORM_VISUAL_OFFSET_MS/.test(wp)
  && /const msB = t0 \+ \(\(cx \+ 1\) \/ W\) \* win \+ WAVEFORM_VISUAL_OFFSET_MS/.test(wp), 'drawWave 采样 t+20 (内容左移 20ms)');
assert(/const ms = t0 \+ \(\(x0 \+ cx \+ 0\.5\) \/ W\) \* win \+ WAVEFORM_VISUAL_OFFSET_MS/.test(wp), 'renderSpectroStrip 列采样 t+20 (像素中心 + 显示偏移)');

// 偏移只影响显示采样, 不污染滚动簿记/播放 (imgT0 簿记域不含偏移常量)
const scrollBody = wp.slice(wp.indexOf('function drawSpectro'), wp.indexOf('function renderSpectroStrip'));
assert(!/WAVEFORM_VISUAL_OFFSET_MS/.test(scrollBody), 'drawSpectro 滚动簿记不含显示偏移 (偏移在 renderSpectroStrip 采样侧)');

console.log(failures ? `\nV112_CHECK_FAILED: ${failures}` : '\nV112_CHECK_PASSED');
process.exit(failures ? 1 : 0);
