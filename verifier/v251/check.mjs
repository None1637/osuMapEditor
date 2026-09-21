// 验证器 v251: 播放中滚滚轮后 hitsound 16kHz+ 消失 (音质劣化) 修复。
// 根因 (实测定位, 探针见本目录):
//   Chromium 对 start(when) 的 when 非采样整数的 AudioBufferSourceNode 走线性插值渲染,
//   实测 when 偏移 0.5 采样: 16kHz -6dB / 22kHz -17dB (frac-when-probe.mjs 最小复现)。
//   wheelSeek → seekWhilePlaying 的落点来自浮点 positionMs() (相位跟踪时钟, 亚 ms 精度),
//   重锚后所有 hitsound 排程时刻 = startW + (整数 mapMs - 浮点 t)/1000 全部落上小数采样相位
//   → 之后所有 hitsound 被低通, 严重程度随小数相位接近 0.5 采样而加深 (故时好时坏);
//   点时间轴/暂停再播的位置是整数 ms (48k 下 = 采样整数), 故不复现。
// 修复 (store.ts):
//   1) seekWhilePlaying/play 的锚点 (音乐源 offset 与 startW) 吸附到采样网格 (≤0.5 采样 ~10µs, 不可闻);
//   2) hitsound sink / 节拍器 / 滑条循环音的 when 逐个吸附到采样整数
//      (44.1kHz 设备上整数 ms 也非采样整数, 必须逐 voice 吸附);
//   3) stopAllHitVoices 改走 allHitVoices 主集 — 只 drain 限流器会漏掉被并发上限逐出的 voice
//      (其淡出/停止排程在旧时间线上, seek 后退时幽灵重播叠加)。
// 验证: 本文件为源码断言; 行为验证 = node verifier/v251/bisect-probe.mjs
//   (干净重播/单次 seekWhilePlaying/滚轮风暴 三遍同窗口 16-20kHz 能量应一致;
//    修复前 B/C 常态化 -3~-8dB 且抖动, 修复后 4 连跑全等); 全频段复核 = wheel-spectrum-probe.mjs。
// 运行: node verifier/v251/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }

const store = fs.readFileSync(path.join(root, 'src/osu/store.ts'), 'utf8');

// 1) 引擎锚点采样网格吸附
assert(/t = Math\.round\(t \/ 1000 \* sr\) \/ sr \* 1000;/.test(store),
  'seekWhilePlaying: 落点 t 吸附到采样网格 (浮点 positionMs → 采样整数)');
assert(/const startW = Math\.round\(\(now \+ 0\.003\) \* sr\) \/ sr;/.test(store),
  'seekWhilePlaying: startW 吸附到采样整数');
assert(/const offset = Math\.round\(offset0 \* sr\) \/ sr;/.test(store),
  'play: offset 吸附到采样网格');
assert(/const startW = Math\.round\(\(this\.actx!\.currentTime \+ 0\.02\) \* sr\) \/ sr;/.test(store),
  'play: startW 吸附到采样整数');
assert(/clock\.onStartedAtCtxTime\(startW, offset \* 1000\)/.test(store),
  'play: 时钟锚定到吸附后的 offset (音乐源与 hitsound 同一时间线)');

// 2) hitsound/节拍器/循环音 when 逐个吸附 (44.1k 设备上整数 ms 也不是采样整数)
assert(/schedule: \(at, soundId, fallbacks, volume\) => \{\s*if \(!this\.actx\) return;\s*\/\/ v251[\s\S]{0,400}?at = Math\.round\(at \* sr\) \/ sr;/.test(store),
  'hitsound sink: when 吸附到采样整数');
assert(/const at = Math\.round\(at0 \* srM\) \/ srM; \/\/ v251/.test(store),
  '节拍器: when 吸附到采样整数');
assert(/const at = Math\.round\(at0 \* srL\) \/ srL;/.test(store) && /const endAt = endAt0 === null \? null : Math\.round\(endAt0 \* srL\) \/ srL;/.test(store),
  '滑条循环音: start/stop 时刻吸附到采样整数');

// 3) stopAllHitVoices 主集 (幽灵 voice 修复)
assert(/private allHitVoices = new Set<\{ src: AudioBufferSourceNode; gain: GainNode \}>\(\)/.test(store),
  'allHitVoices 主集定义');
assert(/this\.allHitVoices\.add\(rec\); \/\/ v251/.test(store) && /this\.allHitVoices\.delete\(rec\); \/\/ v251/.test(store),
  'trackVoice: 登记/注销主集');
assert(/private stopAllHitVoices\(\) \{\s*this\.voiceLimiter\.drain\(\);[^\n]*\n\s*for \(const v of this\.allHitVoices\)/.test(store),
  'stopAllHitVoices: 停止主集全部 voice (含被限流器逐出的), drain 仅清队列');

if (failures) { console.error(`\nV251_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV251_ALL_PASSED');
