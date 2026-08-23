// 验证器 v99: 1000 节点滑条渲染性能 (期望 <10ms)
// 背景: 原 bezierPath 每采样点 O(k²) de Casteljau 密集求值 (n=max(10,12k)),
//   1000 控制点单段 = 12000 采样 × ~500k 内循环 ≈ 6e9 次运算, 冷路径卡数十秒
// 优化: flattenBezier 自适应剖分 (弦高 0.25px 平坦度, de Casteljau 中点剖分, 总成本 ~2k²)
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

section('sliderPath.ts: flattenBezier 混合策略 (小段剖分 + 大段截断 Bernstein)');
{
  const src = readSrc('src/osu/sliderPath.ts');
  assert(src.includes('export function flattenBezier'), 'flattenBezier 导出 (纯函数测试入口)');
  assert(src.includes('flattenBezier(segment, out)'), 'bezierPath 段落走 flattenBezier');
  assert(!src.includes('deCasteljau(segment'), '旧每采样点 de Casteljau 求值已移除');
  assert(src.includes('pts.length <= 24'), '小段 (<=24) 走剖分阈值');
  assert(src.includes('subdivideBezier'), '小段自适应剖分 (弦高 0.25px)');
  assert(src.includes('depth >= 24'), '剖分递归深度兜底');
  assert(src.includes('function bernsteinAt'), '大段截断 Bernstein 求值');
  assert(src.includes('w < 1e-9'), '相对权重 1e-9 截断');
  assert(src.includes('pts.length * 12'), '大段采样密度与旧版一致 (12/控制点)');
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
