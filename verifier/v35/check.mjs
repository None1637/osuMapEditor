// 验证器 v35: 控制点命中优先级 + 时间轴拖滑条尾改折返次数
//  1) 多个控制点在鼠标下: 取最近者, 距离相同取序号在前; 序号在前的控制点渲染在更上层 (倒序绘制)
//  2) 上方时间轴: 拖滑条尾端向左/右拉 -> 按整 repeat 改折返次数 (单次时长不变, stable/lazer 同款)
// 运行: cd app && node verifier/v35/check.mjs; node verifier/v35/cdp-v35.mjs (需 7100 dev server)
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('renderer.ts: 控制点倒序绘制 (序号在前者在更上层)');
{
  const src = readSrc('src/osu/renderer.ts');
  assert(/for \(let idx = ctrl\.length - 1; idx >= 0; idx--\)/.test(src), '手柄倒序绘制');
  assert(/ctrl\[idx \+ 1\]\.x === pt\.x && ctrl\[idx \+ 1\]\.y === pt\.y\) continue/.test(src),
    '红锚点重复对跳过前成员 (红色后成员在正上方)');
  assert(/idx > 0 && idx < ctrl\.length - 1/.test(src), '头部 (idx 0) 不跳过, 始终绘制');
}

section('EditorCanvas.tsx: 控制点命中最近优先, 并列取序号在前');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(/nearestCtrlPoint = \(ctrl/.test(src), 'nearestCtrlPoint helper');
  // v452 适配: 命中半径改按显示尺寸 (anchorHitRadius; 末参 maxDist=10 改为 devicePx), 严格 < 语义不变
  assert(/d <= anchorHitRadius\(i === 0, devicePx\) && \(best < 0 \|\| d < bestD\)/.test(src), '严格 < : 距离相同保持序号在前 (v452: 半径 = 显示尺寸)');
  assert(/const hitIdx = nearestCtrlPoint\(ctrl, odx, ody, p, devicePxPerOsu\(\)\)/.test(src), 'mousedown 拖拽用最近优先命中');
  // v443 适配: v438 右键删点重构 (删除抽 deleteSliderAnchor, 偏移改 soff) — 同一 nearestCtrlPoint 最近优先语义不变
  assert(/const i = nearestCtrlPoint\(ctrl, soff\?\.dx \?\? 0, soff\?\.dy \?\? 0, p, devicePxPerOsu\(\)\);/.test(src), '右键 (红点转白/白点删除) 同一命中优先级');
}

section('Timelines.tsx: 拖滑条尾改折返次数');
{
  const src = readSrc('src/components/Timelines.tsx');
  assert(src.includes('tailResizeRef'), 'tailResizeRef');
  assert(/hitTestTail = \(e/.test(src) && /o\.type !== 'slider'\) continue/.test(src), 'hitTestTail 仅滑条尾端 (css px 阈值)');
  // mousedown 中拖尾判定必须先于 hitTestMarker (尾时间在物件时长范围内, 否则被物件拖拽抢走)
  // v115: 判定行加锁定短路 (store.lockNotes ? null : ...), 优先级不变
  // v463 适配: 行首加 headId 头优先守卫 (命中头圆时跳过拖尾), 针串同步更新
  // v491 适配: v482 起 tailId 改距离裁决行 (tailHit.d < headDist), 针串同步更新; 仍须先于 hitTestMarker
  const tailPos = src.indexOf('const tailId = tailHit && (headId === null || tailHit.d < headDist(headId, e)) ? tailHit.id : null;');
  const markerPos = src.indexOf('const id = headId !== null ? headId : hitTestMarker(e);');
  assert(tailPos > 0 && markerPos > 0 && tailPos < markerPos, '拖尾判定优先于物件拖拽 (v463: 头圆命中除外; v482: 距离裁决)');
  assert(/Math\.max\(1, Math\.min\(100, Math\.round\(\(ms - o\.time\) \/ tr\.dur\)\)\)/.test(src), '整 repeat 伸缩 + clamp [1,100]');
  assert(src.includes("'ew-resize'"), '悬停尾端光标提示');
  assert(/finishMarkerDrag[\s\S]*?tailResizeRef[\s\S]*?commitDrag/.test(src), '拖尾收尾: 一次 undo (beginDrag/commitDrag)');
}

if (failures) { console.error(`\nVERIFIER_V35_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V35_ALL_TESTS_PASSED');
