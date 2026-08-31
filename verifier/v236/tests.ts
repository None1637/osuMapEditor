// 验证器 v236 行为测试: 对称滑条 (computeSymSlider 纯函数数值断言)
//   - axis 轴对称: axisDir 三选 (v/h = 过拼接锚点的竖直/水平线, custom = axisP1/axisP2 两点直线), 镜像点坐标
//   - point 中心对称 = 绕拼接锚点旋转 180° (无 anchor 参数, anchor 字段仅服务 rotate/translate)
//   - 修正1: axis/point 份节点序列反转 (镜像翻手性, 拼接方向连续); rotate/translate 不反转
//   - 二轮修正: 拼接锚点 joinAnchor = 拼头?滑条头:滑条尾 (sliderTailPoint); axis/point 的中心与缩放锚点恒用它
//   - 二轮修正: join=tail/head 链式对齐平移 — 拼尾 份1首→原尾、份i首→份i-1末; 拼头 份n末→原头、份i末→份i+1首;
//     对齐后接缝恒重合 (红锚点去重分支); 拼头段序列 = [份1..份n, 原] (各份正向); join=none 不平移
//   - rotate 中心旋转 n 次: 角度按份累加 (顺时针为正); translate 等差向量: 第 i 份 = i×向量 + i(i-1)/2×增量
//   - scalePerCopy: 第 i 份变换后绕缩放锚点缩放 1 + i×值 (axis/point = 拼接锚点)
//   - join=none 独立副本: length 几何重算 / id 换新 / time 继承 / 原对象不被改
//   - join=tail/head 拼接: 节点序列 + 接缝红锚点重复点 + endTime 延长 / time 提前
import { computeSymSlider, DEFAULT_SYM_SLIDER_PARAMS, type SymSliderParams } from '../../src/osu/convert/symSlider';
import { genId, type Beatmap, type HitObject } from '../../src/osu/parser';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else console.log('  ok:', msg);
}
function section(name: string) { console.log('== ' + name); }

const bm = {} as Beatmap; // 拼接锚点 tail 分支用 bm (sliderTailPoint → getSliderPath 忽略 bm 形参)
const mk = (patch: Partial<SymSliderParams>): SymSliderParams => ({ ...DEFAULT_SYM_SLIDER_PARAMS, ...patch });
const mkSlider = (pts: [number, number][], patch: Partial<HitObject> = {}): HitObject => ({
  id: genId(), type: 'slider', x: pts[0][0], y: pts[0][1], time: 1000,
  curveType: 'L', curvePoints: pts.slice(1).map(([x, y]) => ({ x, y })),
  slides: 1, length: 100, hitSound: 4, ...patch,
});
const nodesOf = (s: HitObject): [number, number][] =>
  [{ x: s.x, y: s.y }, ...(s.curvePoints ?? [])].map(p => [p.x, p.y] as [number, number]);
const eqNodes = (s: HitObject, want: [number, number][]) => {
  const got = nodesOf(s);
  return got.length === want.length && got.every((p, i) => p[0] === want[i][0] && p[1] === want[i][1]);
};
const show = (s: HitObject) => nodesOf(s).map(p => p.join(',')).join(' ');

