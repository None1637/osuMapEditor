// 验证器 v390: 底栏布局改 lazer 式
//   1) 左侧: 大号时间显示 (stableTimestamp mm:ss:fff, text-xl 粗体), 下方紫色进度% + 黄色当前时间 BPM
//      (当前生效红线 60000/beatLength 取整, 无谱面不显示);
//   2) 右侧: 圆形描边播放钮在倍速控件左侧; 「回到开头」按钮删除 (Square 图标一并移除);
//   3) 测试游玩按钮从页签栏挪到底栏右下角 (lazer 黄色全高按钮; App 传 onTestPlay, F5 快捷键不变);
//   4) v287/v256 验证器适配。
// 运行: node verifier/v390/check.mjs
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

section('Timelines.tsx: 左侧时间 + BPM 块');
{
  const src = read('src/components/Timelines.tsx');
  assert(/data-bottom-time/.test(src), '左侧时间块保留 (v155/v252 回归)');
  assert(/text-xl font-bold leading-6/.test(src), '大号粗体时间显示 (v390-3: 改回 text-xl 粗体)');
  assert(/justify-between w-full/.test(src) && /w-fit min-w-24/.test(src), 'BPM 右缘对齐上方时间右缘 (容器 w-fit 随时间收缩 + justify-between, v390-4)');
  assert(/onClick=\{\(\) => setJump\(stableTimestamp\(store\.currentTime\)\)\}>\{stableTimestamp\(store\.currentTime\)\}/.test(src), '时间显示用 stableTimestamp (mm:ss:fff)');
  assert(/Math\.round\(60000 \/ timingAt\(bmNow\.timingPoints, store\.currentTime\)\.red\.beatLength\)/.test(src), 'BPM = 当前红线 60000/beatLength');
  assert(/data-bottom-bpm/.test(src) && /text-yellow-400/.test(src), '黄色 BPM 显示 (data-bottom-bpm)');
  assert(/text-purple-400/.test(src), '紫色进度百分比');
}

section('Timelines.tsx: 右侧控件 (圆播放钮 / 删回到开头 / 测试游玩)');
{
  const src = read('src/components/Timelines.tsx');
  assert(/rounded-full border-2 border-white\/70/.test(src), '圆形描边播放钮 (v390-2: w-9 h-9 对齐截图直径)');
  assert(!/back_to_start|store\.pause\(\); store\.seek\(0\)/.test(src), '回到开头按钮已删除');
  assert(/import \{ Pause, Play, X \} from 'lucide-react'/.test(src), 'Square 图标导入已移除 (仅注释提及)');
  assert(/export function BottomTimeline\(\{ onTestPlay \}: \{ onTestPlay: \(\) => void \}\)/.test(src), 'BottomTimeline 收 onTestPlay');
  assert(/data-testplay-btn/.test(src) && /bg-yellow-400 hover:bg-yellow-300 text-black/.test(src) && /self-stretch px-6/.test(src), '右下角黄色全高测试游玩按钮');
  // 顺序: 播放钮 -> 倍速 -> 测试游玩
  const order = [src.indexOf('store.togglePlay()'), src.indexOf('data-speed-input'), src.indexOf('data-testplay-btn')];
  assert(order[0] > 0 && order[0] < order[1] && order[1] < order[2], '控件顺序: 播放 → 倍速 → 测试游玩');
  // v390-2: 倍速页签无边框纯文本 (lazer PlaybackControl 样式), 激活白色加粗/其余半透
  assert(/flex items-baseline gap-3/.test(src) && /text-\[12px\]/.test(src), '倍速页签无边框纯文本排版 (v390-2)');
  // v390-3: 标签「播放速度」左缘与 25% 页签左缘对齐
  assert(/flex-col items-start justify-center/.test(src), '倍速标签左对齐页签行 (v390-3)');
  assert(/'timeline\.speed_label': '播放速度'/.test(read('src/i18n/dicts/zh-CN/timeline.ts')), 'speed_label = 播放速度 (v390-3)');
}

section('App.tsx: 页签栏按钮移除 + onTestPlay 传递');
{
  const app = read('src/App.tsx');
  assert(!/data-testplay-btn/.test(app), '页签栏测试游玩按钮已移除');
  assert(/<BottomTimeline onTestPlay=\{\(\) => setTestPlay\(true\)\}/.test(app), 'BottomTimeline 传 onTestPlay');
  assert(/import \{ Volume2, Eye, Keyboard, FolderOpen/.test(app), 'App lucide 导入不含 Play (v390 移除)');
}

section('旧验证器适配标注');
{
  assert(/v390 适配/.test(read('verifier/v287/check.mjs')), 'v287 已适配标注');
  assert(/v390 适配/.test(read('verifier/v256/check.mjs')), 'v256 已适配标注');
  assert(/v390 适配/.test(read('verifier/v252/check.mjs')), 'v252 已适配标注');
}

if (failures) { console.error(`V390 FAILED: ${failures}`); process.exit(1); }
console.log('V390 ALL PASSED');
