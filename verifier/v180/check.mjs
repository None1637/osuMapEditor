// 验证器 v180: 转盘放置逻辑对齐 osu!lazer SpinnerPlacementBlueprint
// lazer 行为: 左键提交起点 (BeginPlacement commitStart, 吸附细分网格) -> 放置中终点实时跟随编辑器当前时间
//   (updateEndTimeFromCurrent: EndTime = max(StartTime + 一拍, SnapTime(当前时间))) -> 右键完成 (EndPlacement);
//   放置中左键无效; 预览 SpinnerPiece alpha 0.5
// 旧实现: 左键直接放置, 终点固定 = 起点 + 4 拍
// 运行: node verifier/v180/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v180/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v180/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

await import('file://' + out); // 纯函数断言 (内部自报 V180_TESTS_*)
fs.unlinkSync(out);

const sp = readSrc('src/osu/sliderPath.ts');
const store = readSrc('src/osu/store.ts');
const rn = readSrc('src/osu/renderer.ts');
const ec = readSrc('src/components/EditorCanvas.tsx');
const app = readSrc('src/App.tsx');

// 1. 纯函数: spinnerPlacementEnd (lazer updateEndTimeFromCurrent)
assert(/export function spinnerPlacementEnd\(points: TimingPoint\[\], startTime: number, currentTime: number, beatSnap: number\)/.test(sp), 'spinnerPlacementEnd 导出');
assert(/Math\.max\(startTime \+ red\.beatLength, snapPlacementTime\(points, currentTime, beatSnap\)\)/.test(sp), '终点 = max(起点+一拍, 当前时间吸附) (lazer 语义)');

// 2. store: pendingSpinner 放置中状态
assert(/pendingSpinner: number \| null = null/.test(store), 'store.pendingSpinner 字段 (lazer isPlacingEnd)');

// 3. renderer: 放置预览 (alpha 0.5, 复用 drawSpinner)
assert(/export function drawPendingSpinner\(rc: RenderCtx, startTime: number, endTime: number, preempt: number\)/.test(rn), 'drawPendingSpinner 导出');
assert(/globalAlpha \*= 0\.5/.test(rn), '预览半透明 (lazer SpinnerPiece Alpha=0.5)');

// 4. EditorCanvas: 左键只提交起点, 右键完成, 渲染预览
assert(/if \(store\.pendingSpinner === null\) \{\s*store\.pendingSpinner = Math\.round\(snapTime\(store\.currentTime\)\);/.test(ec), '左键提交起点 (吸附), 不直接落物件');
assert(!/endTime: Math\.round\(snapTime\(store\.currentTime\)\) \+ red\.beatLength \* 4/.test(ec), '旧的固定 4 拍终点已移除');
assert(/store\.tool === 'spinner' && store\.pendingSpinner !== null/.test(ec), '右键完成转盘放置分支');
assert(/spinnerPlacementEnd\(bm\.timingPoints, start, store\.currentTime, store\.beatSnap\)/.test(ec), '右键提交时终点与预览同源 (spinnerPlacementEnd)');
assert(/drawPendingSpinner\(/.test(ec), '渲染循环绘制放置预览');

// 5. App: 工具切换 / Esc 取消放置
const toolSwitches = app.match(/store\.tool = t\.id; store\.pendingSlider = \[\]; store\.pendingSpinner = null;/g) ?? [];
assert(toolSwitches.length === 2, `两处工具切换 (快捷键+按钮) 均清 pendingSpinner (实际 ${toolSwitches.length})`);
assert(/store\.pendingSpinner = null; store\.clearSelection\(\)/.test(app), 'Esc 取消转盘放置');

console.log(failures ? `\nV180 FAILED: ${failures}` : '\nV180 ALL PASSED');
process.exit(failures ? 1 : 0);