section('axis 轴对称 (axisDir 三选; v/h 轴过拼接锚点; 修正1: 份节点序列反转)');
{
  // 竖直轴过拼接锚点 (none → 滑条尾 (200,100)): x=200 镜像 (x,y)→(400−x,y); 变换 [(300,100),(200,100)] 反转
  const r = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'axis', axisDir: 'v', join: 'none' }));
  assert(r.length === 1 && eqNodes(r[0], [[200, 100], [300, 100]]), `竖直轴过尾镜像+反转 (实际 ${show(r[0])})`);
  // 3 节点: 尾 = (200,200), x=200 镜像 (x,y)→(400−x,y); 变换 [(300,100),(200,100),(200,200)] 反转
  const r1 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100], [200, 200]]), mk({ mode: 'axis', axisDir: 'v', join: 'none' }));
  assert(r1.length === 1 && eqNodes(r1[0], [[200, 200], [200, 100], [300, 100]]), `竖直轴过尾 3 节点镜像+反转 (实际 ${show(r1[0])})`);
  // 水平轴过尾 (200,100): y=100 镜像 — 节点都在轴上不动; 反转 → [(200,100),(100,100)]
  const r2 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'axis', axisDir: 'h', join: 'none' }));
  assert(r2.length === 1 && eqNodes(r2[0], [[200, 100], [100, 100]]), `水平轴过尾镜像+反转 (实际 ${show(r2[0])})`);
  // 自定义轴 = y 轴 (0,0)-(0,100): (x,y)→(−x,y); 变换 [(−100,100),(−200,100)] 反转 (none 不平移, 留在原位)
  const r3 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]),
    mk({ mode: 'axis', axisDir: 'custom', axisP1: { x: 0, y: 0 }, axisP2: { x: 0, y: 100 }, join: 'none' }));
  assert(r3.length === 1 && eqNodes(r3[0], [[-200, 100], [-100, 100]]), `自定义竖直轴 (y 轴) 镜像+反转 (实际 ${show(r3[0])})`);
  // 自定义 45° 轴 y=x (0,0)-(100,100): (x,y)→(y,x); 变换 [(200,100),(100,300)] 反转
  const r4 = computeSymSlider(bm, mkSlider([[100, 200], [300, 100]]),
    mk({ mode: 'axis', axisDir: 'custom', axisP1: { x: 0, y: 0 }, axisP2: { x: 100, y: 100 }, join: 'none' }));
  assert(r4.length === 1 && eqNodes(r4[0], [[100, 300], [200, 100]]), `自定义 45° 轴 (y=x) 镜像+反转 (实际 ${show(r4[0])})`);
  // 自定义轴两点重合 = 轴退化, 不动作
  const r5 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]),
    mk({ mode: 'axis', axisDir: 'custom', axisP1: { x: 50, y: 50 }, axisP2: { x: 50, y: 50 }, join: 'none' }));
  assert(r5.length === 0, '自定义轴两点重合 → 返回 []');
  // axis/point 恒 1 份 (count 被忽略)
  const r6 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'axis', axisDir: 'v', join: 'none', count: 5 }));
  assert(r6.length === 1, 'axis 模式忽略 count (恒 1 份)');
}

section('point 中心对称 = 绕拼接锚点旋转 180° (anchor 字段不生效; 修正1: 份节点序列反转)');
{
  // 拼接锚点 (none → 滑条尾 (200,100)): 变换 [(300,100),(200,100)] 反转 → [(200,100),(300,100)]
  const r = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'point', join: 'none' }));
  assert(r.length === 1 && eqNodes(r[0], [[200, 100], [300, 100]]), `中心=滑条尾 (200,100) + 反转 (实际 ${show(r[0])})`);
  // anchor/customX 字段对 point 不生效 — 传 custom (0,0) 结果不变
  const r2 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'point', anchor: 'custom', customX: 0, customY: 0, join: 'none' }));
  assert(r2.length === 1 && eqNodes(r2[0], [[200, 100], [300, 100]]), `point 忽略 anchor 字段 (实际 ${show(r2[0])})`);
}

section('rotate 中心旋转 n 次 (每份递转 rotateDeg, 顺时针为正; 不反转; anchor 字段生效)');
{
  const r = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'rotate', count: 3, rotateDeg: 90, anchor: 'head', join: 'none' }));
  assert(r.length === 3, '3 份副本');
  assert(eqNodes(r[0], [[100, 100], [100, 200]]), `第 1 份转 90° (实际 ${show(r[0])})`);
  assert(eqNodes(r[1], [[100, 100], [0, 100]]), `第 2 份转 180° (实际 ${show(r[1])})`);
  assert(eqNodes(r[2], [[100, 100], [100, 0]]), `第 3 份转 270° (实际 ${show(r[2])})`);
}

section('translate 等差向量 (第 i 份 = i×向量 + i(i-1)/2×增量; 不反转)');
{
  const r = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]),
    mk({ mode: 'translate', count: 3, dx: 10, dy: 20, ddx: 1, ddy: 2, join: 'none' }));
  assert(r.length === 3, '3 份副本');
  assert(eqNodes(r[0], [[110, 120], [210, 120]]), `第 1 份位移 (10,20) (实际 ${show(r[0])})`);
  assert(eqNodes(r[1], [[121, 142], [221, 142]]), `第 2 份位移 (21,42) = 2×向量+1×增量 (实际 ${show(r[1])})`);
  assert(eqNodes(r[2], [[133, 166], [233, 166]]), `第 3 份位移 (33,66) = 3×向量+3×增量 (实际 ${show(r[2])})`);
}

