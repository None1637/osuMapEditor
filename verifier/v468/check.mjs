// 验证器 v468: 滑条锚点交互判定在显示尺寸基础上 +2 屏幕像素余量
//   需求: 滑条锚点在当前的基础上加 2 屏幕像素的额外交互检测区域 (只放宽命中, 绘制不变)。
//   实现: nodeSelection.ts anchorHitRadius 两个分支各 +2/k (k = 设备px/osu单位, 0 兜底按 1) —
//     stable (4+2)/k; lazer 头 7+2/k / 其余 6+2/k。全部锚点判定 (nearestNode/nearestCtrlPoint/
//     放置流程 6 处/双击闭环切红等) 都走这一个函数, 改一处即全覆盖。
// 运行: cd app && node verifier/v468/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v468/_bundle.mjs');

buildSync({
  entryPoints: [path.join(root, 'verifier/v468/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }

await import('file://' + out);
fs.unlinkSync(out);

section('nodeSelection.ts: anchorHitRadius +2 屏幕px');
{
  const ns = fs.readFileSync(path.join(root, 'src/osu/nodeSelection.ts'), 'utf8');
  assert(/v468: 全部锚点交互判定在显示尺寸基础上 \+2 屏幕像素余量/.test(ns), 'v468 注释在');
  assert(/const k = devicePxPerOsu \|\| 1;/.test(ns), 'k 提取 + 0 兜底');
  assert(/sliderPointStyle === 'stable'\) return \(4 \+ 2\) \/ k/.test(ns), 'stable = (4+2)/k');
  assert(/return \(isHead \? 7 : 6\) \+ 2 \/ k/.test(ns), 'lazer = (头7/其余6) + 2/k');
}

section('调用侧不变 (仍全部走 anchorHitRadius, 改一处全覆盖)');
{
  const ec = fs.readFileSync(path.join(root, 'src/components/EditorCanvas.tsx'), 'utf8');
  const n = (ec.match(/anchorHitRadius\(/g) || []).length;
  assert(n === 7, `EditorCanvas 锚点判定 7 处仍走 anchorHitRadius (实际 ${n})`);
  const ns = fs.readFileSync(path.join(root, 'src/osu/nodeSelection.ts'), 'utf8');
  assert(/d <= anchorHitRadius\(i === 0, devicePxPerOsu\) && \(!best \|\| d < bestD\)/.test(ns), 'nearestNode 逐点半径判定不变');
}

if (failures) { console.error(`\nV468_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV468_ALL_PASSED');
