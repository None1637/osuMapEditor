// 验证器 v39: sliderPath catmull 端点约定对齐 lazer
// v141 适配: 曲线互转 (c2b / b2c / curveConvert.ts) 整体废弃, 原 C->B/B->C 纯函数断言随之移除
import { SliderPath } from '../../src/osu/sliderPath';
import type { Vec2 } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

/** 点到路径折线的最小距离 */
function distToPath(p: Vec2, path: SliderPath): number {
  let min = Infinity;
  for (const q of path.points) min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y));
  return min;
}

section('sliderPath: catmull 端点约定对齐 lazer (首 clamp / 末端外推), 带红点不分段');
{
  // 末端外推 (v4 = 2*v3 - v2) vs 旧实现末端 clamp (v4 = v3): 三点 (0,0),(100,0),(100,100) 末段,
  // 用 lazer 端点约定的 catmull 公式直接求值, 与 computeRawPath 采样点 (t = j/50, v283: catmull_detail 50) 逐点比对 (精确到浮点误差)
  const raw = SliderPath.computeRawPath('C', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  const cat = (v1: Vec2, v2: Vec2, v3: Vec2, v4: Vec2, t: number): Vec2 => {
    const t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * ((2 * v2.x) + (-v1.x + v3.x) * t + (2 * v1.x - 5 * v2.x + 4 * v3.x - v4.x) * t2 + (-v1.x + 3 * v2.x - 3 * v3.x + v4.x) * t3),
      y: 0.5 * ((2 * v2.y) + (-v1.y + v3.y) * t + (2 * v1.y - 5 * v2.y + 4 * v3.y - v4.y) * t2 + (-v1.y + 3 * v2.y - 3 * v3.y + v4.y) * t3),
    };
  };
  // 末段 (i=1): v1=(0,0) v2=(100,0) v3=(100,100) v4=外推 (100,200); raw[50+j] = t=j/50 采样 (v283: 15 -> 50)
  const v4e = { x: 100, y: 200 };
  const maxErr = Math.max(...Array.from({ length: 50 }, (_, j) => {
    const e = cat({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, v4e, j / 50);
    return Math.hypot(raw[50 + j].x - e.x, raw[50 + j].y - e.y);
  }));
  // 对照: 若仍是旧 clamp (v4=v3=(100,100)), 中点 t=0.5 理论值 (106.25,50) 与外推值 (106.25,43.75) 差 6.25px
  assert(maxErr < 1e-6, `catmull 末端外推对齐 lazer (采样与公式最大误差 ${maxErr.toExponential(1)})`);
  // 带重复点 (红锚点) 的 C: lazer 传统格式不分段, 整条一个样条链 — 路径仍过全部锚点, 不抛异常
  const red = new SliderPath('C', [{ x: 100, y: 200 }, { x: 200, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 200 }], 100000);
  assert(red.totalLength > 150, `带红锚点 C 滑条路径正常计算 (全长 ${red.totalLength.toFixed(1)}px)`);
  assert(distToPath({ x: 200, y: 100 }, red) < 1, '路径经过红锚点 (200,100)');
  // 纯 C 无红点: 除末端外推外的中间段行为 — 路径过全部锚点 (catmull 插值性质不变)
  const pure = new SliderPath('C', [{ x: 100, y: 150 }, { x: 200, y: 100 }, { x: 300, y: 200 }, { x: 400, y: 150 }], 100000);
  assert(distToPath({ x: 200, y: 100 }, pure) < 1 && distToPath({ x: 300, y: 200 }, pure) < 1, '纯 C 路径仍过全部锚点');
}

if (failures) { console.error(`\nTESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nTESTS_ALL_PASSED');