section('scalePerCopy 缩放 (第 i 份变换后绕缩放锚点 ×(1+i×值); axis/point 缩放锚点 = 拼接锚点)');
{
  // point + 0.5/份 (none → 锚=尾 (200,100)): (100,100) 镜像到 (300,100) 再绕尾 ×1.5 → (350,100); 反转 → [(200,100),(350,100)]
  const r = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'point', scalePerCopy: 0.5, join: 'none' }));
  assert(r.length === 1 && eqNodes(r[0], [[200, 100], [350, 100]]), `point+缩放绕拼接锚点 ×1.5 + 反转 (实际 ${show(r[0])})`);
  // rotate 90° count=2 + 0.25/份 (anchor=head): 第 1 份 ×1.25 → (100,225); 第 2 份 ×1.5 → (−50,100) (不反转)
  const r2 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'rotate', count: 2, rotateDeg: 90, anchor: 'head', scalePerCopy: 0.25, join: 'none' }));
  assert(eqNodes(r2[0], [[100, 100], [100, 225]]), `rotate 第 1 份 ×1.25 (实际 ${show(r2[0])})`);
  assert(eqNodes(r2[1], [[100, 100], [-50, 100]]), `rotate 第 2 份 ×1.5 (实际 ${show(r2[1])})`);
  // axis 竖直轴过尾 (200,100) + 0.5/份: 缩放锚点 = 拼接锚点; (100,100)→镜像(300,100)→×1.5 → (350,100); 反转
  const r3 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'axis', axisDir: 'v', scalePerCopy: 0.5, join: 'none' }));
  assert(r3.length === 1 && eqNodes(r3[0], [[200, 100], [350, 100]]), `axis+缩放绕拼接锚点 ×1.5 + 反转 (实际 ${show(r3[0])})`);
}

section('join=none 独立副本字段 (不平移 / length 重算 / id 换新 / 原对象不动)');
{
  const o = mkSlider([[100, 100], [200, 100]]);
  const r = computeSymSlider(bm, o, mk({ mode: 'point', join: 'none' }));
  assert(r.length === 1 && r[0].id !== o.id, '副本 id 用 genId 换新');
  assert(r[0].x === 200 && r[0].y === 100 && eqNodes(r[0], [[200, 100], [300, 100]]), `副本头 = 反转后首节点 (实际 ${show(r[0])})`);
  assert(r[0].curveType === 'L' && r[0].time === 1000 && r[0].slides === 1 && r[0].hitSound === 4, 'curveType/time/slides/hitSound 继承原滑条');
  assert(r[0].length === 100, `length 按几何全长重算 = 100 (实际 ${r[0].length})`);
  assert(o.x === 100 && o.curvePoints!.length === 1 && o.curvePoints![0].x === 200, '原滑条未被修改 (纯函数)');
  // 二轮修正: none 不做链式平移 — 份保持变换原位
  const r2 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'translate', count: 2, dx: 50, dy: 0, join: 'none' }));
  assert(eqNodes(r2[0], [[150, 100], [250, 100]]) && eqNodes(r2[1], [[200, 100], [300, 100]]),
    `join=none 不平移 (份保持变换原位) (实际 ${show(r2[0])} | ${show(r2[1])})`);
}

