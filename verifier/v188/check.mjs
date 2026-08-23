// 验证器 v188: ① 滑条"头尾异色"定位 (谱面 Aspire 1ms 叠放, 非染色 bug; 时间轴可见性后由 v189 绘制序解决)
//             ② 放置转盘时上方时间轴显示虚线幻影预览
// (v189 修订: ±2ms 堆叠已撤销, 改回精确同刻)
// 运行: node verifier/v188/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v188/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v188/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V188_TESTS_*)
fs.unlinkSync(out);

section('timelineHit.ts: 同刻 = 精确相等 (v189 撤销 v188 的 ±2ms)');
{
  const src = readSrc('src/osu/timelineHit.ts');
  assert(!/STACK_EPS/.test(src), '无 ±2ms 阈值 (v189 撤销)');
  assert(/counts\.get\(o\.time\)/.test(src), '按 time 精确分组计数');
}

section('Timelines.tsx: 转盘放置幻影预览');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(/import \{ pendingSliderTimeline, spinnerPlacementEnd \} from '@\/osu\/sliderPath'/.test(src), '导入 spinnerPlacementEnd');
  assert(/store\.tool === 'spinner' && store\.pendingSpinner !== null/.test(src), '转盘放置中才画幻影');
  assert(/spinnerPlacementEnd\(bm\.timingPoints, sStart, t, store\.beatSnap\)/.test(src), '终点 = 放置落盘规则 (与 finishSpinner 一致)');
  const spinBlock = src.match(/store\.tool === 'spinner'[\s\S]{0,600}?drawTimelineObject\(g, ssx, sex, cy, RAD, \{[\s\S]{0,300}?dashed: true, dur: true/);
  assert(!!spinBlock, '幻影 = 虚线连体条 (drawTimelineObject 共用)');
}

if (failures) { console.error(`V188 FAILED: ${failures}`); process.exit(1); }
console.log('V188 ALL PASSED');
