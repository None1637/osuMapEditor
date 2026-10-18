// 验证器 v452: 滑条锚点命中半径 = 屏幕上实际绘制尺寸 (取代固定 10/8 osu px 阈值)
//   问题: 放置滑条时离上一节点较近无法放点 (固定 8 osu px 切红圈远大于手柄显示),
//         选中/拖拽/右键删/穿透的锚点命中也是固定 10 osu px, 与绘制 (stable ~8 屏幕px 方格
//         = 4/k osu 半径; lazer 头 r7/其余 r6) 不一致。
//   改动: nodeSelection.ts 新增 anchorHitRadius(isHead, k) + nearestNode 改按节点各自半径判定;
//         EditorCanvas.tsx 新增 devicePxPerOsu() (渲染主变换同公式 k = backing/布局宽 × playfield scale),
//         nearestCtrlPoint 与 7 处 nearestNode 调用、放置流程 6 处 < 8 / >= 8 阈值全部改 anchorHitRadius。
// 运行: node verifier/v452/check.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'verifier/v452/_bundle.mjs');
buildSync({
  entryPoints: [path.join(root, 'verifier/v452/tests.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out,
  alias: { '@': path.join(root, 'src') },
});

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 纯函数测试 (半径公式 stable=4/k, lazer=6/7; nearestNode 按节点各自半径 + 最近/并列语义)
await import('file://' + out);
fs.unlinkSync(out);

const ns = read('src/osu/nodeSelection.ts');
const ec = read('src/components/EditorCanvas.tsx');

section('nodeSelection.ts: anchorHitRadius 共享函数');
{
  assert(/export function anchorHitRadius\(isHead: boolean, devicePxPerOsu: number\)/.test(ns), 'anchorHitRadius 签名 (isHead, 设备px/osu单位)');
  assert(/sliderPointStyle === 'stable'\) return 4 \/ \(devicePxPerOsu \|\| 1\)/.test(ns), 'stable = 4/k (8/k 方格内切, k=0 兜底)');
  assert(/return isHead \? 7 : 6;/.test(ns), 'lazer = 头 r7 / 其余 r6 (与 drawControlPointHandle 一致)');
  assert(/import \{ displaySettings \} from '\.\/displaySettings'/.test(ns), '读显示设置 (样式开关同 renderer)');
}

section('nodeSelection.ts: nearestNode 按节点各自半径');
{
  assert(/export function nearestNode\(sliders: HitObject\[\], offsets: Offsets, p: Pt, devicePxPerOsu: number\)/.test(ns), 'nearestNode 新签名 (k 取代 maxDist = 10)');
  assert(/d <= anchorHitRadius\(i === 0, devicePxPerOsu\) && \(!best \|\| d < bestD\)/.test(ns), '逐点半径判定 + 严格 < (并列保持序号在前)');
  assert(!/maxDist/.test(ns), '旧 maxDist 阈值移除');
}

section('EditorCanvas.tsx: k 换算 + nearestCtrlPoint');
{
  assert(/const devicePxPerOsu = \(\) => \{[\s\S]{0,200}?canvasRef\.current/.test(ec), 'devicePxPerOsu helper 存在');
  assert(/\(c\.width \/ r\.width\) \* playfieldTransform\(r\)\.scale/.test(ec), 'k = backing/布局宽 × playfield scale (与渲染主变换同公式)');
  assert(/const nearestCtrlPoint = \(ctrl[^)]*, devicePx: number\): number/.test(ec), 'nearestCtrlPoint 新签名');
  assert(/d <= anchorHitRadius\(i === 0, devicePx\) && \(best < 0 \|\| d < bestD\)/.test(ec), 'nearestCtrlPoint 逐点半径 + 严格 <');
  assert(!/maxDist = 10/.test(ec), '旧 maxDist = 10 移除');
  assert((ec.match(/nearestNode\(sliders, offs, p, devicePxPerOsu\(\)\)/g) || []).length === 6, 'nearestNode 6 处调用 (p) 全部带 k');
  assert(/nearestNode\(sliders, offs, cp, devicePxPerOsu\(\)\)/.test(ec), 'nearestNode hover 调用 (cp) 带 k');
  assert((ec.match(/nearestCtrlPoint\(ctrl, [^)]*, devicePxPerOsu\(\)\)/g) || []).length === 3, 'nearestCtrlPoint 3 处调用全部带 k');
}

section('EditorCanvas.tsx: 放置流程 6 处阈值 = 手柄显示半径');
{
  assert(!/Math\.hypot\([^)]*\) < 8\)?[,;{]/.test(ec.replace(/< 8 屏幕|8 屏幕 px/g, '')), '旧固定 < 8 阈值清空');
  assert(!/>= 8\) \{/.test(ec), '旧固定 >= 8 阈值清空 (右键完成)');
  assert(/hypot\(p\.x - lastPt\.x, p\.y - lastPt\.y\) < anchorHitRadius\(pendPts\.length === 1, devicePxPerOsu\(\)\)/.test(ec), '双击末点置红 (v208): 末点半径, 仅头部时 = 头');
  assert(/hypot\(p\.x - pendPts\[0\]\.x, p\.y - pendPts\[0\]\.y\) < anchorHitRadius\(true, devicePxPerOsu\(\)\)/.test(ec), '点击头部闭环 finishSlider: 头半径');
  assert(/hypot\(p\.x - last\.x, p\.y - last\.y\) < anchorHitRadius\(store\.pendingSlider\.length === 1, devicePxPerOsu\(\)\)/.test(ec), '点击末点切红 (用户反馈点): 末点半径');
  assert((ec.match(/hypot\(c\.x - head\.x, c\.y - head\.y\) < anchorHitRadius\(true, devicePxPerOsu\(\)\)/g) || []).length === 2, '手绘候选松开距头切红 2 处 (onMouseUp + window mouseup): 头半径');
  assert(/hypot\(pR\.x - lastR\.x, pR\.y - lastR\.y\) >= anchorHitRadius\(store\.pendingSlider\.length === 1, devicePxPerOsu\(\)\)/.test(ec), '右键完成落幻影点: 末点半径 (>=)');
}

section('范围外不动 (v452 不触碰)');
{
  assert(/const tol = 10 \/ uiZoom\(\) \/ playfieldTransform/.test(ec), '旋转手柄 tol 不变');
  assert(/const tol = 8 \/ uiZoom\(\) \/ playfieldTransform/.test(ec), '缩放手柄 tol 不变');
  const r = read('src/osu/renderer.ts');
  assert(/const s = 7 \/ k;/.test(r) && /isHead \? 7 : 6, 0, Math\.PI \* 2/.test(r), '绘制尺寸不变 (drawControlPointHandle)');
}

console.log(failures ? `\n${failures} 个断言失败` : '\nv452 全部通过');
process.exit(failures ? 1 : 0);
