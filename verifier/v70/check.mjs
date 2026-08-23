// 验证器 v70: 全页签上下时间轴 + Timing 页签紧凑独立窗口 (时分秒/连续居中/悬停高亮/生效绿线实时高亮)
// 运行: cd app && node verifier/v70/check.mjs; node verifier/v70/cdp-v70.mjs (需 7100 dev server)
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v70/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v70/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out);
fs.unlinkSync(out);

section('App.tsx: 上时间轴全部页签显示');
{
  const src = readSrc('src/App.tsx');
  assert(src.indexOf('<TopTimeline />') < src.indexOf("tab === 'edit' ? ("), 'TopTimeline 在页签条件之外 (所有页签显示)');
  assert(src.indexOf('<BottomTimeline />') > -1, 'BottomTimeline 保持全局');
}

section('timingEdit.ts: 格式化 + 生效绿线');
{
  const src = readSrc('src/osu/timingEdit.ts');
  assert(/export function formatMsTime/.test(src) && /padStart\(3, '0'\)/.test(src), 'formatMsTime h:mm:ss.mmm');
  assert(/export function activeGreenAt/.test(src) && /if \(p\.uninherited\) green = null/.test(src), 'activeGreenAt (红线复位)');
}

section('TimingPanel.tsx: 紧凑窗口 + 四项');
{
  const src = readSrc('src/components/TimingPanel.tsx');
  assert(/w-fit max-w-\[96%\] mx-auto my-4/.test(src), '独立窗口 (w-fit 居中)');
  assert(/formatMsTime\(tp\.time\)/.test(src) && /data-tp-fmt/.test(src), '时间输入框后时分秒显示');
  assert(/text-center whitespace-nowrap/.test(src) && /mx-auto/.test(src), '属性连续排版居中');
  assert(/data-hover-tp={isHover/.test(src) && /tp === store\.timelineHoverTp/.test(src), '悬停时间轴红/绿线行高亮');
  assert(/data-active-green={isActive/.test(src) && /activeGreenAt\(bm\.timingPoints, store\.currentTime\)/.test(src), '生效绿线行实时高亮');
}

section('Timelines.tsx / store.ts: 悬停追踪');
{
  const tl = readSrc('src/components/Timelines.tsx');
  assert(/store\.timelineHoverTp = best; store\.emitSelection\(\)/.test(tl), 'mousemove 更新悬停线 (变化才 emit)');
  assert(/onMouseLeave/.test(tl) && /store\.timelineHoverTp = null/.test(tl), '移出清除');
  const st = readSrc('src/osu/store.ts');
  assert(/timelineHoverTp: TimingPoint \| null = null/.test(st), 'store 字段');
}

if (failures) { console.error(`\nVERIFIER_V70_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V70_ALL_PASSED');
