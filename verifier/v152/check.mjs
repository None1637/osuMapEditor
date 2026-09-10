// 验证器 v152: timing/song setup 页签上下时间轴不随播放滚动 — 播放位置推进原只在 EditorCanvas rAF
// 循环 (仅 edit 页签挂载); 修复 = 全页签常驻的 TopTimeline rAF 循环里兜底推进 (tickClock + positionMs + 播完自停)
// 运行: node verifier/v152/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('Timelines.tsx: TopTimeline rAF 循环内播放泵兜底');
{
  const src = readSrc('src/components/Timelines.tsx');
  const drawIdx = src.indexOf('const draw = () => {');
  assert(drawIdx > 0, 'TopTimeline draw 循环存在');
  const head = src.slice(drawIdx, drawIdx + 1600); // 泵在 draw 开头
  assert(/store\.tickClock\(\);/.test(head), '每帧 tickClock (暂停中相位跟踪, 与 EditorCanvas 一致)');
  assert(/if \(store\.playing\) \{/.test(head), '播放中条件块');
  assert(/store\.currentTime = store\.positionMs\(\);/.test(head), '播放中推进 currentTime = positionMs (含 hitsound 排程)');
  assert(/if \(store\.currentTime >= store\.songLength\(\)\) store\.pause\(\);/.test(head), '播完自停 (与 EditorCanvas 一致)');
  // 时间针/视窗仍读 store.currentTime (泵更新后即新值)
  assert(/const t = store\.currentTime;/.test(src), '绘制读 store.currentTime');
  assert(/const t0 = t - win \/ 2;/.test(src), '视窗随 currentTime 滚动');
}

section('App.tsx: TopTimeline/BottomTimeline 全页签常驻 (兜底泵有效的前提)');
{
  const src = readSrc('src/App.tsx');
  const topIdx = src.indexOf('<TopTimeline />');
  const tabIdx = src.indexOf("tab === 'edit' ? (");
  assert(topIdx > 0 && tabIdx > topIdx, 'TopTimeline 渲染在页签三元之前 (全页签挂载)');
  const botIdx = src.indexOf('<BottomTimeline />');
  assert(botIdx > src.indexOf('<TimingPage />'), 'BottomTimeline 在页签三元 (edit/setup/timing) 之后渲染 (全页签挂载)');
}

section('EditorCanvas.tsx: 原有播放泵保留 (edit 页签双泵幂等)');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/store\.currentTime = store\.positionMs\(\); \/\/ WebAudio采样级时钟/.test(src), 'EditorCanvas 播放推进保留');
  assert(/if \(store\.playing\) store\.emitPlaybackFrame\(\);/.test(src), 'EditorCanvas 播放中 UI 刷新保留 (v245: 改走 emitPlaybackFrame 逐帧独立通道)');
}

if (failures) { console.error(`\nV152_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV152_ALL_PASSED');
