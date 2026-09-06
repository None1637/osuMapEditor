// 验证器 v240: 直线滑条新增白色控制点 → 恰 3 点时切换为圆弧 (stable 同款)。
// 需求: 给已有的直线滑条新增白色控制点时滑条类型应切换为圆弧, 此前新增后仍为直线。
// 实现 (EditorCanvas.tsx 节点层插入处): 插入前记录 wasLinear, insertSliderPoint + applySliderPoints 后
// 若仍为 'L' 且恰 3 点 (头+新点+尾) 则 curveType='P'; 仅插入路径升级 — 拖动/删除已有折线 (L 3 点) 节点不变形
// (resolveSliderCurveType 的 L 保持语义不动)。
// 运行: node verifier/v240/check.mjs
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const cv = readSrc('src/components/EditorCanvas.tsx');

console.log('== EditorCanvas.tsx: 插入白点升级 L→P');
assert(/const wasLinear = so\.curveType === 'L';/.test(cv), '插入前记录直线类型');
assert(/const newPts = insertSliderPoint\(ctrl, best, bestT\);/.test(cv), '插入点列');
assert(/if \(wasLinear && so\.curveType === 'L' && newPts\.length === 3\) so\.curveType = 'P';/.test(cv),
  '恰 3 点时升级圆弧 (仅插入路径)');
assert(/resnapSliderLength\(bm, so, store\.beatSnap\)/.test(cv), '升级后仍 SnapTo 长度吸附');

console.log('== sliderPath.ts: resolveSliderCurveType 保持语义不变 (拖动折线不变形)');
{
  const sp = readSrc('src/osu/sliderPath.ts');
  assert(/if \(current === 'P' && pts\.length !== 3\) return inferSegmentType\(pts\.length\);/.test(sp), 'P 点数≠3 降级不变');
  assert(/return current;/.test(sp), 'L 任意点数保持语义不变 (移动折线节点不升级)');
}

if (failures) { console.error(`\nV240_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV240_ALL_PASSED');
