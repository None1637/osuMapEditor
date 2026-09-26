// 验证器 v99: 1000 节点滑条渲染性能 (期望 <50ms; v283 起算法改为 lazer 剖分移植, 界从 <10ms 放宽)
// 背景: 原 bezierPath 每采样点 O(k²) de Casteljau 密集求值 (n=max(10,12k)),
//   1000 控制点单段 = 12000 采样 × ~500k 内循环 ≈ 6e9 次运算, 冷路径卡数十秒
// 优化: v99 自适应剖分 (弦高 0.25px); v283 lazer PathApproximator 移植 (迭代剖分 + 二阶差容差, 全阶数统一)
// 探针: EditorCanvas 每帧 renderPlayfield 耗时环形缓冲 window.__perfRender (900 帧),
//   window.__invalidatePath(id) 失效路径+body 缓存 => 下一帧即冷帧
// 运行: cd app && npx esbuild verifier/v99/tests.ts --bundle --platform=node --outfile=/tmp/v99.cjs && node /tmp/v99.cjs
//       node verifier/v99/check.mjs; node verifier/v99/cdp-perf.mjs (需 7100 dev server)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg); }
function section(name) { console.log('== ' + name); }
function readSrc(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

section('sliderPath.ts: flattenBezier lazer 剖分移植 (v283 起; 原混合策略: 小段剖分 + 大段截断 Bernstein)');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(src.includes('export function flattenBezier'), 'flattenBezier 导出 (纯函数测试入口)');
  assert(src.includes('flattenBezier(segment, out)'), 'bezierPath 段落走 flattenBezier');
  assert(!src.includes('deCasteljau(segment'), '旧每采样点 de Casteljau 求值已移除');
  // v283: 全阶数统一 lazer PathApproximator 移植 — <=24 阈值 / subdivideBezier / bernsteinAt / 12n 采样均已移除
  assert(!src.includes('pts.length <= 24') && !src.includes('subdivideBezier'), 'v283: <=24 弦高剖分双轨移除');
  assert(!src.includes('function bernsteinAt') && !src.includes('pts.length * 12'), 'v283: 截断 Bernstein + 12n 等参采样移除');
  assert(src.includes('function bezierFlatEnough') && src.includes('0.25 * 0.25 * 4'), 'v283: lazer 二阶差平坦度 (BEZIER_TOLERANCE=0.25)');
  assert(src.includes('function bezierSubdivideBuf') && src.includes('function bezierApproximateBuf'), 'v283: lazer bezierSubdivide/bezierApproximate 移植');
  assert(src.includes('stack.pop()'), 'v283: 迭代栈剖分 (无递归, 大输入不栈溢出)');
}

section('EditorCanvas.tsx: 渲染性能探针');
{
  const src = readSrc('src/components/EditorCanvas.tsx');
  assert(src.includes('__perfRender'), 'renderPlayfield 耗时环形缓冲 window.__perfRender');
  assert(src.includes('performance.now()'), 'performance.now() 计时');
  assert(src.includes('pf.length > 900'), '环形缓冲上限 900 帧');
  assert(src.includes('__invalidatePath'), 'window.__invalidatePath 暴露 (冷帧测量)');
}

if (failures) { console.error(`\nVERIFIER_V99_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nVERIFIER_V99_ALL_TESTS_PASSED');