section('join=tail 拼到尾部 (链式对齐: 份1首→原尾, 份i首→份i-1末; 接缝恒重合走红锚点去重)');
{
  // 二轮修正: translate count=2 dx=50 — 变换份 [(150,100),(250,100)]/[(200,100),(300,100)],
  //   份1 平移 (+50,0) 对齐原尾, 份2 平移 (+100,0) 对齐份1末 → 链式 (300,100)/(400,100)
  const o = mkSlider([[100, 100], [200, 100]], { endTime: 1600 }); // duration 600
  const r = computeSymSlider(bm, o, mk({ mode: 'translate', count: 2, dx: 50, dy: 0, join: 'tail' }));
  assert(r.length === 1, '拼接返回单条滑条');
  assert(eqNodes(r[0], [[100, 100], [200, 100], [200, 100], [300, 100], [300, 100], [400, 100]]),
    `translate 拼尾链式对齐节点序列 (实际 ${show(r[0])})`);
  assert(r[0].curveType === 'B' && r[0].x === 100 && r[0].y === 100, 'curveType 转 B, 头 = 原头');
  assert(r[0].time === 1000 && r[0].endTime === 2800, `拼尾 time 不变, endTime = time + duration×(份数+1) = 2800 (实际 ${r[0].time}..${r[0].endTime})`);
  assert(r[0].length === 300 && r[0].slides === 1, `length = 拼接几何总长 300, slides 保留 (实际 ${r[0].length})`);
  // point 拼尾 — 中心 = 拼接锚点 = 原尾 (200,100): 变换 [(300,100),(200,100)] 反转 [(200,100),(300,100)],
  //   份首已在原尾 (对齐偏移 0) → 接缝重合去重
  const r3 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]], { endTime: 1600 }), mk({ mode: 'point', join: 'tail' }));
  assert(eqNodes(r3[0], [[100, 100], [200, 100], [200, 100], [300, 100]]),
    `point 拼尾: 反转+对齐后依次接上 (实际 ${show(r3[0])})`);
  assert(r3[0].time === 1000 && r3[0].endTime === 2200, `point 拼尾 endTime = time + duration×2 = 2200 (实际 ${r3[0].time}..${r3[0].endTime})`);
  // axis 水平轴过尾拼尾 — 节点在轴上镜像不动, 反转 [(200,100),(100,100)], 份首对齐原尾偏移 0
  const r4 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'axis', axisDir: 'h', join: 'tail' }));
  assert(eqNodes(r4[0], [[100, 100], [200, 100], [200, 100], [100, 100]]),
    `axis 拼尾: 反转+对齐 (实际 ${show(r4[0])})`);
}

section('join=head 拼到头部 (链式对齐: 份n末→原头, 份i末→份i+1首; 段序列 = [份1..份n, 原] 各份正向; time 提前)');
{
  // 二轮修正: point 拼头 — 拼接锚点 = 原头 (100,100): 变换 [(100,100),(0,100)] 反转 [(0,100),(100,100)],
  //   份末已在原头 (对齐偏移 0); parts=[份1, 原] → 接缝重合
  const o = mkSlider([[100, 100], [200, 100]], { endTime: 1600 });
  const r = computeSymSlider(bm, o, mk({ mode: 'point', join: 'head' }));
  assert(r.length === 1 && eqNodes(r[0], [[0, 100], [100, 100], [100, 100], [200, 100]]),
    `point 拼头 = 份 (正向) + 原节点, 接缝重合 (实际 ${show(r[0])})`);
  assert(r[0].x === 0 && r[0].y === 100, `头 = 拼头部首点 (实际 ${r[0].x},${r[0].y})`);
  assert(r[0].endTime === 1600 && r[0].time === 400, `拼头 endTime 不变, time = endTime - duration×(份数+1) = 400 (实际 ${r[0].time}..${r[0].endTime})`);
  // 多份 translate 拼头链式 — 份2末 (300,100)→原头 (100,100) 平移 (−200,0); 份1末 (250,100)→份2首 (0,100) 平移 (−250,0)
  const r2 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]], { endTime: 1600 }), mk({ mode: 'translate', count: 2, dx: 50, dy: 0, join: 'head' }));
  assert(eqNodes(r2[0], [[-100, 100], [0, 100], [0, 100], [100, 100], [100, 100], [200, 100]]),
    `多份拼头链式对齐 (份1→份2→原, 各份正向) (实际 ${show(r2[0])})`);
  assert(r2[0].time === -200 && r2[0].endTime === 1600, `多份拼头 time 提前 duration×3 (实际 ${r2[0].time})`);
  // axis 竖直轴拼头 — 拼接锚点 = 原头 (100,100): x=100 镜像 (200,100)→(0,100), 反转 [(0,100),(100,100)], 份末对齐偏移 0
  const r3 = computeSymSlider(bm, mkSlider([[100, 100], [200, 100]]), mk({ mode: 'axis', axisDir: 'v', join: 'head' }));
  assert(eqNodes(r3[0], [[0, 100], [100, 100], [100, 100], [200, 100]]),
    `axis 拼头: 轴过头 + 反转 + 对齐 (实际 ${show(r3[0])})`);
}

section('边界: 非滑条返回空');
{
  const circle: HitObject = { id: genId(), type: 'circle', x: 100, y: 100, time: 1000 };
  assert(computeSymSlider(bm, circle, mk({})).length === 0, 'circle 返回 []');
}

if (failures) { console.error(`\nV236_TESTS_FAILED: ${failures} 处失败`); process.exit(1); }
console.log('\nV236_TESTS_ALL_PASSED');
