// v295: 变速变调/不变调双模式 — 与 lazer 语义对齐
// lazer 考证 (本地源码 D:/Projects/osuMapEditor/osu):
//   - DT/HT: ModRateAdjust.cs -> AdjustableProperty.Frequency (直接重采样, 变调变速, 零拉伸失真)
//   - 编辑器 PlaybackControl.cs:79 -> AdjustableProperty.Tempo (BASS 不变调拉伸)
// v296 修订: 编辑器倍速固定不变调 (rateAdjustPitch 默认 false, 底栏切换按钮已移除);
//   变调仅测试游玩 DT/HT 内部强制使用 (与 lazer ModRateAdjust 完全对齐), 退出恢复。
// v382 修订: 编辑器改回固定**变调** (rateAdjustPitch 默认 true) — 对齐 osu!stable
//   (BASS) HT/慢放语义: plain resample 变速变调; 且重采样改走自研窗 sinc 插值引擎
//   (src/osu/clock/rateWorklet.ts), 取代 Chromium playbackRate 线性插值 (慢放镜像失真,
//   实测见 verifier/v382)。signalsmith 不变调路径保留为备选 (无 UI 入口)。
// v385 修订: v382 的"stable 慢放=变调"系误判 — lazer 编辑器 PlaybackControl.cs:79 走
//   AdjustableProperty.Tempo (保时音高), adjustPitch=true 是 DT/HT mod 语义; 编辑器慢放
//   改回固定**不变调** (rateAdjustPitch 默认 false, signalsmith-stretch); v382 sinc 变调
//   引擎保留给测试游玩 DT/HT (仍优于 Chromium 线性插值 ~70dB)。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const store = readFileSync(join(root, 'src/osu/store.ts'), 'utf8');
const overlay = readFileSync(join(root, 'src/components/TestPlayOverlay.tsx'), 'utf8');
const timelines = readFileSync(join(root, 'src/components/Timelines.tsx'), 'utf8');

let fails = 0;
const check = (name, cond) => { if (!cond) { fails++; console.error('FAIL:', name); } };

// store: 字段默认 false (v385: 编辑器慢放 = lazer Tempo 不变调语义)
check('store: rateAdjustPitch 字段默认 false (v385)',
  /rateAdjustPitch:\s*boolean\s*=\s*false/.test(store));
check('store: setRateAdjustPitch 播放中重启 + emit',
  /setRateAdjustPitch\(v:\s*boolean\)[\s\S]{0,1200}this\.playing\s*&&\s*this\.playbackRate\s*!==\s*1[\s\S]{0,200}this\.emit\(\)/.test(store));
// store: play() 变速支路条件带 !rateAdjustPitch (不变调才走 signalsmith)
check('store: tempoNode 支路要求不变调',
  store.includes('this.playbackRate !== 1 && !this.rateAdjustPitch && this.tempoNode'));
check('store: worklet 未就绪回退支路要求不变调',
  store.includes('this.playbackRate !== 1 && !this.rateAdjustPitch && !this.tempoNode'));
check('store: 变调时 BufferSource 直接 playbackRate 重采样',
  /src\.playbackRate\.value\s*=\s*this\.playbackRate/.test(store));
check('store: 降级 <audio> preservesPitch 跟随开关',
  /this\.audio\.preservesPitch\s*=\s*!this\.rateAdjustPitch/.test(store));

// TestPlayOverlay: DT/HT 强制变调 + 退出恢复
check('overlay: 记录 prevPitch',
  overlay.includes('const prevPitch = store.rateAdjustPitch'));
check('overlay: DT/HT 强制变调 (Frequency 语义)',
  /store\.rateAdjustPitch\s*=\s*mods\.includes\('DT'\)\s*\|\|\s*mods\.includes\('HT'\)/.test(overlay));
check('overlay: cleanup 恢复 prevPitch 且在 setRate 之前',
  /store\.rateAdjustPitch\s*=\s*prevPitch[\s\S]{0,120}store\.setRate\(prevRate\)/.test(overlay));

// Timelines: v296 变调按钮已移除, 倍速按钮保留
check('timelines: 变调切换按钮已移除 (v296)',
  !timelines.includes('data-speed-pitch'));
check('timelines: 倍速按钮保留',
  timelines.includes('data-speed-input'));

if (fails) { console.error(`v295: ${fails} check(s) failed`); process.exit(1); }
console.log('v295: all checks passed');
